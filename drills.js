/* The drills: what can be asked, making prompts, checking answers, and the
   running score. Pure, like theory.js and instrument.js; the page drives it.

   Every drill draws from the same pool: the playable positions in the frets
   on screen, narrowed by the filters. The frets shown are the practice
   range — zoom in on frets 5–9 and every prompt is in 5–9. */
import { pitchAt, stringNumber } from "./instrument.js";
import { pitchClass, isNatural, noteName } from "./theory.js";

export const DRILLS = Object.freeze({
  findAny:  { name: "Find any",          blurb: "tap the note anywhere in view" },
  findOn:   { name: "Find on a string",  blurb: "tap the note on the string asked" },
  findAll:  { name: "Find all",          blurb: "tap every one of the note in view" },
  name:     { name: "Name the note",     blurb: "say which note is marked" },
});
export const DRILL_KINDS = Object.keys(DRILLS);

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
export function makePrompt(kind, cands, { rng = Math.random, last = null } = {}){
  if (!cands.length) return null;
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
    // findAny and findAll: a note, chosen evenly among the notes in range, so
    // one that appears once isn't asked about less than one that appears six
    // times.
    const pc = pick(pcs, rng);
    return { kind, pc, targets: cands.filter(c => c.pc === pc), key: `${kind}:${pc}` };
  };
  let p = build();
  for (let tries = 0; last && p.key === last.key && tries < 12; tries++) p = build();
  return p;
}

/* The words for a prompt. `inst` names the string for findOn by its number
   and open note, which is unambiguous even on a guitar's two E strings. */
export function promptText(p, inst, pref){
  const note = noteName(p.pc, pref);
  if (p.kind === "findOn"){
    const s = inst.strings[p.string];
    return `${note} on string ${stringNumber(p.string, inst.strings.length)} (${noteName(s.open, pref)})`;
  }
  if (p.kind === "findAll") return `Every ${note}`;
  if (p.kind === "name") return "Name this note";
  return note;
}

/* Is this tap (a position) or this choice (a pitch class) right? */
export function isRight(p, answer){
  if (p.kind === "name") return pitchClass(answer) === p.pc;
  return p.targets.some(t => samePos(t, answer));
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
