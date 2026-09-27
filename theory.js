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

/* Scale-degree labels: a pitch class named by its distance above a root, as
   players say it. The tritone is both, being as often one as the other. */
const DEGREES = ["1", "♭2", "2", "♭3", "3", "4", "♯4/♭5", "5", "♭6", "6", "♭7", "7"];
export const degreeName = (pc, root) => DEGREES[pitchClass(pc - root)];

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

/* ------------------------------------------------------------ the library */
/* Scales and chords are written as players write them, a formula of degrees
   against the major scale: "1 2 ♭3 4 5 ♭6 ♭7" is natural minor. The
   semitones come from the formula, and so does the spelling: each degree
   takes its own letter, so F major has B♭, not A♯, whatever the accidental
   preference says. The library is fixed in v1; there is no formula builder. */
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

export const INTERVALS = Object.freeze([
  { semis: 1,  name: "minor 2nd",   short: "m2", degree: 2 },
  { semis: 2,  name: "major 2nd",   short: "M2", degree: 2 },
  { semis: 3,  name: "minor 3rd",   short: "m3", degree: 3 },
  { semis: 4,  name: "major 3rd",   short: "M3", degree: 3 },
  { semis: 5,  name: "perfect 4th", short: "P4", degree: 4 },
  { semis: 6,  name: "tritone",     short: "TT", degree: 4 },   // spelled as an augmented 4th
  { semis: 7,  name: "perfect 5th", short: "P5", degree: 5 },
  { semis: 8,  name: "minor 6th",   short: "m6", degree: 6 },
  { semis: 9,  name: "major 6th",   short: "M6", degree: 6 },
  { semis: 10, name: "minor 7th",   short: "m7", degree: 7 },
  { semis: 11, name: "major 7th",   short: "M7", degree: 7 },
  { semis: 12, name: "octave",      short: "P8", degree: 8 },
]);

export const SCALES = Object.freeze({
  major:           { name: "major",            formula: "1 2 3 4 5 6 7", aka: "ionian" },
  minor:           { name: "natural minor",    formula: "1 2 ♭3 4 5 ♭6 ♭7", aka: "aeolian" },
  harmonicMinor:   { name: "harmonic minor",   formula: "1 2 ♭3 4 5 ♭6 7" },
  melodicMinor:    { name: "melodic minor",    formula: "1 2 ♭3 4 5 6 7" },
  dorian:          { name: "dorian",           formula: "1 2 ♭3 4 5 6 ♭7" },
  phrygian:        { name: "phrygian",         formula: "1 ♭2 ♭3 4 5 ♭6 ♭7" },
  lydian:          { name: "lydian",           formula: "1 2 3 ♯4 5 6 7" },
  mixolydian:      { name: "mixolydian",       formula: "1 2 3 4 5 6 ♭7" },
  locrian:         { name: "locrian",          formula: "1 ♭2 ♭3 4 ♭5 ♭6 ♭7" },
  majorPentatonic: { name: "major pentatonic", formula: "1 2 3 5 6" },
  minorPentatonic: { name: "minor pentatonic", formula: "1 ♭3 4 5 ♭7" },
  blues:           { name: "blues",            formula: "1 ♭3 4 ♭5 5 ♭7" },
});

/* A double flat is written ♭♭ rather than 𝄫, which too few fonts have. */
export const CHORDS = Object.freeze({
  major:   { name: "major",           symbol: "",     formula: "1 3 5" },
  minor:   { name: "minor",           symbol: "m",    formula: "1 ♭3 5" },
  dim:     { name: "diminished",      symbol: "dim",  formula: "1 ♭3 ♭5" },
  aug:     { name: "augmented",       symbol: "aug",  formula: "1 3 ♯5" },
  maj7:    { name: "major 7",         symbol: "maj7", formula: "1 3 5 7" },
  dom7:    { name: "dominant 7",      symbol: "7",    formula: "1 3 5 ♭7" },
  min7:    { name: "minor 7",         symbol: "m7",   formula: "1 ♭3 5 ♭7" },
  halfDim: { name: "half-diminished", symbol: "m7♭5", formula: "1 ♭3 ♭5 ♭7" },
  dim7:    { name: "diminished 7",    symbol: "dim7", formula: "1 ♭3 ♭5 ♭♭7" },
  sus2:    { name: "sus2",            symbol: "sus2", formula: "1 2 5" },
  sus4:    { name: "sus4",            symbol: "sus4", formula: "1 4 5" },
});

/* A formula's degrees: [{ label, degree, semis }], semis above the root. */
export function degrees(formula){
  return formula.trim().split(/\s+/).map(label => {
    const m = /^([♭♯]*)(\d+)$/.exec(label);
    if (!m) throw new Error(`not a degree: ${label}`);
    let shift = 0;
    for (const a of m[1]) shift += a === "♯" ? 1 : -1;
    const degree = Number(m[2]);
    return { label, degree, semis: MAJOR[(degree - 1) % 7] + 12 * Math.floor((degree - 1) / 7) + shift };
  });
}

/* The pitch classes a formula makes over a root, in formula order. */
export const tones = (root, formula) => degrees(formula).map(d => pitchClass(root + d.semis));

const accidentals = n => (n > 0 ? SHARP : FLAT).repeat(Math.abs(n));

/* A formula's notes over a root whose letter is given, each on its own letter. */
function spellFrom(root, letter, formula){
  const at = LETTERS.indexOf(letter);
  return degrees(formula).map(d => {
    const l = LETTERS[(at + d.degree - 1) % 7];
    // The step from the letter's natural pitch to the note's, -6..5.
    const off = pitchClass(root + d.semis - LETTER_PC[l] + 6) - 6;
    return { pc: pitchClass(root + d.semis), name: l + accidentals(off), label: d.label, off };
  });
}

/* The notes of a formula over a root, spelled for the key: [{ pc, name,
   label }]. A root on a black key could be either of two letters; it takes
   whichever needs fewer accidentals across the notes — D♭ major, not C♯
   major; C♯ minor, not D♭ minor — and on a tie, the accidental preference. */
export function spell(root, formula, pref = "sharp"){
  const r = pitchClass(root);
  const letters = isNatural(r) ? [SHARP_NAMES[r]]
    : [SHARP_NAMES[r][0], FLAT_NAMES[r][0]];
  const options = letters.map(l => spellFrom(r, l, formula));
  const cost = o => o.reduce((a, n) => a + Math.abs(n.off), 0);
  // A tie goes to the preference: a sharp root has off 1, a flat one -1.
  options.sort((a, b) => cost(a) - cost(b) || (pref === "flat" ? 1 : -1) * (a[0].off - b[0].off));
  return options[0].map(({ pc, name, label }) => ({ pc, name, label }));
}

/* "D dorian", "F♯m7♭5": a scale or chord by name, its root spelled for it. */
export const scaleName = (root, id, pref) => `${spell(root, SCALES[id].formula, pref)[0].name} ${SCALES[id].name}`;
export const chordName = (root, id, pref) => `${spell(root, CHORDS[id].formula, pref)[0].name}${CHORDS[id].symbol}`;

/* The interval `semis` above a root, spelled: the note a "major 3rd above
   A" prompt is asking for is C♯, not D♭. */
export function intervalNote(root, semis, pref = "sharp"){
  const iv = INTERVALS.find(i => i.semis === semis);
  const up = semis % 12;
  const label = `${up - MAJOR[(iv.degree - 1) % 7] > 0 ? SHARP : up - MAJOR[(iv.degree - 1) % 7] < 0 ? FLAT : ""}${iv.degree}`;
  return spell(root, `1 ${label}`, pref)[1];
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
