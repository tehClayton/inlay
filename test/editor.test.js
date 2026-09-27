import { test } from "node:test";
import assert from "node:assert/strict";
import { stringsChanged } from "../editor.js";
import { newInstrument } from "../instrument.js";
import { parsePitch } from "../theory.js";

test("retuning, adding, removing or reordering strings counts as a change", () => {
  const g = newInstrument();
  const s = g.strings;
  assert.ok(stringsChanged(g, { ...g, strings: [{ open: parsePitch("D2"), start: 0 }, ...s.slice(1)] }));
  assert.ok(stringsChanged(g, { ...g, strings: [...s, { open: parsePitch("B1"), start: 0 }] }));
  assert.ok(stringsChanged(g, { ...g, strings: s.slice(1) }));
  assert.ok(stringsChanged(g, { ...g, strings: [...s].reverse() }));
  assert.ok(stringsChanged(g, { ...g, strings: s.map((x, i) => (i ? x : { ...x, start: 5 })) }));
});

test("frets, name, hand and view don't change what note a position is", () => {
  const g = newInstrument();
  assert.ok(!stringsChanged(g, { ...g, frets: 24, name: "Other", leftHanded: true,
    view: { ...g.view, tilt: 10, span: 5 }, strings: g.strings.map(x => ({ ...x })) }));
});
