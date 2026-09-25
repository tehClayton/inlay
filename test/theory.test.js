import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pitchClass, octave, isNatural, noteName, pitchName, parseNote, parsePitch,
} from "../theory.js";

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
