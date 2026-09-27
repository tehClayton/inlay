/* The practice loop: the drill controls in the prompt strip, the drill panel,
   the answer buttons, and a run from Start to Stop.

   A run goes prompt, answer, feedback, prompt, until stopped. A right answer
   flashes green and the next prompt follows after a beat. A wrong one marks
   your tap red, shows where the answer was, and waits for a tap anywhere, so
   you look for as long as you need. Drill logic is in drills.js; this is the
   page's half of it.

   Times run from the frame the prompt was drawn in to the tap's own
   timestamp — both on the page's performance clock, and neither delayed by
   how long the page took to handle anything in between. */
import { $, h, fill, label, say, openPanel, closePanel, isOpen } from "./ui.js";
import {
  DRILLS, DRILL_KINDS, candidates, makePrompt, promptText, isRight, createScore, scoreText,
  wholeNeck, findsAll, usesNotes, answerName, ALL_INTERVALS,
} from "./drills.js";
import { fretRange, stringNumber, pitchAt } from "./instrument.js";
import { noteName, parseNote, INTERVALS } from "./theory.js";
import { createRecorder } from "./sessions.js";

const NEXT_MS = 400;         // after a right answer, before the next prompt
const ACCIDENTAL_MS = 450;   // naming by keyboard: how long a letter waits for a ♯ or ♭

/* "string 5, fret 3" or "string 5, open": a position in words. */
export function where(inst, pos){
  const s = inst.strings[pos.string];
  return `string ${stringNumber(pos.string, inst.strings.length)}, ` +
         (pos.fret === s.start ? "open" : `fret ${pos.fret}`);
}

/* `board` is the fretboard; `getInst` and `getFrom` say what's on it;
   `getSettings`/`saveSettings` hold the drill choice; `onChange` is told when
   a run starts or stops, so the page can put its idle state back;
   `onSession(recorder, done)` is handed the run's session to save — when it
   stops (done), and along the way when the page is hidden, in case it isn't
   coming back; `announce(text)` says what happened, for a screen reader. */
export function createPractice({ board, getInst, getFrom, getSettings, saveSettings, onChange, onSession,
                                 announce = () => {} }){
  let running = false, state = "idle";   // idle | asking | between | reveal
  let prompt = null, cands = [], score = createScore(), t0 = 0, timer = 0;
  let found = [], misses = [], revealed = false, chosen = null;   // chosen: an answer button pressed
  let strings = null;                     // the strings filter, null for all; not stored
  let recorder = null;                    // this run's session

  /* A session covers one drill with one set of filters, so changing either
     mid-run hands over the session so far and starts another. */
  function newSession(){
    recorder = createRecorder({ inst: getInst(), drill: kind(), notes: notesFilter(), strings });
  }
  const notesFilter = () => usesNotes(kind()) ? getSettings().drillNotes : "all";
  function handOver(done){
    if (recorder && recorder.answers && onSession) onSession(recorder, done);
  }

  const kind = () => getSettings().drill;
  const pref = () => getSettings().notePref;

  /* ------------------------------------------------------------ drawing */

  /* The frets on screen; the in-view drills' practice range. */
  const windowRange = () => fretRange(getInst(), getFrom());

  /* The board is redrawn from the run's state, so marks never drift from it.
     While an in-view drill runs, the neck past the window is dimmed: it's
     there to see, but it isn't what's being asked about. */
  function paint(){
    const inst = getInst();
    board.clearMarks();
    board.setDim(running && prompt && !wholeNeck(prompt.kind) ? windowRange() : null);
    if (!prompt) return;
    const name = m => noteName(pitchAt(inst, m.string, m.fret), pref());
    // An interval's root is marked throughout, in the amber study uses for
    // roots, and its answers are spelled from it.
    if (prompt.root) board.mark(prompt.root, "root", noteName(prompt.rootPc, pref()));
    const answer = prompt.kind === "interval" ? () => answerName(prompt, pref()) : name;
    if (prompt.kind === "name"){
      board.mark(prompt.pos, revealed ? "target" : (state === "between" ? "true" : "target"),
                 revealed || state === "between" ? noteName(prompt.pc, pref()) : "?");
    }
    for (const f of found) board.mark(f, "true", answer(f));
    for (const m of misses) board.mark(m, "miss", name(m));
    if (revealed && prompt.kind !== "name"){
      for (const t of prompt.targets) if (!found.some(f => f.string === t.string && f.fret === t.fret)){
        board.mark(t, "target", answer(t));
      }
    }
  }

  function renderAnswers(){
    const row = $("answers");
    const show = running && prompt && prompt.kind === "name";
    row.hidden = !show;
    if (!show) return;
    fill(row, ...Array.from({ length: 12 }, (_, pc) => {
      let cls = "ans";
      if (state !== "asking" && chosen !== null){
        if (pc === prompt.pc) cls += " right";
        else if (pc === chosen) cls += " wrong";
      } else if (pending && pending.pc === pc) cls += " pending";   // typed, waiting for ♯ or ♭
      // pointerdown for the time; click for a keyboard's Enter or Space. After
      // the first, the prompt has moved on, so one press can't answer twice.
      return h("button", { class: cls, type: "button", "data-pc": String(pc),
        onpointerdown: e => { e.preventDefault(); answerNote(pc, e); },
        onclick: e => answerNote(pc, e) }, noteName(pc, pref()));
    }));
  }

  function renderStrip(){
    $("drillName").textContent = DRILLS[kind()].name;
    label($("drillBtn"), `Drill: ${DRILLS[kind()].name}. Choose the drill and what it asks about`);
    $("runBtn").textContent = running ? "Stop" : "Start";
    $("runBtn").classList.toggle("go", !running);
    $("runBtn").classList.toggle("stop", running);
    $("score").textContent = scoreText(score);
    if (running && prompt){
      // Which fret is marked is plain to see; a screen reader has to be told.
      fill($("prompt"), h("b", {}, promptText(prompt, getInst(), pref(), found.length)),
        prompt.kind === "name" ? h("span", { class: "sr" }, `: ${where(getInst(), prompt.pos)}`) : null,
        prompt.root ? h("span", { class: "sr" }, `, the root at ${where(getInst(), prompt.root)}`) : null);
    }
  }

  const nameAt = pos => noteName(pitchAt(getInst(), pos.string, pos.fret), pref());
  const places = ts => ts.map(t => where(getInst(), t)).join(", and ");

  const render = () => { paint(); renderAnswers(); renderStrip(); };

  /* ------------------------------------------------------------ the loop */

  function pool(){
    const inst = getInst();
    if (!inst) return [];
    const range = wholeNeck(kind()) ? [0, inst.frets] : windowRange();
    return candidates(inst, range, { strings, notes: notesFilter() });
  }

  function next(){
    clearTimeout(timer);
    clearPending();
    cands = pool();
    // An interval needs both its notes in view, so there can be places to
    // stand but nothing to ask.
    const made = cands.length ? makePrompt(kind(), cands, { last: prompt, intervals: getSettings().drillIntervals }) : null;
    if (!made){
      stop();
      say("Nothing to ask here: widen the frets shown or the drill's filters.");
      return;
    }
    prompt = made;
    found = []; misses = []; revealed = false; chosen = null;
    state = "asking";
    render();
    // Timed from the frame the prompt is drawn in, on the same clock as taps.
    t0 = Infinity;
    requestAnimationFrame(ts => { t0 = ts; });
  }

  const since = e => Math.max(0, e.timeStamp - t0);

  function right(ms){
    score.add(true, ms);
    state = "between";
    render();
    timer = setTimeout(next, NEXT_MS);
  }

  function wrong(ms){
    score.add(false, ms);
    revealed = true;
    state = "reveal";
    render();
  }

  /* A tap on the board while a run is on. In an in-view drill, a tap on the
     dimmed neck past the window is neither an answer nor a miss. */
  function tap(pos, e){
    if (!running || state !== "asking" || prompt.kind === "name") return;
    if (!wholeNeck(prompt.kind)){
      const [a, b] = windowRange();
      if (pos.fret < a || pos.fret > b) return;
    }
    const ms = since(e);
    const ok = isRight(prompt, pos);
    if (findsAll(prompt.kind)){
      if (ok){
        if (found.some(f => f.string === pos.string && f.fret === pos.fret)) return;   // already found
        found.push(pos);
        misses = [];
        score.add(true, ms);
        recorder.add(pos, true, ms);
        t0 = e.timeStamp;                  // each find timed from the last
        if (found.length === prompt.targets.length){
          state = "between";
          announce(`All ${found.length} found.`);
          render();
          timer = setTimeout(next, NEXT_MS);
        } else {
          announce(`Found, ${found.length} of ${prompt.targets.length}.`);
          render();
        }
      } else {
        // A miss counts, and shows, but doesn't end the prompt.
        score.add(false, ms);
        recorder.add(pos, false, ms);
        misses = [pos];
        announce(`No: that's ${nameAt(pos)}.`);
        render();
      }
      return;
    }
    /* A miss is kept against the fret you tapped: that's the one whose note
       you got wrong. */
    recorder.add(pos, ok, ms);
    if (ok){
      found = [pos];
      announce(`Right: ${nameAt(pos)}.`);
      right(ms);
    } else {
      misses = [pos];
      announce(`No: that's ${nameAt(pos)}. ${answerName(prompt, pref())} is at ${places(prompt.targets)}. ` +
               `Press Space to go on.`);
      wrong(ms);
    }
  }

  /* Naming: right or wrong, it's about the marked fret. */
  function answerNote(pc, e){
    if (!running || state !== "asking") return;
    clearPending();
    chosen = pc;
    const ms = since(e), ok = isRight(prompt, pc);
    recorder.add(prompt.pos, ok, ms);
    if (ok){
      announce(`Right: ${noteName(prompt.pc, pref())}.`);
      right(ms);
    } else {
      announce(`No: it's ${noteName(prompt.pc, pref())}. Press Space to go on.`);
      wrong(ms);
    }
  }

  /* Naming by keyboard: a letter, then a ♯ ("#") or ♭ ("b") if it has one.
     The letter waits a moment for one, then counts as natural; Enter doesn't
     wait. It's timed from the letter, so pausing for the accidental costs
     nothing. A lower-case b straight after a letter is a flat; otherwise
     it's the note B. */
  let pending = null, pendingTimer = 0;
  function clearPending(){ clearTimeout(pendingTimer); pending = null; }
  function commit(){
    if (!pending) return;
    const { pc, at } = pending;
    clearPending();
    answerNote(pc, { timeStamp: at });
  }
  addEventListener("keydown", e => {
    if (!running || state !== "asking" || !prompt || prompt.kind !== "name") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest("input, textarea, select, .settings")) return;
    const k = e.key;
    let text = null;
    if (pending && (k === "#" || k === "b")) text = pending.letter + k;
    else if (/^[a-g]$/i.test(k)) text = k.toUpperCase();
    else if (pending && k === "Enter"){ e.preventDefault(); commit(); return; }
    if (!text) return;
    e.preventDefault();
    const pc = parseNote(text);
    if (text.length === 2){ pending.pc = pc; commit(); return; }
    clearPending();
    pending = { letter: text, pc, at: e.timeStamp };
    pendingTimer = setTimeout(commit, ACCIDENTAL_MS);
    renderAnswers();
  });

  /* After a wrong answer, any tap moves on — except Stop, which stops. The
     tap that moves on does nothing else, so it can't answer the next prompt
     before you've seen it. Space or Enter does the same, wherever focus is,
     the fretboard included: caught before it can tap there. */
  addEventListener("pointerdown", e => {
    if (state !== "reveal") return;
    if (e.target instanceof Element && e.target.closest("#runBtn, .appbar, .neckctl, .settings")) return;
    e.preventDefault();
    e.stopPropagation();
    next();
  }, { capture: true });
  addEventListener("keydown", e => {
    if (state !== "reveal" || (e.key !== " " && e.key !== "Enter")) return;
    if (e.target instanceof Element && e.target.closest("#runBtn, .settings, input")) return;
    e.preventDefault();
    e.stopPropagation();
    next();
  }, { capture: true });

  function start(){
    if (!getInst()) return;
    running = true;
    score = createScore();
    newSession();
    prompt = null;
    next();
    if (running && onChange) onChange(true);
  }

  function stop(){
    clearTimeout(timer);
    clearPending();
    const was = running;
    if (was) handOver(true);
    recorder = null;
    running = false; state = "idle"; prompt = null;
    found = []; misses = []; revealed = false; chosen = null;
    render();
    if (was && onChange) onChange(false);
  }

  $("runBtn").onclick = () => (running ? stop() : start());

  /* Hidden — switched away, locked, or closing — may be the last chance to
     keep the run. It carries on if you come back, and saves over this. */
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && running) handOver(false);
  });

  /* --------------------------------------------------------- the panel */

  function renderPanel(){
    const inst = getInst();
    const s = getSettings();
    const chip = (on, text, sub, onclick, role = "radio") => h("button", {
      class: "chip" + (sub ? " two" : "") + (on ? " sel" : ""), type: "button",
      role, "aria-checked": String(on), onclick,
    }, sub ? [h("b", {}, text), h("i", {}, sub)] : text);

    const kinds = h("div", { class: "pick", role: "radiogroup", "aria-labelledby": "drillKindLabel" },
      DRILL_KINDS.map(k => chip(s.drill === k, DRILLS[k].name, DRILLS[k].blurb, () => {
        saveSettings({ drill: k }); renderPanel(); changed();
      })));

    const allOn = !strings;
    const stringChips = inst ? inst.strings.map((st, i) => {
      const on = allOn || strings.includes(i);
      const b = chip(on, `${stringNumber(i, inst.strings.length)} ${noteName(st.open, s.notePref)}`, null, () => {
        const cur = strings ?? inst.strings.map((_, j) => j);
        const nextSet = on ? cur.filter(j => j !== i) : [...cur, i].sort((a, b) => a - b);
        if (!nextSet.length) return;          // at least one string
        strings = nextSet.length === inst.strings.length ? null : nextSet;
        renderPanel(); changed();
      }, "checkbox");
      label(b, `String ${stringNumber(i, inst.strings.length)}, ${noteName(st.open, s.notePref)}`);
      return b;
    }).reverse() : [];                       // string 1 first, as players count

    const notes = usesNotes(s.drill) ? [
      h("h2", { id: "drillNotesLabel" }, "Notes"),
      h("div", { class: "pick", role: "radiogroup", "aria-labelledby": "drillNotesLabel" },
        [["all", "All notes"], ["naturals", "Naturals only"]].map(([v, t]) =>
          chip(s.drillNotes === v, t, null, () => { saveSettings({ drillNotes: v }); renderPanel(); changed(); }))),
    ] : null;

    // Which intervals come up: at least one.
    const intervals = s.drill === "interval" ? [
      h("h2", {}, "Intervals ", h("span", { class: "hint" }, "tap to leave one out")),
      h("div", { class: "pick" }, INTERVALS.map(iv => {
        const on = s.drillIntervals.includes(iv.semis);
        const b = chip(on, iv.short, null, () => {
          const next = on ? s.drillIntervals.filter(x => x !== iv.semis)
                          : ALL_INTERVALS.filter(x => x === iv.semis || s.drillIntervals.includes(x));
          if (!next.length) return;
          saveSettings({ drillIntervals: next }); renderPanel(); changed();
        }, "checkbox");
        label(b, iv.name);
        return b;
      })),
    ] : null;

    fill($("drillPanel"),
      h("div", { class: "sect" }, h("h2", { id: "drillKindLabel" }, "Drill"), kinds),
      h("div", { class: "sect" },
        h("h2", {}, "Strings ", h("span", { class: "hint" }, "tap to leave one out")),
        h("div", { class: "pick" }, stringChips),
        notes, intervals),
      h("div", { class: "sect" },
        h("p", { class: "note" }, "The frets shown are the practice range: every prompt is in view, " +
          "and the neck past them is dimmed. Change them with − / + and the neck bar at the top. " +
          "Find all on the neck is the exception: it asks about the whole neck, and you move " +
          "along it to find the rest."),
        h("div", { class: "btns" }, h("button", { class: "go", type: "button",
          onclick: () => { closePanel($("drillPanel")); if (!running) start(); } }, running ? "Done" : "Start"))),
    );
    renderStrip();
  }

  /* Filters or drill changed: a run in progress keeps what it has as one
     session and carries on as a new one, from a fresh prompt. */
  function changed(){
    if (!running){ renderStrip(); return; }
    handOver(true);
    newSession();
    prompt = null;
    next();
  }

  $("drillBtn").onclick = () => {
    const panel = $("drillPanel");
    if (isOpen(panel)){ closePanel(panel); return; }
    renderPanel();
    $("drillBtn").setAttribute("aria-expanded", "true");
    openPanel(panel, { opener: $("drillBtn"), onClose: () => $("drillBtn").setAttribute("aria-expanded", "false") });
  };

  renderStrip();

  return {
    get running(){ return running; },
    tap,
    stop,
    /* The frets in view moved or changed size: a new prompt from the new
       range — except on the whole neck, where moving along it is how you
       find the rest, so the prompt stays. */
    rangeChanged(){
      if (!running) return;
      if (prompt && wholeNeck(prompt.kind)) render();
      else { prompt = null; next(); }
    },
    /* A different instrument: its strings aren't these strings. */
    instrumentChanged(){ strings = null; stop(); },
    refresh: render,
  };
}
