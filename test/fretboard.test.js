import { test } from "node:test";
import assert from "node:assert/strict";
import { layout, cellAt, cellOf, smallestCell, readout, camera } from "../fretboard.js";
import { newInstrument, VIEW_PRESETS, VIEW_RANGES } from "../instrument.js";
import { parsePitch } from "../theory.js";

const BOX = { width: 800, height: 240 };
/* A guitar, flat (tab) unless asked otherwise, whatever new instruments
   default to: most of these tests are about geometry. `view` may be a
   preset's name, or an object of settings laid over the tab preset. */
const viewOf = v => ({ ...(typeof v === "string" ? VIEW_PRESETS[v] : { ...VIEW_PRESETS.tab, ...v }), span: 0 });
const guitar = (fields = {}) => newInstrument({ ...fields, view: viewOf(fields.view ?? "tab") });
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

test("tab: nut on the left, low string at the bottom", () => {
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

test("tilt without perspective: strings stay evenly spaced", () => {
  const L = layout(guitar({ view: { tilt: 40 } }), BOX);
  assert.ok(close(readout(L).gaps, 1, 1e-9));
});

/* Tilt draws a neck shorter; the layout makes the flat neck taller to make
   up for it, so the board has no empty bands above and below. */
test("a tilted neck still fills the board's height", () => {
  const span = M => {
    const c = M.cells.filter(c => c.inWindow).flatMap(c => c.pts.map(p => p[1]));
    return Math.max(...c) - Math.min(...c);
  };
  const flat = layout(guitar(), BOX);
  for (const tilt of [35, 54, 70]){
    const L = layout(guitar({ view: { tilt, perspective: 0.8 } }), BOX);
    assert.ok(L.stretch > 1, `tilt ${tilt}: no stretch`);
    // The side edge a tilt reveals takes some of the height, more the steeper
    // it gets, so not all of it; without the stretch a 54° tilt covered about
    // 60%, and 70° about 35%.
    assert.ok(span(L) > span(flat) * 0.8, `tilt ${tilt}: neck ${span(L).toFixed(0)}px of ${span(flat).toFixed(0)}`);
  }
  // Flat views already fill, and are left exactly as they were.
  assert.equal(flat.stretch, 1);
  assert.equal(layout(guitar({ view: "flipped" }), BOX).stretch, 1);
});

test("stretch only makes up for tilt, so a steep angle alone doesn't make a huge neck", () => {
  // Vertical and untilted: a wide board would "want" a very thick neck.
  assert.ok(layout(guitar({ view: { angle: 90 } }), BOX).stretch <= 1.15 + 1e-9);
  const t = 60, L = layout(guitar({ view: { tilt: t, angle: 90 } }), BOX);
  assert.ok(L.stretch <= 1.15 / Math.cos(t * Math.PI / 180) + 1e-9);
});

test("tilt with perspective: strings close up away from the eye, and the far edge shortens", () => {
  // Tilt alone, no turn or angle, so each effect can be checked on its own.
  const L = layout(guitar({ view: { tilt: 35, perspective: 0.75 } }), BOX);
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

/* Tuned by eye with 6 frets shown on a landscape board, where it read "B–E
   at 71% of E–A · nut end at 92%". Both readings shift a little with the
   board's shape and the window, so this checks the neighbourhood. */
test("the player's view preset reads as tuned", () => {
  const g = guitar({ view: "player" });
  const L = layout({ ...g, view: { ...g.view, span: 6 } }, { width: 800, height: 240 });
  const { gaps, nut } = readout(L);
  assert.ok(Math.abs(gaps - 0.71) < 0.03, `B–e / E–A = ${gaps.toFixed(3)}`);
  assert.ok(Math.abs(nut - 0.92) < 0.03, `nut end at ${nut.toFixed(3)}`);
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
   orientations, both hands, on a phone and on a very wide desktop board:
   taps still land on the right cell and nothing leaves the box. The wide
   board is where a big turn in strong perspective used to bring the neck's
   near end to the eye and break the drawing. */
test("every view the sliders allow still works", () => {
  const BOARDS = [{ width: 740, height: 260 }, { width: 1600, height: 240 }];
  const combos = Object.entries(VIEW_RANGES)
    .reduce((acc, [k, [lo, hi]]) => acc.flatMap(a => [lo, hi].map(v => ({ ...a, [k]: v }))), [{}]);
  let checked = 0;
  for (const board of BOARDS) for (const settings of combos){
    for (const flip of [false, true]) for (const leftHanded of [false, true]){
      const L = layout(guitar({ view: { ...settings, flip }, leftHanded }), board);
      const name = JSON.stringify({ ...settings, flip, leftHanded, ...board });
      for (const c of L.cells){
        assert.deepEqual(cellAt(L, c.cx, c.cy), { string: c.string, fret: c.fret }, name);
        for (const [x, y] of c.pts){
          assert.ok(Number.isFinite(x) && Number.isFinite(y), name);
          assert.ok(x > -1e-6 && x < board.width + 1e-6 && y > -1e-6 && y < board.height + 1e-6, name);
        }
      }
      checked++;
    }
  }
  assert.equal(checked, 2 * 2 ** Object.keys(VIEW_RANGES).length * 4);
});

/* Steep settings are allowed to make frets small (the editor says so);
   the presets and moderate views must stay comfortably tappable. */
test("presets and moderate views stay tappable on a phone", () => {
  const PHONE = { width: 740, height: 260 };
  for (const name of Object.keys(VIEW_PRESETS)){
    const L = layout(guitar({ view: name }), PHONE);
    assert.ok(smallestCell(L) >= 14, `${name}: ${smallestCell(L).toFixed(1)}px`);
  }
  for (const view of [{ tilt: 45, perspective: 1 }, { turn: 30, perspective: 1 }, { angle: 20 }]){
    const L = layout(guitar({ view }), PHONE);
    assert.ok(smallestCell(L) >= 10, `${JSON.stringify(view)}: ${smallestCell(L).toFixed(1)}px`);
  }
});

test("however far it turns, the neck's near end stays well in front of the eye", () => {
  const H = 200;
  for (const turn of [0, 40, 80]) for (const tilt of [0, 80]){
    const cam = camera({ tilt, turn, perspective: 1, bassSign: 1 }, H, 1200, 30);
    // A point at the near end, projected: finite, and magnified at most 1/0.4.
    for (const x of [-1200, 1200]) for (const y of [-100, 100]){
      const [sx, sy] = cam.project([x, y, 0]);
      assert.ok(Number.isFinite(sx) && Number.isFinite(sy));
      assert.ok(Math.hypot(sx, sy) <= Math.hypot(x, y) / 0.4 + 1e-6, `${turn}/${tilt} at ${x},${y}`);
    }
  }
});

/* ----------------------------------------------------- frets in view */

const windowed = (span, fields = {}) => {
  const g = guitar(fields);
  return { ...g, view: { ...g.view, span } };
};

const inWin = L => L.cells.filter(c => c.inWindow);
const offBox = ([x, y], box = BOX) => x < -1e-6 || x > box.width + 1e-6 || y < -1e-6 || y > box.height + 1e-6;

test("the window sets the scale: its frets span the board's width", () => {
  const L = layout(windowed(5), BOX, 7), all = layout(guitar(), BOX);
  assert.deepEqual(L.range, [7, 11]);
  assert.deepEqual([...new Set(inWin(L).map(c => c.fret))], [7, 8, 9, 10, 11]);
  assert.equal(inWin(L).length, 6 * 5);
  // Same outer edges as the whole neck: the window fills the board.
  const xs = cells => cells.flatMap(c => [c.x0, c.x1]);
  assert.ok(close(Math.min(...xs(inWin(L))), Math.min(...xs(all.cells))));
  assert.ok(close(Math.max(...xs(inWin(L))), Math.max(...xs(all.cells))));
  // Frets get bigger for being fewer, and keep the neck's taper.
  const w = f => { const c = cellOf(L, { string: 0, fret: f }); return c.x1 - c.x0; };
  assert.ok(w(7) > (cellOf(all, { string: 0, fret: 7 }).x1 - cellOf(all, { string: 0, fret: 7 }).x0) * 3);
  for (let f = 6; f <= 13; f++) assert.ok(w(f) < w(f - 1), `fret ${f}`);
});

test("the neck carries on past the window to the screen's edges", () => {
  const L = layout(windowed(5), BOX, 7);
  const outside = L.cells.filter(c => !c.inWindow);
  // Neighbours on both sides, at the window's scale, running off the board.
  assert.ok(cellOf(L, { string: 0, fret: 6 }) && cellOf(L, { string: 0, fret: 12 }));
  assert.ok(outside.some(c => c.pts.some(p => p[0] < 0)), "nothing runs off the left edge");
  assert.ok(outside.some(c => c.pts.some(p => p[0] > BOX.width)), "nothing runs off the right edge");
  // Only as far as the screen needs: no fret lies wholly a board's width out.
  for (const c of outside) assert.ok(c.x1 > -BOX.width && c.x0 < 2 * BOX.width);
  // The strings and the wood run the full width too.
  const [[sx0], [sx1]] = L.strings[3].line;
  assert.ok(sx0 < 0 && sx1 > BOX.width);
});

test("the neck's own ends stop it: the nut shows just past a window near it", () => {
  // Frets 2–6: the open strings and the nut are just off the window's left.
  let L = layout(windowed(5), BOX, 2);
  assert.ok(L.nut && L.openCol);
  assert.equal(cellOf(L, { string: 0, fret: 0 }).inWindow, false);
  // Frets 12–16: the nut is too far off to draw.
  L = layout(windowed(5), BOX, 12);
  assert.equal(L.nut, null);
  assert.equal(L.openCol, null);
  // Frets 18–22: nothing past the last fret.
  L = layout(windowed(5), BOX, 18);
  assert.equal(Math.max(...L.cells.map(c => c.fret)), 22);
  assert.ok(!L.cells.some(c => c.pts.some(p => p[0] > BOX.width + 1e-6)));
});

test("inlays and fret numbers for everything drawn, not only the window", () => {
  const L = layout(windowed(5), BOX, 10);               // frets 10–14
  const frets = [...new Set(L.inlays.map(d => d.fret))];
  for (const f of [9, 12, 15]) assert.ok(frets.includes(f), `inlay ${f}`);
  assert.ok(L.numbers.some(n => n.fret === 12) && L.numbers.some(n => n.fret === 9));
});

test("the fit, the readout and the small-target check look at the window only", () => {
  // A 5-fret window, flat: the frets past it spill off the board, and that
  // mustn't shrink the window to make room.
  const L = layout(windowed(5), BOX, 7);
  const xs = inWin(L).flatMap(c => [c.x0, c.x1]);
  assert.ok(close(Math.min(...xs), 6) && close(Math.max(...xs), BOX.width - 6));
  assert.ok(close(readout(L).gaps, 1) && close(readout(L).nut, 1));
  assert.ok(smallestCell(L) > 20);
});

for (const [name, fields] of ALL_VIEWS){
  test(`${name}: in every window, every cell hits itself and the window stays in the box`, () => {
    for (const from of [0, 1, 7, 18]){
      const L = layout(windowed(5, fields), BOX, from);
      for (const c of L.cells){
        assert.deepEqual(cellAt(L, c.cx, c.cy), { string: c.string, fret: c.fret }, `from ${from}`);
        for (const p of c.pts) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]));
      }
      for (const c of inWin(L)) for (const p of c.pts) assert.ok(!offBox(p), `from ${from}: window off the board`);
      assert.ok(Number.isFinite(readout(L).gaps) && Number.isFinite(readout(L).nut));
    }
  });
}

test("a banjo's short string, in and out of the window", () => {
  const P = parsePitch;
  const banjo = { ...newInstrument({ frets: 22, strings: [
    { open: P("G4"), start: 5 }, { open: P("D3"), start: 0 }, { open: P("G3"), start: 0 },
    { open: P("B3"), start: 0 }, { open: P("D4"), start: 0 },
  ]}) };
  banjo.view = { ...banjo.view, span: 4 };
  const win = (L, s) => inWin(L).filter(c => c.string === s).map(c => c.fret);
  // Frets 0–4: the short string hasn't started in the window, but it starts
  // just past it, spike and all.
  let L = layout(banjo, BOX, 0);
  assert.deepEqual(win(L, 0), []);
  assert.ok(L.strings[0].spike && L.strings[0].line);
  // Frets 3–6: it starts here, at its spike, with its open position at 5.
  L = layout(banjo, BOX, 3);
  assert.deepEqual(win(L, 0), [5, 6]);
  assert.ok(L.strings[0].spike);
  // Frets 12–15: the spike is off the drawing; the string runs in from the edge.
  L = layout(banjo, BOX, 12);
  assert.deepEqual(win(L, 0), [12, 13, 14, 15]);
  assert.equal(L.strings[0].spike, null);
  assert.ok(L.strings[0].line);
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
