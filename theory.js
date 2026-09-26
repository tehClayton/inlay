/* Pitch and note names. Pure functions, no DOM, so the tests import this
   directly.

   A pitch is a MIDI number (C4 = 60, the octave numbering most tuners and
   tabs use: E2 is a guitar's low string). A pitch class is 0–11 with C = 0:
   it is what "find a C" means, in any octave. Everything the app compares is
   a number; letters exist only on the way in and on the way out. */

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/* Display spellings use the real sharp and flat signs. The ASCII forms are
   accepted on the way in, since that is what people type. */
export const SHARP = "♯";   // ♯
export const FLAT  = "♭";   // ♭

const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT_NAMES  = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

/* The accidental preference setting: which spelling a black key gets. */
export const NOTE_PREFS = ["sharp", "flat", "both"];

export const NATURALS = [0, 2, 4, 5, 7, 9, 11];

export const pitchClass = midi => ((midi % 12) + 12) % 12;
export const octave     = midi => Math.floor(midi / 12) - 1;
export const isNatural  = pc => NATURALS.includes(pitchClass(pc));

/* The name of a pitch class under a preference. With "both", a black key reads
   "C♯/D♭"; naturals are always a single letter. */
export function noteName(pc, pref = "sharp"){
  const p = pitchClass(pc);
  if (pref === "flat") return FLAT_NAMES[p];
  if (pref === "both" && !isNatural(p)) return `${SHARP_NAMES[p]}/${FLAT_NAMES[p]}`;
  return SHARP_NAMES[p];
}

/* A pitch with its octave, for tunings: "E2", "C♯4". "both" would make a
   tuning unreadable ("C♯/D♭4"), so it spells sharp here. */
export function pitchName(midi, pref = "sharp"){
  return noteName(midi, pref === "flat" ? "flat" : "sharp") + octave(midi);
}

/* Letter, then any accidentals, then (for a pitch) an octave. Case-insensitive
   letter; accidentals as #, ♯, b or ♭, and doubles are allowed, so B# and Cb
   are valid spellings of C and B. The first character is always the letter,
   which is what keeps "bb" (B flat) unambiguous. */
const NOTE_RE = /^\s*([A-Ga-g])([#♯b♭]*)\s*(-?\d+)?\s*$/;

function parse(text){
  const m = NOTE_RE.exec(String(text));
  if (!m) return null;
  let shift = 0;
  for (const a of m[2]) shift += (a === "#" || a === "♯") ? 1 : -1;
  return { base: LETTER_PC[m[1].toUpperCase()], shift, oct: m[3] };
}

/* "F#", "Gb", "g♭" → 6. Returns null for anything that isn't a note name,
   including a name with an octave: that is a pitch, not a pitch class. */
export function parseNote(text){
  const n = parse(text);
  if (!n || n.oct !== undefined) return null;
  return pitchClass(n.base + n.shift);
}

/* "E2" → 40, "C#4" → 61. The accidental moves the pitch, not the octave
   label, so Cb4 is B3 (59) and B#3 is C4 (60), as in scientific notation.
   Returns null without an octave or outside MIDI's 0–127. */
export function parsePitch(text){
  const n = parse(text);
  if (!n || n.oct === undefined) return null;
  const midi = (Number(n.oct) + 1) * 12 + n.base + n.shift;
  return midi >= 0 && midi <= 127 ? midi : null;
}
