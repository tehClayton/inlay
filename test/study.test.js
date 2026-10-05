import { test } from "node:test";
import assert from "node:assert/strict";
import { newStudy, studyLabel, studyMarks, studyTap, studySummary, studySet } from "../study.js";
import { newInstrument } from "../instrument.js";

const inst = newInstrument();               // E2 A2 D3 G3 B3 E4, 22 frets; string 0 is low E
const at = (string, fret) => ({ string, fret });
const A = 9, E = 4;

test("a new study labels tapped frets by name, with no root", () => {
  const s = newStudy();
  assert.equal(s.show, "tapped");
  assert.equal(s.labels, "notes");
  assert.equal(s.root, null);
  assert.equal(s.picked.size, 0);
  assert.deepEqual(studyMarks(inst, s), []);
});

test("tapping labels a fret, and tapping it again takes the label off", () => {
  let s = studyTap(newStudy(), at(1, 0));
  assert.deepEqual(studyMarks(inst, s).map(m => m.text), ["A"]);
  s = studyTap(s, at(0, 1));
  assert.deepEqual(studyMarks(inst, s).map(m => m.text).sort(), ["A", "F"]);
  s = studyTap(s, at(1, 0));
  assert.deepEqual(studyMarks(inst, s).map(m => m.text), ["F"]);
});

test("a tap doesn't change the study it's given", () => {
  const s = newStudy();
  studyTap(s, at(1, 0));
  assert.equal(s.picked.size, 0);
});

test("every note: a quiet label on every playable place, and taps change nothing", () => {
  const s = { ...newStudy(), show: "all" };
  const marks = studyMarks(inst, s);
  assert.equal(marks.length, 6 * 23);
  assert.ok(marks.every(m => m.kind === "label"));
  assert.equal(studyTap(s, at(0, 3)), s);
});

test("a banjo's short string is labelled only from its nut up", () => {
  const banjo = newInstrument({ strings: [{ open: 67, start: 5 }, { open: 50, start: 0 }], frets: 22 });
  const marks = studyMarks(banjo, { ...newStudy(), show: "all" });
  assert.equal(marks.filter(m => m.pos.string === 0).length, 22 - 5 + 1);
  assert.ok(marks.every(m => m.pos.string !== 0 || m.pos.fret >= 5));
});

test("intervals from a root, the root itself stood out", () => {
  const s = { ...newStudy(), show: "all", labels: "degrees", root: A };
  const label = pos => studyLabel(inst, pos, s);
  assert.deepEqual(label(at(1, 0)), { pos: at(1, 0), kind: "root", text: "1" });   // open A
  assert.equal(label(at(0, 0)).text, "5");       // E over A
  assert.equal(label(at(0, 8)).text, "♭3");      // C over A
  assert.equal(label(at(0, 8)).kind, "label");
});

test("intervals without a root fall back to note names", () => {
  const s = { ...newStudy(), labels: "degrees" };
  assert.equal(studyLabel(inst, at(1, 0), s).text, "A");
});

test("names mode with a root still marks the root's places", () => {
  const s = { ...newStudy(), root: E };
  const marks = studyMarks(inst, s);
  assert.ok(marks.length > 0);
  assert.ok(marks.every(m => m.kind === "root" && m.text === "E"));
});

test("tapped frets and the root's places together, each once", () => {
  let s = { ...newStudy(), root: E, labels: "degrees" };
  s = studyTap(s, at(0, 0));                  // an E: already a root place
  s = studyTap(s, at(1, 2));                  // B, a 5th above E
  const marks = studyMarks(inst, s);
  const keys = marks.map(m => `${m.pos.string}:${m.pos.fret}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(marks.find(m => m.pos.string === 1 && m.pos.fret === 2).text, "5");
  assert.equal(marks.find(m => m.pos.string === 1 && m.pos.fret === 2).kind, "note");
});

test("names follow the accidental preference", () => {
  const s = studyTap(newStudy(), at(1, 1));   // A♯ / B♭
  assert.equal(studyMarks(inst, s, "flat")[0].text, "B♭");
  assert.equal(studyMarks(inst, s, "sharp")[0].text, "A♯");
});

test("off the neck is no label", () => {
  assert.equal(studyLabel(inst, at(0, 30), newStudy()), null);
});

test("the summary says what the board is showing", () => {
  assert.equal(studySummary(newStudy()), "tap frets to label them");
  assert.equal(studySummary({ ...newStudy(), show: "all" }), "every note");
  assert.equal(studySummary({ ...newStudy(), labels: "degrees" }), "tap frets to label them · choose a root for intervals");
  assert.equal(studySummary({ ...newStudy(), labels: "degrees", root: 10 }, "flat"),
               "tap frets to label them · intervals from B♭");
});

test("a scale or chord: every place across the neck that plays one of its notes", () => {
  const s = { ...newStudy(), show: "set", set: "scale:minorPentatonic", root: A };   // A C D E G
  const marks = studyMarks(inst, s);
  const want = new Set(["A", "C", "D", "E", "G"]);
  assert.ok(marks.length > 0);
  assert.ok(marks.every(m => want.has(m.text)));
  assert.equal(new Set(marks.map(m => m.text)).size, 5);
  // Every such place, and no other.
  const all = studyMarks(inst, { ...newStudy(), show: "all" });
  assert.equal(marks.length, all.filter(m => want.has(m.text)).length);
  assert.ok(marks.filter(m => m.text === "A").every(m => m.kind === "root"));
  assert.ok(marks.filter(m => m.text !== "A").every(m => m.kind === "note"));
});

test("a scale or chord is spelled for its key, or labelled by degree", () => {
  const f = { ...newStudy(), show: "set", set: "scale:major", root: 5 };            // F major
  assert.ok(studyMarks(inst, f, "sharp").some(m => m.text === "B♭"));
  assert.ok(!studyMarks(inst, f, "sharp").some(m => m.text === "A♯"));
  const deg = studyMarks(inst, { ...f, labels: "degrees" });
  assert.deepEqual([...new Set(deg.map(m => m.text))].sort(), ["1", "2", "3", "4", "5", "6", "7"]);
  const c = { ...newStudy(), show: "set", set: "chord:dim7", root: 0 };
  assert.deepEqual([...new Set(studyMarks(inst, c).map(m => m.text))].sort(), ["B♭♭", "C", "E♭", "G♭"]);
});

test("a scale or chord needs a root; taps don't change it", () => {
  const s = { ...newStudy(), show: "set", set: "chord:dom7" };
  assert.deepEqual(studyMarks(inst, s), []);
  assert.equal(studySummary(s), "choose a root for the dominant 7 chord");
  assert.equal(studyTap(s, at(0, 3)), s);
  const t = { ...s, root: 1 };
  assert.equal(studySummary(t, "flat"), "D♭ dominant 7");
  assert.equal(studySummary({ ...t, labels: "degrees" }, "flat"), "D♭ dominant 7 · as intervals");
});

test("study sets name the library", () => {
  assert.deepEqual(studySet("scale:dorian"), { kind: "scale", id: "dorian", name: "dorian", formula: "1 2 ♭3 4 5 6 ♭7" });
  assert.equal(studySet("chord:dom7").name, "dominant 7");
  assert.equal(studySet("scale:bebop"), null);
  assert.equal(studySet("mode:major"), null);
});
