/* The drills: what can be asked, making prompts, checking answers, and the
   running score. Pure, like theory.js and instrument.js; the page drives it.

   Every drill draws from the same pool: the playable positions in the frets
   on screen, narrowed by the filters. The frets shown are the practice
   range — zoom in on frets 5–9 and every prompt is in 5–9. */
import { pitchAt, stringNumber } from "./instrument.js";
import {
  pitchClass, isNatural, noteName, degreeName, INTERVALS, intervalNote, CHORDS, SCALES, tones, spell,
} from "./theory.js";

export const DRILLS = Object.freeze({
  findAny:     { name: "Find any",             blurb: "tap the note anywhere in view" },
  findOn:      { name: "Find on a string",     blurb: "tap the note on the string asked" },
  findAll:     { name: "Find all in view",     blurb: "tap every one of the note in view" },
  findAllNeck: { name: "Find all on the neck", blurb: "every one of the note, nut to last fret" },
  name:        { name: "Name the note",        blurb: "say which note is marked" },
  interval:    { name: "Interval",             blurb: "tap the pitch an interval above the root" },
  chord:       { name: "Chord tones",          blurb: "tap every note of the chord in view" },
  scale:       { name: "Scale",                blurb: "tap the scale's notes in view, any order or up" },
  nameInterval: { name: "Name the interval",   blurb: "say which degree of the root the marked fret is" },
});
export const DRILL_KINDS = Object.keys(DRILLS);

/* Most drills ask about the frets on screen. Find all on the neck asks about
   the whole neck, whatever part of it is on screen: finding the rest means
   moving along it. */
export const wholeNeck = kind => kind === "findAllNeck";
export const findsAll = kind => ["findAll", "findAllNeck", "chord", "scale"].includes(kind);

/* The theory drills ask from a root, which can be any note, so the naturals
   filter is the note drills' alone. */
export const usesNotes = kind => !["interval", "chord", "scale", "nameInterval"].includes(kind);

/* The drills answered with buttons, not the board: a fret is marked, and
   you say what it is. */
export const naming = kind => kind === "name" || kind === "nameInterval";

/* What the naming drills' buttons say: note names, or the twelve degrees
   above a root. The value of each is its place in the list, 0–11. */
export const DEGREE_LABELS = Object.freeze(Array.from({ length: 12 }, (_, d) => degreeName(d, 0)));

/* The chord and scale drills draw their types from the library. */
const LIBRARY = { chord: CHORDS, scale: SCALES };

/* The scale types the scale drill asks until told otherwise. */
export const DEFAULT_SCALES = Object.freeze(["major", "minor", "minorPentatonic"]);

/* Every interval, by its semitones: what the interval drill asks by default. */
export const ALL_INTERVALS = Object.freeze(INTERVALS.map(i => i.semis));

/* The chord types the chord drill asks until told otherwise: the three a
   player meets first. */
export const DEFAULT_CHORDS = Object.freeze(["major", "minor", "dom7"]);

/* What can be asked: every playable position in frets [first, last], on the
   strings allowed (null is all), of the notes allowed ("all" or
   "naturals"). */
export function candidates(inst, [first, last], { strings = null, notes = "all" } = {}){
  const out = [];
  inst.strings.forEach((s, i) => {
    if (strings && !strings.includes(i)) return;
    for (let f = first; f <= last; f++){
      const midi = pitchAt(inst, i, f);
      if (midi === null) continue;
      const pc = pitchClass(midi);
      if (notes === "naturals" && !isNatural(pc)) continue;
      out.push({ string: i, fret: f, midi, pc });
    }
  });
  return out;
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];
const samePos = (a, b) => a.string === b.string && a.fret === b.fret;

/* A prompt: what to show, and the positions that answer it (`targets`).
   `last` is the previous prompt, so the same one never comes twice running
   when there's anything else to ask. Returns null when there's nothing to
   ask at all. */
export function makePrompt(kind, cands, { rng = Math.random, last = null, intervals = ALL_INTERVALS,
                                          chords = DEFAULT_CHORDS, scales = DEFAULT_SCALES, root = null,
                                          order = "any" } = {}){
  if (!cands.length) return null;
  if (kind === "interval") return intervalPrompt(cands, { rng, last, intervals });
  if (kind === "chord") return setPrompt("chord", cands, { rng, last, types: chords, root });
  if (kind === "scale") return setPrompt("scale", cands, { rng, last, types: scales, root, order });
  if (kind === "nameInterval") return nameIntervalPrompt(cands, { rng, last, root });
  const pcs = [...new Set(cands.map(c => c.pc))];
  const build = () => {
    if (kind === "name"){
      const at = pick(cands, rng);
      return { kind, pc: at.pc, pos: { string: at.string, fret: at.fret }, targets: [at],
               key: `name:${at.string}:${at.fret}` };
    }
    if (kind === "findOn"){
      // Weighted by position, so a string with more of the range is asked
      // about more; the answer is that note anywhere on the string in view.
      const at = pick(cands, rng);
      return { kind, pc: at.pc, string: at.string,
               targets: cands.filter(c => c.string === at.string && c.pc === at.pc),
               key: `findOn:${at.string}:${at.pc}` };
    }
    // findAny and the find-alls: a note, chosen evenly among the notes in
    // range, so one that appears once isn't asked about less than one that
    // appears six times.
    const pc = pick(pcs, rng);
    return { kind, pc, targets: cands.filter(c => c.pc === pc), key: `${kind}:${pc}` };
  };
  let p = build();
  for (let tries = 0; last && p.key === last.key && tries < 12; tries++) p = build();
  return p;
}

/* An interval prompt: a root in range, and an interval above it whose exact
   pitch is also in range — that pitch, not any octave of its note, is the
   answer, wherever on the neck it can be played in view. The interval is
   chosen evenly among those that can be asked, then the root among the
   places it can be asked from, so a wide interval that fits only a few
   roots comes up as often as a narrow one. */
function intervalPrompt(cands, { rng, last, intervals }){
  const at = new Map();
  for (const c of cands){
    if (!at.has(c.midi)) at.set(c.midi, []);
    at.get(c.midi).push(c);
  }
  const askable = new Map();          // semis → roots it can be asked from
  for (const semis of intervals){
    const roots = cands.filter(c => at.has(c.midi + semis));
    if (roots.length) askable.set(semis, roots);
  }
  if (!askable.size) return null;
  const build = () => {
    const semis = pick([...askable.keys()], rng);
    const root = pick(askable.get(semis), rng);
    const targets = at.get(root.midi + semis);
    return {
      kind: "interval", semis, pc: targets[0].pc,
      root: { string: root.string, fret: root.fret }, rootPc: root.pc,
      targets, key: `interval:${root.string}:${root.fret}:${semis}`,
    };
  };
  let p = build();
  for (let tries = 0; last && p.key === last.key && tries < 12; tries++) p = build();
  return p;
}

/* A chord or scale prompt: a type from those chosen and a root, random
   unless fixed, and every place in view that plays one of its notes. Only
   a set whose every note is somewhere in view is asked — "every note of
   A7" with no G in sight can't be answered. The type is chosen evenly
   first, then the root.

   A scale can be asked `order: "up"`: once each pitch in view, lowest to
   highest. Then `steps` are those pitches, and any place that plays the
   next one counts for it. */
function setPrompt(kind, cands, { rng, last, types, root, order = "any" }){
  const lib = LIBRARY[kind];
  const inView = new Set(cands.map(c => c.pc));
  const roots = root == null ? [...Array(12).keys()] : [root];
  const askable = new Map();          // type → roots it can be asked on
  for (const id of types){
    const ok = roots.filter(r => tones(r, lib[id].formula).every(pc => inView.has(pc)));
    if (ok.length) askable.set(id, ok);
  }
  if (!askable.size) return null;
  const build = () => {
    const type = pick([...askable.keys()], rng);
    const rootPc = pick(askable.get(type), rng);
    const ts = tones(rootPc, lib[type].formula);
    const targets = cands.filter(c => ts.includes(c.pc));
    const p = { kind, type, rootPc, tones: ts, targets, order: "any", key: `${kind}:${rootPc}:${type}` };
    if (kind === "scale" && order === "up"){
      p.order = "up";
      p.steps = [...new Set(targets.map(t => t.midi))].sort((a, b) => a - b);
    }
    return p;
  };
  let p = build();
  for (let tries = 0; last && p.key === last.key && tries < 12; tries++) p = build();
  return p;
}

/* A name-the-interval prompt: a root, random unless its note is fixed, and
   another place in view to name by its degree above the root — counted by
   pitch class, in any octave, as study labels the neck. The degree is
   chosen evenly among those in view, then a root and a place that make it. */
function nameIntervalPrompt(cands, { rng, last, root }){
  const roots = root == null ? cands : cands.filter(c => c.pc === root);
  const byDegree = new Map();         // degree → [root, marked] pairs
  for (const r of roots) for (const t of cands){
    if (samePos(r, t)) continue;
    const d = pitchClass(t.midi - r.midi);
    if (!byDegree.has(d)) byDegree.set(d, []);
    byDegree.get(d).push([r, t]);
  }
  if (!byDegree.size) return null;
  const build = () => {
    const degree = pick([...byDegree.keys()], rng);
    const [r, t] = pick(byDegree.get(degree), rng);
    return {
      kind: "nameInterval", degree, pc: t.pc, rootPc: r.pc,
      root: { string: r.string, fret: r.fret }, pos: { string: t.string, fret: t.fret }, targets: [t],
      key: `nameInterval:${r.string}:${r.fret}:${t.string}:${t.fret}`,
    };
  };
  let p = build();
  for (let tries = 0; last && p.key === last.key && tries < 12; tries++) p = build();
  return p;
}

/* How many right answers complete a find-all prompt: every target, or for
   a scale going up, every step. */
export const needed = p => p.order === "up" ? p.steps.length : p.targets.length;

/* What an answer is called. An interval's note is spelled from its root,
   and a chord's or scale's notes for it, so a major 3rd above A is C♯, and
   so is the 3rd of A major, whatever the preference; the note drills' by
   the preference. `pc` is which of a chord's or scale's notes. */
export function answerName(p, pref, pc = p.pc){
  if (p.kind === "interval") return intervalNote(p.rootPc, p.semis, pref).name;
  if (p.kind === "nameInterval") return DEGREE_LABELS[p.degree];
  if (LIBRARY[p.kind]) return spell(p.rootPc, LIBRARY[p.kind][p.type].formula, pref).find(n => n.pc === pc).name;
  return noteName(pc, pref);
}

/* The words for a prompt. `inst` names the string for findOn by its number
   and open note, which is unambiguous even on a guitar's two E strings. The
   find-alls say how far along you are, once you've found any. */
export function promptText(p, inst, pref, found = 0){
  const note = noteName(p.pc, pref);
  if (p.kind === "findOn"){
    const s = inst.strings[p.string];
    return `${note} on string ${stringNumber(p.string, inst.strings.length)} (${noteName(s.open, pref)})`;
  }
  if (LIBRARY[p.kind]){
    const set = LIBRARY[p.kind][p.type];
    const root = spell(p.rootPc, set.formula, pref)[0].name;
    return `${root} ${set.name}${p.order === "up" ? ", going up" : ""}` + (found ? ` · ${found} of ${needed(p)}` : "");
  }
  if (findsAll(p.kind)){
    const where = p.kind === "findAllNeck" ? " on the neck" : "";
    return `Every ${note}${where}` + (found ? ` · ${found} of ${p.targets.length}` : "");
  }
  if (p.kind === "name") return "Name this note";
  // A degree, not a distance: the marked note may be below the root, and
  // it's that note's place in the root's key that's asked, in any octave.
  if (p.kind === "nameInterval") return `What degree of ${noteName(p.rootPc, pref)}?`;
  if (p.kind === "interval"){
    const iv = INTERVALS.find(i => i.semis === p.semis);
    return `${iv.name[0].toUpperCase()}${iv.name.slice(1)} above ${noteName(p.rootPc, pref)}`;
  }
  return note;
}

/* Is this tap (a position) or this choice (a pitch class) right? `found`
   is what a find-all prompt has had so far: going up a scale, a tap is
   right only if it plays the next pitch. */
export function isRight(p, answer, found = []){
  if (p.kind === "name") return pitchClass(answer) === p.pc;
  if (p.kind === "nameInterval") return pitchClass(answer) === p.degree;
  const t = p.targets.find(t => samePos(t, answer));
  if (!t) return false;
  return p.order === "up" ? t.midi === p.steps[found.length] : true;
}

/* ------------------------------------------------------------- scoring */

/* Answers slower than this count for accuracy but not time: a distraction,
   not a slow find. */
export const SLOW_MS = 15000;

/* The running score for one run: every answer counts toward accuracy; right
   answers under SLOW_MS toward the typical time, which is the geometric mean —
   response times have a long slow tail, and this sits near the median. */
export function createScore(){
  let n = 0, right = 0, timed = 0, sumLn = 0;
  return {
    add(ok, ms){
      n++;
      if (!ok) return;
      right++;
      if (ms > 0 && ms < SLOW_MS){ timed++; sumLn += Math.log(ms); }
    },
    get answers(){ return n; },
    get accuracy(){ return n ? right / n : null; },
    get typicalMs(){ return timed ? Math.exp(sumLn / timed) : null; },
  };
}

/* "92% · 1.4s · 25", or less while there's too little to say. */
export function scoreText(s){
  if (!s.answers) return "";
  const parts = [`${Math.round(s.accuracy * 100)}%`];
  if (s.typicalMs !== null) parts.push(`${(s.typicalMs / 1000).toFixed(1)}s`);
  parts.push(String(s.answers));
  return parts.join(" · ");
}
