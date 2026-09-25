/* The instrument model. Pure: no DOM and no storage, so it is shared by the
   editor, the fretboard, the drills and import validation, and tested directly.

   Strings are listed in PHYSICAL order, from the string nearest the player's
   face to the one nearest the floor, not in pitch order. On most instruments
   those agree; on a ukulele's re-entrant high G or a banjo's short drone string
   they don't, and the fretboard has to draw strings where they actually are.

   Each string is { open, start }:
     open  - the pitch it sounds unfretted, as a MIDI number
     start - the fret its nut sits at: 0 normally, 5 for a banjo's fifth string.
             It is only playable from there up, and fretting it at `start + n`
             sounds `open + n`. */
import { parsePitch, pitchName } from "./theory.js";

export const MAX_STRINGS = 12;
export const MAX_FRETS   = 36;
export const MAX_NAME    = 40;

/* What a new instrument starts as. Standard-tuned guitar is the most likely
   thing someone is holding; everything about it is editable. */
export const DEFAULT_TUNING = ["E2", "A2", "D3", "G3", "B3", "E4"];
export const DEFAULT_FRETS  = 22;

export function newInstrument(fields = {}, now = Date.now()){
  return {
    id: crypto.randomUUID(),
    name: "Guitar",
    strings: DEFAULT_TUNING.map(t => ({ open: parsePitch(t), start: 0 })),
    frets: DEFAULT_FRETS,
    leftHanded: false,
    /* Off: the string nearest your face is drawn at the top, as you see it
       looking down at the neck. On: flipped, the way tab and most diagrams
       draw it, with the floor-side string at the top. */
    tabView: false,
    ...fields,
    created: now,
    updated: now,
  };
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/* Every reason x is not a usable instrument; empty when it is. Used on load
   and on import, where anything could be in the data, so it assumes nothing. */
export function validate(x){
  if (!x || typeof x !== "object") return ["not an object"];
  const errs = [];
  if (typeof x.id !== "string" || !x.id) errs.push("id missing");
  if (typeof x.name !== "string" || !x.name.trim()) errs.push("name missing");
  else if (x.name.length > MAX_NAME) errs.push(`name over ${MAX_NAME} characters`);
  if (!isInt(x.frets, 1, MAX_FRETS)) errs.push(`frets not 1–${MAX_FRETS}`);
  if (!Array.isArray(x.strings) || x.strings.length < 1 || x.strings.length > MAX_STRINGS){
    errs.push(`strings not 1–${MAX_STRINGS}`);
  } else {
    x.strings.forEach((s, i) => {
      if (!s || !isInt(s.open, 0, 127)) errs.push(`string ${i + 1}: pitch not 0–127`);
      else if (!isInt(s.start, 0, isInt(x.frets, 1, MAX_FRETS) ? x.frets - 1 : MAX_FRETS - 1)){
        errs.push(`string ${i + 1}: first fret out of range`);
      }
    });
  }
  for (const k of ["leftHanded", "tabView"]){
    if (typeof x[k] !== "boolean") errs.push(`${k} not true/false`);
  }
  for (const k of ["created", "updated"]){
    if (!Number.isFinite(x[k])) errs.push(`${k} missing`);
  }
  return errs;
}

/* The pitch at a position, or null if that string can't be played there. */
export function pitchAt(inst, string, fret){
  const s = inst.strings[string];
  if (!s || !Number.isInteger(fret) || fret < s.start || fret > inst.frets) return null;
  return s.open + fret - s.start;
}

/* The number a player calls a string. Players count from the floor side: a
   guitar's high E is string 1 and its low E string 6. `index` is physical
   order, face side first, so the two run in opposite directions. */
export const stringNumber = (index, count) => count - index;

/* "E2 A2 D3 G3 B3 E4 · 22 frets". */
export function summary(inst, pref = "sharp"){
  const tuning = inst.strings.map(s => pitchName(s.open, pref)).join(" ");
  return `${tuning} · ${inst.frets} fret${inst.frets === 1 ? "" : "s"}`;
}
