import { test } from "node:test";
import assert from "node:assert/strict";
import { layout, cellAt, cellOf, squareToQuad, applyH, invertH } from "../fretboard.js";
import { newInstrument } from "../instrument.js";
import { parsePitch } from "../theory.js";

const BOX = { width: 800, height: 240 };
const guitar = (fields = {}) => newInstrument(fields);
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const ALL_VIEWS = [
  ["tab", {}], ["flipped", { view: "flipped" }], ["player", { view: "player" }],
  ["tab, left-handed", { leftHanded: true }],
  ["player, left-handed", { view: "player", leftHanded: true }],
];

test("one cell per playable position", () => {
  const L = layout(guitar(), BOX);
  assert.equal(L.cells.length, 6 * 23);   // six strings, open plus 22 frets
  assert.equal(L.wires.length, 22);
});

for (const [name, fields] of ALL_VIEWS){
  test(`${name}: every cell's centre hits that cell`, () => {
    const L = layout(guitar(fields), BOX);
    for (const c of L.cells) assert.deepEqual(cellAt(L, c.cx, c.cy), { string: c.string, fret: c.fret });
  });

  test(`${name}: every cell's corners, pulled slightly inward, hit that cell`, () => {
    const L = layout(guitar(fields), BOX);
    for (const c of L.cells){
      for (const [x, y] of c.pts){
        const px = x + (c.cx - x) * 0.05, py = y + (c.cy - y) * 0.05;
        assert.deepEqual(cellAt(L, px, py), { string: c.string, fret: c.fret });
      }
    }
  });

  test(`${name}: everything stays in the box`, () => {
    const L = layout(guitar(fields), BOX);
    const pts = [...L.wood, ...L.openCol, ...L.cells.flatMap(c => c.pts), ...(L.edge ?? [])];
    for (const [x, y] of pts){
      assert.ok(x >= -1e-9 && x <= BOX.width + 1e-9 && y >= -1e-9 && y <= BOX.height + 1e-9, `${x},${y}`);
    }
    for (const nb of L.numbers) assert.ok(nb.y <= BOX.height, `fret ${nb.fret} number at ${nb.y}`);
  });
}

test("flat cells tile the neck without overlap", () => {
  const L = layout(guitar(), BOX);
  for (const a of L.cells){
    assert.ok(a.x1 > a.x0 && a.y1 > a.y0);
    const neighbours = L.cells.filter(b => b !== a &&
      a.x0 < b.x1 - 1e-9 && b.x0 < a.x1 - 1e-9 && a.y0 < b.y1 - 1e-9 && b.y0 < a.y1 - 1e-9);
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

const below = (L, a, b) => cellOf(L, a).cy > cellOf(L, b).cy;
const LOW = { string: 0, fret: 5 }, HIGH = { string: 5, fret: 5 };   // guitar: low E, high E

test("tab, the default: nut on the left, low string at the bottom", () => {
  const L = layout(guitar(), BOX);
  assert.ok(cellOf(L, { string: 0, fret: 0 }).cx < cellOf(L, { string: 0, fret: 22 }).cx);
  assert.ok(below(L, LOW, HIGH));
});

test("flipped: low string at the top, otherwise the same", () => {
  const T = layout(guitar(), BOX), F = layout(guitar({ view: "flipped" }), BOX);
  assert.ok(below(F, HIGH, LOW));
  for (const c of T.cells){
    const m = cellOf(F, c);
    assert.ok(close(m.cx, c.cx));
    assert.ok(close((m.cy - T.top), (T.bottom - c.cy)));
  }
});

test("left-handed mirrors left to right", () => {
  const R = layout(guitar(), BOX), Lh = layout(guitar({ leftHanded: true }), BOX);
  for (const c of R.cells){
    const m = cellOf(Lh, c);
    assert.ok(close(m.cx, BOX.width - c.cx));
    assert.equal(m.cy, c.cy);
  }
  assert.ok(close(Lh.nut[0][0], BOX.width - R.nut[0][0]));
});

test("player's view: low string at the bottom, as seen looking down", () => {
  assert.ok(below(layout(guitar({ view: "player" }), BOX), LOW, HIGH));
});

test("player's view: the headstock end recedes", () => {
  const L = layout(guitar({ view: "player" }), BOX);
  const span = f => { const col = L.cells.filter(c => c.fret === f); return Math.max(...col.map(c => c.y1)) - Math.min(...col.map(c => c.y0)); };
  assert.ok(span(1) < span(22) * 0.75, "the nut end should be visibly shorter");
  for (let f = 2; f <= 22; f++) assert.ok(span(f) > span(f - 1), `fret ${f} not taller than ${f - 1}`);
  // Perspective foreshortens the far end, counteracting the frets' own taper,
  // so frets come out more even than flat: easier to hit near the nut too.
  const flat = layout(guitar(), BOX);
  const w = (M, f) => { const c = cellOf(M, { string: 3, fret: f }); return Math.abs(c.pts[1][0] - c.pts[0][0]); };
  assert.ok(w(L, 1) / w(L, 12) < w(flat, 1) / w(flat, 12));
});

test("player's view: the near edge and its side dots show below the low string", () => {
  const L = layout(guitar({ view: "player" }), BOX);
  assert.ok(L.edge);
  // The string slopes in perspective, so compare against it at each dot.
  const [[ax, ay], [bx, by]] = L.strings[0].line;
  const stringY = x => ay + (by - ay) * (x - ax) / (bx - ax);
  for (const d of L.sideDots) assert.ok(d.cy > stringY(d.cx), `side dot at ${d.cx.toFixed(0)} above the string`);
  assert.deepEqual(L.sideDots.length, L.numbers.length);
  assert.equal(layout(guitar(), BOX).edge, null);
});

test("the projection maps the square's corners and inverts exactly", () => {
  const q = [[10, 40], [300, 5], [300, 200], [10, 160]];
  const H = squareToQuad(q), Hi = invertH(H);
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
    const [x, y] = applyH(H, u, v);
    assert.ok(close(x, q[i][0]) && close(y, q[i][1]));
  });
  for (let k = 0; k < 50; k++){
    const u = (k * 0.37) % 1, v = (k * 0.61) % 1;
    const [x, y] = applyH(H, u, v), [u2, v2] = applyH(Hi, x, y);
    assert.ok(close(u, u2, 1e-9) && close(v, v2, 1e-9));
  }
});

test("a banjo's short string has no cells below its nut", () => {
  const P = parsePitch;
  const banjo = newInstrument({ frets: 22, strings: [
    { open: P("G4"), start: 5 }, { open: P("D3"), start: 0 }, { open: P("G3"), start: 0 },
    { open: P("B3"), start: 0 }, { open: P("D4"), start: 0 },
  ]});
  for (const view of ["tab", "player"]){
    const L = layout({ ...banjo, view }, BOX);
    assert.equal(L.cells.filter(c => c.string === 0).length, 22 - 5 + 1);
    const firstShort = cellOf(L, { string: 0, fret: 5 });
    assert.equal(firstShort.flat[0], cellOf(L, { string: 1, fret: 5 }).flat[0]);   // fret 5's space
    // Where fret 2 would be on the short string is not a position.
    const [x] = L.toFlat([cellOf(L, { string: 1, fret: 2 }).cx, firstShort.cy]);
    assert.ok(x < firstShort.flat[0]);
    assert.equal(cellAt(L, cellOf(L, { string: 1, fret: 2 }).cx, firstShort.cy), null);
    assert.ok(L.strings[0].spike !== null);
    assert.equal(L.strings[1].spike, null);
  }
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
  for (const view of ["tab", "player"]){
    const L = layout(guitar({ view }), BOX);
    assert.equal(cellAt(L, 1, 1), null);
    assert.equal(cellAt(L, BOX.width - 1, BOX.height / 2), null);
    assert.equal(cellAt(L, BOX.width / 2, BOX.height - 2), null);   // the fret-number strip
  }
  // Above the receding nut end, inside the flat neck's box but off the drawn neck.
  const P = layout(guitar({ view: "player" }), BOX);
  assert.equal(cellAt(P, 20, P.top + 2), null);
});
