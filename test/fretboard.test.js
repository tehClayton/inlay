import { test } from "node:test";
import assert from "node:assert/strict";
import { layout, cellAt, cellOf } from "../fretboard.js";
import { newInstrument } from "../instrument.js";
import { parsePitch } from "../theory.js";

const BOX = { width: 800, height: 240 };
const guitar = (fields = {}) => newInstrument(fields);

test("one cell per playable position", () => {
  const L = layout(guitar(), BOX);
  assert.equal(L.cells.length, 6 * 23);   // six strings, open plus 22 frets
  assert.equal(L.wires.length, 22);
});

test("every cell's centre hits that cell", () => {
  const L = layout(guitar(), BOX);
  for (const c of L.cells) assert.deepEqual(cellAt(L, c.cx, c.cy), { string: c.string, fret: c.fret });
});

test("cells tile the neck without overlap", () => {
  const L = layout(guitar(), BOX);
  for (const a of L.cells){
    assert.ok(a.x1 > a.x0 && a.y1 > a.y0);
    assert.ok(a.x0 >= 0 && a.x1 <= BOX.width && a.y0 >= 0 && a.y1 <= BOX.height);
    const neighbours = L.cells.filter(b => b !== a &&
      a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1);
    assert.equal(neighbours.length, 0, `cell ${a.string}:${a.fret} overlaps`);
  }
});

test("frets narrow up the neck, the 12th about 70% of the 1st", () => {
  const L = layout(guitar(), BOX);
  const w = f => { const c = cellOf(L, { string: 0, fret: f }); return c.x1 - c.x0; };
  for (let f = 2; f <= 22; f++) assert.ok(w(f) < w(f - 1), `fret ${f} not narrower`);
  const ratio = w(12) / w(1);
  assert.ok(ratio > 0.68 && ratio < 0.74, `12th/1st = ${ratio}`);
});

test("default view: nut on the left, face-side string on top", () => {
  const L = layout(guitar(), BOX);
  const open = cellOf(L, { string: 0, fret: 0 }), high = cellOf(L, { string: 0, fret: 22 });
  assert.ok(open.cx < high.cx);
  assert.ok(cellOf(L, { string: 0, fret: 5 }).cy < cellOf(L, { string: 5, fret: 5 }).cy);
});

test("left-handed mirrors left to right", () => {
  const R = layout(guitar(), BOX), Lh = layout(guitar({ leftHanded: true }), BOX);
  for (const c of R.cells){
    const m = cellOf(Lh, c);
    assert.ok(Math.abs(m.cx - (BOX.width - c.cx)) < 1e-9);
    assert.equal(m.cy, c.cy);
  }
  assert.ok(Math.abs(Lh.nutX - (BOX.width - R.nutX)) < 1e-9);
});

test("tab view mirrors top to bottom", () => {
  const R = layout(guitar(), BOX), T = layout(guitar({ tabView: true }), BOX);
  for (const c of R.cells){
    const m = cellOf(T, c);
    assert.equal(m.cx, c.cx);
    assert.ok(Math.abs((m.cy - R.top) - (R.bottom - c.cy)) < 1e-9);
  }
  assert.ok(cellOf(T, { string: 0, fret: 5 }).cy > cellOf(T, { string: 5, fret: 5 }).cy);
});

test("a banjo's short string has no cells below its nut", () => {
  const P = parsePitch;
  const banjo = newInstrument({ frets: 22, strings: [
    { open: P("G4"), start: 5 }, { open: P("D3"), start: 0 }, { open: P("G3"), start: 0 },
    { open: P("B3"), start: 0 }, { open: P("D4"), start: 0 },
  ]});
  const L = layout(banjo, BOX);
  assert.equal(L.cells.filter(c => c.string === 0).length, 22 - 5 + 1);
  const firstShort = cellOf(L, { string: 0, fret: 5 }), below = cellOf(L, { string: 1, fret: 5 });
  assert.equal(firstShort.x0, below.x0);     // its open position is fret 5's space
  assert.equal(cellAt(L, cellOf(L, { string: 1, fret: 2 }).cx, firstShort.cy), null);
  assert.ok(L.strings[0].nutX !== null);
  assert.equal(L.strings[1].nutX, null);
});

test("inlays: singles, doubles at 12 and 24, only up to the last fret", () => {
  const frets = L => [...new Set(L.inlays.map(d => d.fret))].sort((a, b) => a - b);
  assert.deepEqual(frets(layout(guitar({ frets: 22 }), BOX)), [3, 5, 7, 9, 12, 15, 17, 19, 21]);
  assert.deepEqual(frets(layout(guitar({ frets: 24 }), BOX)), [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]);
  assert.equal(layout(guitar({ frets: 24 }), BOX).inlays.filter(d => d.fret === 12).length, 2);
});

test("the 12th-fret doubles sit between strings, not on them", () => {
  for (const count of [4, 5, 6, 7]){
    const inst = guitar({ strings: Array.from({ length: count }, () => ({ open: 40, start: 0 })) });
    const L = layout(inst, BOX);
    for (const d of L.inlays.filter(d => d.fret === 12)){
      const gap = Math.min(...L.strings.map(s => Math.abs(s.y - d.cy)));
      assert.ok(gap > L.pitch * 0.4, `${count} strings: dot ${gap.toFixed(1)}px from a string`);
    }
  }
});

test("outside the neck is not a position", () => {
  const L = layout(guitar(), BOX);
  assert.equal(cellAt(L, 1, 1), null);
  assert.equal(cellAt(L, BOX.width - 1, BOX.height / 2), null);
  assert.equal(cellAt(L, BOX.width / 2, BOX.height - 2), null);   // the fret-number strip
});
