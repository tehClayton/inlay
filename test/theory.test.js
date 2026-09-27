import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pitchClass, octave, isNatural, noteName, pitchName, parseNote, parsePitch, degreeName,
  INTERVALS, SCALES, CHORDS, degrees, tones, spell, scaleName, chordName, intervalNote,
} from "../theory.js";

const C = 0, Db = 1, D = 2, Eb = 3, E = 4, F = 5, Gb = 6, G = 7, Ab = 8, A = 9, Bb = 10, B = 11;
const names = (root, f, pref) => spell(root, f, pref).map(n => n.name).join(" ");

test("the library has what DESIGN.md lists", () => {
  assert.deepEqual(INTERVALS.map(i => i.semis), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(Object.keys(SCALES), ["major", "minor", "harmonicMinor", "melodicMinor", "dorian",
    "phrygian", "lydian", "mixolydian", "locrian", "majorPentatonic", "minorPentatonic", "blues"]);
  assert.deepEqual(Object.keys(CHORDS), ["major", "minor", "dim", "aug", "maj7", "dom7", "min7",
    "halfDim", "dim7", "sus2", "sus4"]);
});

test("formulas give their semitones", () => {
  assert.deepEqual(degrees(SCALES.major.formula).map(d => d.semis), [0, 2, 4, 5, 7, 9, 11]);
  assert.deepEqual(degrees(SCALES.blues.formula).map(d => d.semis), [0, 3, 5, 6, 7, 10]);
  assert.deepEqual(degrees(CHORDS.dim7.formula).map(d => d.semis), [0, 3, 6, 9]);
  assert.deepEqual(degrees("1 9").map(d => d.semis), [0, 14]);
  assert.throws(() => degrees("1 x3"));
});

test("every scale and chord, over every root, is twelve-tone sound", () => {
  for (const lib of [SCALES, CHORDS]) for (const { formula } of Object.values(lib)) for (let r = 0; r < 12; r++){
    const ts = tones(r, formula);
    assert.equal(ts[0], r);
    assert.equal(new Set(ts).size, ts.length, `${formula} over ${r} repeats a note`);
    // The spelling names the same notes.
    assert.deepEqual(spell(r, formula).map(n => n.pc), ts);
    assert.deepEqual(spell(r, formula).map(n => parseNote(n.name)), ts);
  }
});

test("spelled for the key: F major has B♭, not A♯", () => {
  assert.equal(names(F, SCALES.major.formula), "F G A B♭ C D E");
  assert.equal(names(F, SCALES.major.formula, "sharp"), "F G A B♭ C D E");
  assert.equal(names(E, SCALES.harmonicMinor.formula), "E F♯ G A B C D♯");
  assert.equal(names(D, SCALES.dorian.formula), "D E F G A B C");
  assert.equal(names(A, SCALES.minorPentatonic.formula), "A C D E G");
  assert.equal(names(A, SCALES.blues.formula), "A C D E♭ E G");
});

test("each seven-note scale uses each letter once", () => {
  for (const [id, { formula }] of Object.entries(SCALES)){
    if (degrees(formula).length !== 7) continue;
    for (let r = 0; r < 12; r++){
      const letters = spell(r, formula).map(n => n.name[0]);
      assert.equal(new Set(letters).size, 7, `${id} over ${r}: ${letters.join(" ")}`);
    }
  }
});

test("a black-key root takes the spelling with fewer accidentals", () => {
  assert.equal(names(Db, SCALES.major.formula), "D♭ E♭ F G♭ A♭ B♭ C");      // not C♯ major's seven sharps
  assert.equal(names(Db, SCALES.minor.formula), "C♯ D♯ E F♯ G♯ A B");       // not D♭ minor's B♭♭
  assert.equal(names(Ab, SCALES.major.formula, "sharp"), "A♭ B♭ C D♭ E♭ F G");
});

test("on a tie, the accidental preference decides", () => {
  assert.equal(spell(Gb, SCALES.major.formula, "sharp")[0].name, "F♯");
  assert.equal(spell(Gb, SCALES.major.formula, "flat")[0].name, "G♭");
});

test("chords: doubles where the harmony needs them", () => {
  assert.equal(names(C, CHORDS.dim7.formula), "C E♭ G♭ B♭♭");
  assert.equal(names(G, CHORDS.dom7.formula), "G B D F");
  assert.equal(names(Gb, CHORDS.halfDim.formula, "sharp"), "F♯ A C E");
  assert.equal(names(C, CHORDS.aug.formula), "C E G♯");
});

test("names read as players say them", () => {
  assert.equal(scaleName(D, "dorian"), "D dorian");
  assert.equal(scaleName(Db, "major"), "D♭ major");
  assert.equal(chordName(A, "minor"), "Am");
  assert.equal(chordName(Gb, "halfDim", "sharp"), "F♯m7♭5");
  assert.equal(chordName(Bb, "major", "sharp"), "B♭");
});

test("the note an interval above a root asks for, spelled", () => {
  assert.equal(intervalNote(A, 4).name, "C♯");        // major 3rd above A
  assert.equal(intervalNote(A, 3).name, "C");         // minor 3rd above A
  assert.equal(intervalNote(C, 6).name, "F♯");        // the tritone, as an augmented 4th
  assert.equal(intervalNote(E, 1).name, "F");
  assert.equal(intervalNote(Bb, 7, "sharp").name, "F");
  assert.equal(intervalNote(G, 12).name, "G");
  for (const iv of INTERVALS) for (let r = 0; r < 12; r++){
    assert.equal(intervalNote(r, iv.semis).pc, pitchClass(r + iv.semis));
  }
});

test("degree names: the distance above a root, whatever octave either is in", () => {
  assert.equal(degreeName(9, 9), "1");            // A over A
  assert.equal(degreeName(0, 9), "♭3");           // C over A
  assert.equal(degreeName(4, 9), "5");            // E over A
  assert.equal(degreeName(3, 9), "♯4/♭5");        // D♯ over A
  assert.equal(degreeName(8, 9), "7");            // G♯ over A
  assert.equal(degreeName(64, 4), "1");           // E4 over E, a MIDI number works too
  const all = Array.from({ length: 12 }, (_, i) => degreeName(i, 0));
  assert.deepEqual(all, ["1", "♭2", "2", "♭3", "3", "4", "♯4/♭5", "5", "♭6", "6", "♭7", "7"]);
});

test("pitch class and octave follow MIDI, C4 = 60", () => {
  assert.equal(pitchClass(60), 0);
  assert.equal(octave(60), 4);
  assert.equal(pitchClass(40), 4);   // E2, a guitar's low string
  assert.equal(octave(40), 2);
  assert.equal(pitchClass(-1), 11);  // wraps, never negative
  assert.equal(octave(0), -1);
});

test("naturals are the white keys", () => {
  assert.deepEqual([...Array(12).keys()].filter(isNatural), [0, 2, 4, 5, 7, 9, 11]);
});

test("note names follow the accidental preference", () => {
  assert.equal(noteName(1, "sharp"), "C♯");
  assert.equal(noteName(1, "flat"), "D♭");
  assert.equal(noteName(1, "both"), "C♯/D♭");
  assert.equal(noteName(4, "both"), "E");   // naturals never double up
  assert.equal(noteName(10), "A♯");         // sharp by default
  assert.equal(noteName(13), "C♯");         // any integer, not only 0–11
});

test("pitch names carry the octave and never read both ways", () => {
  assert.equal(pitchName(40), "E2");
  assert.equal(pitchName(61, "flat"), "D♭4");
  assert.equal(pitchName(61, "both"), "C♯4");
});

test("parseNote accepts what people type", () => {
  for (const [text, pc] of [
    ["C", 0], ["c", 0], ["F#", 6], ["F♯", 6], ["Gb", 6], ["g♭", 6],
    ["bb", 10], ["B", 11], ["Cb", 11], ["B#", 0], ["E#", 5], ["F##", 7],
    ["  A  ", 9],
  ]) assert.equal(parseNote(text), pc, text);
});

test("parseNote rejects non-notes and pitches", () => {
  for (const text of ["", "H", "X#", "#C", "C4", "C#-1", "Cx", "do"]){
    assert.equal(parseNote(text), null, text);
  }
});

test("parsePitch reads scientific pitch notation", () => {
  for (const [text, midi] of [
    ["E2", 40], ["A4", 69], ["C4", 60], ["c#4", 61], ["Db4", 61], ["D♭4", 61],
    ["G4", 67], ["B0", 23], ["C-1", 0], ["G9", 127],   // B0: a 5-string bass's low B
    ["Cb4", 59], ["B#3", 60],   // the accidental moves the pitch, not the label
  ]) assert.equal(parsePitch(text), midi, text);
});

test("parsePitch rejects missing octaves and out-of-range pitches", () => {
  for (const text of ["E", "", "E 2 3", "G#9", "Cb-1", "Q4"]){
    assert.equal(parsePitch(text), null, text);
  }
});

test("names and parsing round-trip across the MIDI range", () => {
  for (let m = 0; m <= 127; m++){
    assert.equal(parsePitch(pitchName(m)), m);
    assert.equal(parsePitch(pitchName(m, "flat")), m);
    assert.equal(parseNote(noteName(m, "flat")), pitchClass(m));
  }
});
