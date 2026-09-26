import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newInstrument, validate, upgrade, pitchAt, summary, stringNumber, MAX_STRINGS,
  VIEW_PRESETS, VIEW_RANGES, presetOf, sameView, MIN_SPAN, fretRange, lastFrom,
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
                view: { ...g.view, tilt: 95, flip: "no" } };
  const errs = validate(bad);
  assert.ok(errs.includes("name missing"));
  assert.ok(errs.includes("frets not 1–36"));
  assert.ok(errs.includes("string 1: pitch not 0–127"));
  assert.ok(errs.includes("view.tilt not 0–80"));
  assert.ok(errs.includes("view.flip not true/false"));
  assert.ok(validate({ ...g, view: "tab" }).includes("view missing"));
});

test("new instruments default to the player's view, showing the whole neck", () => {
  const g = newInstrument();
  assert.deepEqual(g.view, { ...VIEW_PRESETS.player, span: 0 });
  assert.equal(presetOf(g.view), "player");
  g.view.angle = 20;                                 // a copy, not the frozen preset
  assert.equal(VIEW_PRESETS.player.angle, 5);
});

test("every preset is a valid view, and anything else is custom", () => {
  for (const [name, v] of Object.entries(VIEW_PRESETS)){
    assert.deepEqual(validate(newInstrument({ view: { ...v, span: 0 } })), []);
    assert.equal(presetOf(v), name);
  }
  assert.equal(presetOf({ ...VIEW_PRESETS.player, angle: 12 }), null);
  assert.ok(sameView(VIEW_PRESETS.player, { ...VIEW_PRESETS.player, perspective: 0.8 + 1e-9 }));
  // How many frets are shown is not part of what a preset is.
  assert.equal(presetOf({ ...VIEW_PRESETS.player, span: 5 }), "player");
});

test("span is all (0) or at least a few frets, up to the most a neck can have", () => {
  const g = newInstrument();
  for (const span of [0, MIN_SPAN, 12, 36]) assert.deepEqual(validate({ ...g, view: { ...g.view, span } }), [], `${span}`);
  for (const span of [1, 2, 37, 4.5, -1, null]) assert.ok(validate({ ...g, view: { ...g.view, span } }).length, `${span}`);
});

test("fretRange: the whole neck, or a window that stays on it", () => {
  const g = newInstrument();                            // 22 frets
  assert.deepEqual(fretRange(g, 7), [0, 22]);           // span 0: everything, wherever
  const w = { ...g, view: { ...g.view, span: 5 } };
  assert.deepEqual(fretRange(w, 0), [0, 5]);            // the open strings and 5 frets
  assert.deepEqual(fretRange(w, 7), [7, 11]);           // 5 fretted positions
  assert.deepEqual(fretRange(w, 99), [18, 22]);         // clamped to the far end
  assert.deepEqual(fretRange(w, -3), [0, 5]);
  assert.equal(lastFrom(w), 18);
  assert.equal(lastFrom(g), 0);
  const wide = { ...g, view: { ...g.view, span: 30 } };   // more than the neck has
  assert.deepEqual(fretRange(wide, 4), [0, 22]);
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

test("older view shapes upgrade to the preset values, showing the whole neck", () => {
  const { view, ...old } = newInstrument();
  const whole = v => ({ ...v, span: 0 });
  assert.deepEqual(upgrade({ ...old, tabView: true }), { ...old, view: whole(VIEW_PRESETS.tab) });
  assert.deepEqual(upgrade({ ...old, tabView: false }), { ...old, view: whole(VIEW_PRESETS.flipped) });
  for (const name of Object.keys(VIEW_PRESETS)){
    assert.deepEqual(upgrade({ ...old, view: name }), { ...old, view: whole(VIEW_PRESETS[name]) });
  }
  // The effect-slider shape: squeeze becomes the player's tilt and perspective,
  // recession a turn, and the angle carries over.
  const effects = upgrade({ ...old, view: { flip: true, squeeze: 0.7, recession: 0.8, angle: 12, edge: 0.2 } });
  assert.deepEqual(validate(effects), []);
  assert.deepEqual(effects.view, { flip: true, tilt: VIEW_PRESETS.player.tilt, turn: 25, angle: 12,
    perspective: VIEW_PRESETS.player.perspective, edge: VIEW_PRESETS.tab.edge, span: 0 });
  const plain = upgrade({ ...old, view: { flip: false, squeeze: 1, recession: 1, angle: 0, edge: 0 } });
  assert.deepEqual(plain.view, whole(VIEW_PRESETS.tab));
  // A camera view saved before span existed gains it.
  assert.deepEqual(upgrade({ ...old, view: { ...VIEW_PRESETS.player } }).view, whole(VIEW_PRESETS.player));
  const current = newInstrument({ view: { ...VIEW_PRESETS.player, angle: 20, span: 7 } });
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
