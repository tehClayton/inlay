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
import { $, h, label, say, openPanel, closePanel, isOpen } from "./ui.js";
import {
  DRILLS, DRILL_KINDS, candidates, makePrompt, promptText, isRight, createScore, scoreText,
  wholeNeck, findsAll,
} from "./drills.js";
import { fretRange, stringNumber, pitchAt } from "./instrument.js";
import { noteName } from "./theory.js";

const NEXT_MS = 400;         // after a right answer, before the next prompt

/* `board` is the fretboard; `getInst` and `getFrom` say what's on it;
   `getSettings`/`saveSettings` hold the drill choice; `onChange` is told when
   a run starts or stops, so the page can put its idle state back. */
export function createPractice({ board, getInst, getFrom, getSettings, saveSettings, onChange }){
  let running = false, state = "idle";   // idle | asking | between | reveal
  let prompt = null, cands = [], score = createScore(), t0 = 0, timer = 0;
  let found = [], misses = [], revealed = false, chosen = null;   // chosen: an answer button pressed
  let strings = null;                     // the strings filter, null for all; not stored

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
    if (prompt.kind === "name"){
      board.mark(prompt.pos, revealed ? "target" : (state === "between" ? "true" : "target"),
                 revealed || state === "between" ? noteName(prompt.pc, pref()) : "?");
    }
    for (const f of found) board.mark(f, "true", name(f));
    for (const m of misses) board.mark(m, "miss", name(m));
    if (revealed && prompt.kind !== "name"){
      for (const t of prompt.targets) if (!found.some(f => f.string === t.string && f.fret === t.fret)){
        board.mark(t, "target", name(t));
      }
    }
  }

  function renderAnswers(){
    const row = $("answers");
    const show = running && prompt && prompt.kind === "name";
    row.hidden = !show;
    if (!show) return;
    row.replaceChildren(...Array.from({ length: 12 }, (_, pc) => {
      let cls = "ans";
      if (state !== "asking" && chosen !== null){
        if (pc === prompt.pc) cls += " right";
        else if (pc === chosen) cls += " wrong";
      }
      return h("button", { class: cls, type: "button", "data-pc": String(pc),
        onpointerdown: e => { e.preventDefault(); answerNote(pc, e); } }, noteName(pc, pref()));
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
      $("prompt").replaceChildren(h("b", {}, promptText(prompt, getInst(), pref(), found.length)));
    }
  }

  const render = () => { paint(); renderAnswers(); renderStrip(); };

  /* ------------------------------------------------------------ the loop */

  function pool(){
    const inst = getInst();
    if (!inst) return [];
    const range = wholeNeck(kind()) ? [0, inst.frets] : windowRange();
    return candidates(inst, range, { strings, notes: getSettings().drillNotes });
  }

  function next(){
    clearTimeout(timer);
    cands = pool();
    if (!cands.length){
      stop();
      say("Nothing to ask here: widen the frets shown or the drill's filters.");
      return;
    }
    prompt = makePrompt(kind(), cands, { last: prompt });
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
        t0 = e.timeStamp;                  // each find timed from the last
        if (found.length === prompt.targets.length){
          state = "between";
          render();
          timer = setTimeout(next, NEXT_MS);
        } else render();
      } else {
        // A miss counts, and shows, but doesn't end the prompt.
        score.add(false, ms);
        misses = [pos];
        render();
      }
      return;
    }
    if (ok){ found = [pos]; right(ms); }
    else { misses = [pos]; wrong(ms); }
  }

  function answerNote(pc, e){
    if (!running || state !== "asking") return;
    chosen = pc;
    if (isRight(prompt, pc)) right(since(e));
    else wrong(since(e));
  }

  /* After a wrong answer, any tap moves on — except Stop, which stops. The
     tap that moves on does nothing else, so it can't answer the next prompt
     before you've seen it. */
  addEventListener("pointerdown", e => {
    if (state !== "reveal") return;
    if (e.target instanceof Element && e.target.closest("#runBtn, .appbar, .neckctl, .settings")) return;
    e.preventDefault();
    e.stopPropagation();
    next();
  }, { capture: true });
  addEventListener("keydown", e => {
    if (state === "reveal" && (e.key === " " || e.key === "Enter")){ e.preventDefault(); next(); }
  });

  function start(){
    if (!getInst()) return;
    running = true;
    score = createScore();
    prompt = null;
    next();
    if (running && onChange) onChange(true);
  }

  function stop(){
    clearTimeout(timer);
    const was = running;
    running = false; state = "idle"; prompt = null;
    found = []; misses = []; revealed = false; chosen = null;
    render();
    if (was && onChange) onChange(false);
  }

  $("runBtn").onclick = () => (running ? stop() : start());

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

    const notes = h("div", { class: "pick", role: "radiogroup", "aria-labelledby": "drillNotesLabel" },
      [["all", "All notes"], ["naturals", "Naturals only"]].map(([v, t]) =>
        chip(s.drillNotes === v, t, null, () => { saveSettings({ drillNotes: v }); renderPanel(); changed(); })));

    $("drillPanel").replaceChildren(
      h("div", { class: "sect" }, h("h2", { id: "drillKindLabel" }, "Drill"), kinds),
      h("div", { class: "sect" },
        h("h2", {}, "Strings ", h("span", { class: "hint" }, "tap to leave one out")),
        h("div", { class: "pick" }, stringChips),
        h("h2", { id: "drillNotesLabel" }, "Notes"), notes),
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

  /* Filters or drill changed: a run in progress starts a fresh prompt. */
  function changed(){ if (running) { prompt = null; next(); } else renderStrip(); }

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
