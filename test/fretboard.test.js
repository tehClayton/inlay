import { test } from "node:test";
import assert from "node:assert/strict";
import { layout, cellAt, cellOf, smallestCell, readout, camera } from "../fretboard.js";
import { newInstrument, VIEW_PRESETS, VIEW_RANGES } from "../instrument.js";
import { parsePitch } from "../theory.js";

const BOX = { width: 800, height: 240 };
/* A guitar; `view` may be a preset's name, or an object of settings laid
   over the tab preset. */
const viewOf = v => (typeof v === "string" ? { ...VIEW_PRESETS[v] } : { ...VIEW_PRESETS.tab, ...v });
const guitar = (fields = {}) =>
  newInstrument({ ...fields, ...(fields.view ? { view: viewOf(fields.view) } : {}) });
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const len = ([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

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

test("tab is the flat layout turned upside down: nothing scaled or moved", () => {
  const L = layout(guitar(), BOX);
  const flipY = y => L.top + L.bottom - y;
  for (const c of L.cells){
    const [x0, y0, x1, y1] = c.flat;
    assert.ok(close(c.x0, x0) && close(c.x1, x1), `${c.string}:${c.fret} x`);
    assert.ok(close(c.y0, flipY(y1)) && close(c.y1, flipY(y0)), `${c.string}:${c.fret} y`);
  }
  assert.deepEqual(readout(L), { gaps: readout(L).gaps, nut: readout(L).nut });
  assert.ok(close(readout(L).gaps, 1) && close(readout(L).nut, 1));
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

/* ---------------------------------------------------------------- camera */

test("the camera takes face points to the screen and back exactly", () => {
  for (const tilt of [0, 25, 50]) for (const turn of [0, 20, 40]) for (const perspective of [0, 0.5, 1]){
    for (const bassSign of [1, -1]){
      const cam = camera({ tilt, turn, perspective, bassSign }, 200);
      for (let k = 0; k < 20; k++){
        const p = [((k * 97) % 400) - 200, ((k * 53) % 200) - 100];
        const back = cam.unproject(cam.project([...p, 0]));
        assert.ok(close(back[0], p[0], 1e-7) && close(back[1], p[1], 1e-7),
          `${tilt}/${turn}/${perspective}: ${p} -> ${back}`);
      }
    }
  }
});

test("tilt without perspective only flattens: strings stay evenly spaced", () => {
  const L = layout(guitar({ view: { tilt: 40 } }), BOX), flat = layout(guitar(), BOX);
  assert.ok(close(readout(L).gaps, 1, 1e-9));
  const h = M => { const a = cellOf(M, { string: 0, fret: 12 }), b = cellOf(M, { string: 5, fret: 12 }); return Math.hypot(b.cx - a.cx, b.cy - a.cy); };
  assert.ok(close(h(L) / h(flat), Math.cos(40 * Math.PI / 180), 1e-6));
});

test("tilt with perspective: strings close up away from the eye, and the far edge shortens", () => {
  const L = layout(guitar({ view: "player" }), BOX);
  const y = i => L.strings[i].y;   // guitar: 0 is low E, nearest; 5 is high E, farthest
  const gaps = [1, 2, 3, 4, 5].map(i => y(i - 1) - y(i));
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] < gaps[i - 1], `gap ${i} not tighter`);
  const r = readout(L).gaps;
  assert.ok(r > 0.7 && r < 0.85, `B–e / E–A = ${r.toFixed(2)}`);
  // The wood's long edges: the far (treble, top) one is shorter — keystone.
  const [nutTop, bodyTop, bodyBottom, nutBottom] = L.wood;
  const topEdge = len([nutTop, bodyTop]), bottomEdge = len([nutBottom, bodyBottom]);
  const far = Math.min(topEdge, bottomEdge), near = Math.max(topEdge, bottomEdge);
  assert.ok(far < near * 0.97, "the far long edge should be visibly shorter");
  // No turn: both ends of the neck are the same height.
  assert.ok(close(readout(L).nut, 1, 1e-9));
});

test("turn with perspective: the headstock end recedes", () => {
  const L = layout(guitar({ view: { turn: 30, perspective: 1 } }), BOX);
  assert.ok(readout(L).nut < 0.85, `nut end at ${readout(L).nut}`);
  // Without perspective, a turn only shortens the neck; the ends stay equal.
  const ortho = layout(guitar({ view: { turn: 30 } }), BOX);
  assert.ok(close(readout(ortho).nut, 1, 1e-9));
});

test("tilting brings the bass-side edge into view, below the low string", () => {
  const L = layout(guitar({ view: "player" }), BOX);
  assert.ok(L.edge);
  const [[ax, ay], [bx, by]] = L.strings[0].line;
  const stringY = x => ay + (by - ay) * (x - ax) / (bx - ax);
  for (const d of L.sideDots) assert.ok(d.cy > stringY(d.cx), `side dot at ${d.cx.toFixed(0)} above the string`);
  assert.equal(L.sideDots.length, L.numbers.length);
  // Flat, the side is edge-on: nothing to draw.
  assert.equal(layout(guitar(), BOX).edge, null);
  // Flipped and tilted, the bass side is at the top, and so is its edge.
  const F = layout(guitar({ view: { flip: true, tilt: 30 } }), BOX);
  const topString = F.strings[0].line[0][1];
  for (const d of F.sideDots) assert.ok(d.cy < topString + 1);
});

test("angle turns the neck, headstock end up; left-handed turns the other way", () => {
  for (const angle of [10, 30]){
    for (const leftHanded of [false, true]){
      const L = layout(guitar({ view: { angle }, leftHanded }), BOX);
      const nut = cellOf(L, { string: 3, fret: 0 }), body = cellOf(L, { string: 3, fret: 22 });
      const deg = Math.atan2(body.cy - nut.cy, Math.abs(body.cx - nut.cx)) * 180 / Math.PI;
      assert.ok(close(deg, angle, 1e-6), `${angle}° ${leftHanded ? "left" : "right"}: got ${deg}`);
      assert.ok(nut.cy < body.cy, "headstock end should be higher");
    }
  }
});

test("a turned neck is shrunk to fit, never stretched or cropped", () => {
  const L = layout(guitar({ view: { angle: 30 } }), BOX), flat = layout(guitar(), BOX);
  const along = M => { const a = cellOf(M, { string: 3, fret: 0 }), b = cellOf(M, { string: 3, fret: 22 }); return Math.hypot(b.cx - a.cx, b.cy - a.cy); };
  assert.ok(along(L) < along(flat));
  const across = M => { const a = cellOf(M, { string: 0, fret: 12 }), b = cellOf(M, { string: 5, fret: 12 }); return Math.hypot(b.cx - a.cx, b.cy - a.cy); };
  assert.ok(close(along(L) / along(flat), across(L) / across(flat), 1e-9));
});

/* Every combination of every slider at both ends of its range, both
   orientations, both hands: taps still land on the right cell, nothing
   leaves the box, and the smallest target stays tappable on a phone. */
test("every view the sliders allow still works", () => {
  const PHONE = { width: 740, height: 260 };
  const combos = Object.entries(VIEW_RANGES)
    .reduce((acc, [k, [lo, hi]]) => acc.flatMap(a => [lo, hi].map(v => ({ ...a, [k]: v }))), [{}]);
  let checked = 0;
  for (const settings of combos){
    for (const flip of [false, true]) for (const leftHanded of [false, true]){
      const L = layout(guitar({ view: { ...settings, flip }, leftHanded }), PHONE);
      const name = JSON.stringify({ ...settings, flip, leftHanded });
      for (const c of L.cells){
        assert.deepEqual(cellAt(L, c.cx, c.cy), { string: c.string, fret: c.fret }, name);
        for (const [x, y] of c.pts){
          assert.ok(x > -1e-6 && x < PHONE.width + 1e-6 && y > -1e-6 && y < PHONE.height + 1e-6, name);
        }
      }
      assert.ok(smallestCell(L) >= 6, `${name}: smallest target ${smallestCell(L).toFixed(1)}px`);
      checked++;
    }
  }
  assert.equal(checked, 2 ** Object.keys(VIEW_RANGES).length * 4);
});

/* ------------------------------------------------------------ the rest */

test("a banjo's short string has no cells below its nut", () => {
  const P = parsePitch;
  const banjo = newInstrument({ frets: 22, strings: [
    { open: P("G4"), start: 5 }, { open: P("D3"), start: 0 }, { open: P("G3"), start: 0 },
    { open: P("B3"), start: 0 }, { open: P("D4"), start: 0 },
  ]});
  for (const view of ["tab", "player"]){
    const L = layout({ ...banjo, view: viewOf(view) }, BOX);
    assert.equal(L.cells.filter(c => c.string === 0).length, 22 - 5 + 1);
    const firstShort = cellOf(L, { string: 0, fret: 5 });
    assert.equal(firstShort.flat[0], cellOf(L, { string: 1, fret: 5 }).flat[0]);   // fret 5's space
    // Where fret 2 would be on the short string is not a position.
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
  // The side edge, below the low string, is drawn but isn't a position.
  const P = layout(guitar({ view: "player" }), BOX);
  const [a, b, c, d] = P.edge;
  const mid = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4];
  assert.equal(cellAt(P, ...mid), null);
});
