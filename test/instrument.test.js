import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newInstrument, validate, upgrade, pitchAt, summary, stringNumber, MAX_STRINGS,
  VIEW_PRESETS, VIEW_RANGES, presetOf, sameView,
} from "../instrument.js";
import { parsePitch } from "../theory.js";

const P = parsePitch;

test("a new instrument is a standard-tuned guitar and valid", () => {
  const g = newInstrument({}, 1000);
  assert.deepEqual(validate(g), []);
  assert.equal(g.name, "Guitar");
  assert.deepEqual(g.strings.map(s => s.open), ["E2", "A2", "D3", "G3", "B3", "E4"].map(P));
  assert.equal(g.frets, 22);
  assert.equal(g.created, 1000);
  assert.equal(g.updated, 1000);
});

test("new instruments get distinct ids, and fields override defaults", () => {
  const a = newInstrument(), b = newInstrument({ name: "Bass", frets: 20 });
  assert.notEqual(a.id, b.id);
  assert.equal(b.name, "Bass");
  assert.equal(b.frets, 20);
});

test("pitchAt adds frets to the open pitch", () => {
  const g = newInstrument();
  assert.equal(pitchAt(g, 0, 0), P("E2"));
  assert.equal(pitchAt(g, 0, 5), P("A2"));
  assert.equal(pitchAt(g, 5, 12), P("E5"));
  assert.equal(pitchAt(g, 0, 22), P("D4"));
});

test("pitchAt is null off the neck", () => {
  const g = newInstrument();
  assert.equal(pitchAt(g, 0, 23), null);   // past the last fret
  assert.equal(pitchAt(g, 0, -1), null);
  assert.equal(pitchAt(g, 6, 0), null);    // no seventh string
  assert.equal(pitchAt(g, 0, 1.5), null);
});

test("a banjo's short fifth string starts at fret 5", () => {
  // Physical order, face side first: the drone G4 sits nearest the face.
  const banjo = newInstrument({
    name: "Banjo",
    strings: [
      { open: P("G4"), start: 5 },
      { open: P("D3"), start: 0 },
      { open: P("G3"), start: 0 },
      { open: P("B3"), start: 0 },
      { open: P("D4"), start: 0 },
    ],
  });
  assert.deepEqual(validate(banjo), []);
  assert.equal(pitchAt(banjo, 0, 4), null);        // below its nut
  assert.equal(pitchAt(banjo, 0, 5), P("G4"));     // open
  assert.equal(pitchAt(banjo, 0, 7), P("A4"));
  assert.equal(pitchAt(banjo, 1, 0), P("D3"));
});

test("validate names each problem", () => {
  const g = newInstrument();
  const bad = { ...g, name: " ", frets: 0, strings: [{ open: 200, start: 0 }],
                view: { ...g.view, squeeze: 0.1, flip: "no" } };
  const errs = validate(bad);
  assert.ok(errs.includes("name missing"));
  assert.ok(errs.includes("frets not 1–36"));
  assert.ok(errs.includes("string 1: pitch not 0–127"));
  assert.ok(errs.includes("view.squeeze not 0.5–1"));
  assert.ok(errs.includes("view.flip not true/false"));
  assert.ok(validate({ ...g, view: "tab" }).includes("view missing"));
});

test("new instruments default to the tab preset: low string at the bottom, flat", () => {
  const g = newInstrument();
  assert.deepEqual(g.view, VIEW_PRESETS.tab);
  assert.equal(presetOf(g.view), "tab");
  g.view.angle = 5;                                  // a copy, not the frozen preset
  assert.equal(VIEW_PRESETS.tab.angle, 0);
});

test("every preset is a valid view, and anything else is custom", () => {
  for (const [name, v] of Object.entries(VIEW_PRESETS)){
    assert.deepEqual(validate(newInstrument({ view: { ...v } })), []);
    assert.equal(presetOf(v), name);
  }
  assert.equal(presetOf({ ...VIEW_PRESETS.player, angle: 12 }), null);
  assert.ok(sameView(VIEW_PRESETS.player, { ...VIEW_PRESETS.player, squeeze: 0.7 + 1e-9 }));
});

test("view ranges are enforced at both ends", () => {
  const g = newInstrument();
  for (const [k, [lo, hi]] of Object.entries(VIEW_RANGES)){
    assert.deepEqual(validate({ ...g, view: { ...g.view, [k]: lo } }), [], `${k} at ${lo}`);
    assert.deepEqual(validate({ ...g, view: { ...g.view, [k]: hi } }), [], `${k} at ${hi}`);
    assert.ok(validate({ ...g, view: { ...g.view, [k]: hi + 1 } }).length, `${k} above`);
    assert.ok(validate({ ...g, view: { ...g.view, [k]: lo - 1 } }).length, `${k} below`);
  }
});

test("older view shapes upgrade to the preset values", () => {
  const { view, ...old } = newInstrument();
  assert.deepEqual(upgrade({ ...old, tabView: true }), { ...old, view: VIEW_PRESETS.tab });
  assert.deepEqual(upgrade({ ...old, tabView: false }), { ...old, view: VIEW_PRESETS.flipped });
  for (const name of Object.keys(VIEW_PRESETS)){
    assert.deepEqual(upgrade({ ...old, view: name }), { ...old, view: VIEW_PRESETS[name] });
  }
  const current = newInstrument({ view: { ...VIEW_PRESETS.player, angle: 20 } });
  assert.equal(upgrade(current), current);                 // already current: untouched
  assert.equal(upgrade({ ...old, view: "sideways" }).view, "sideways");   // left for validate
  assert.equal(upgrade(null), null);
});

test("validate rejects junk without throwing", () => {
  for (const x of [null, 3, "guitar", [], {}, { strings: "EADGBE" }]){
    assert.ok(validate(x).length > 0);
  }
});

test("validate bounds string count and first fret", () => {
  const g = newInstrument();
  assert.ok(validate({ ...g, strings: [] }).length);
  const many = Array.from({ length: MAX_STRINGS + 1 }, () => ({ open: 40, start: 0 }));
  assert.ok(validate({ ...g, strings: many }).length);
  assert.ok(validate({ ...g, strings: [{ open: 40, start: 22 }] }).length);  // nut at the last fret
  assert.deepEqual(validate({ ...g, strings: [{ open: 40, start: 21 }] }), []);
});

test("strings are numbered from the floor side, as players count", () => {
  // Guitar, face side first: low E is index 0 and string 6; high E is string 1.
  assert.equal(stringNumber(0, 6), 6);
  assert.equal(stringNumber(5, 6), 1);
  assert.equal(stringNumber(0, 4), 4);
});

test("summary lists the tuning and fret count", () => {
  assert.equal(summary(newInstrument()), "E2 A2 D3 G3 B3 E4 · 22 frets");
  const g = newInstrument({ strings: [{ open: P("Db3"), start: 0 }], frets: 1 });
  assert.equal(summary(g, "flat"), "D♭3 · 1 fret");
});
