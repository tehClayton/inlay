import { test } from "node:test";
import assert from "node:assert/strict";
import {
  select, drillsOf, byPosition, byNote, byString, overall, trend, limits, MIN_HEAT,
  fmtPct, fmtTime, fmtSpread, fmtDur, heat, ramp, MIN_MISS_SCALE, signals,
} from "../stats.js";
import { createRecorder, summarize } from "../sessions.js";
import { newInstrument } from "../instrument.js";
import { pitchClass } from "../theory.js";

const inst = newInstrument();              // E2 A2 D3 G3 B3 E4, 22 frets
const other = newInstrument();
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* A session from [pos, ok, ms] answers. */
function run(answers, { t = 1000, drill = "findAny", notes = "all", i = inst } = {}){
  const r = createRecorder({ inst: i, drill, notes, t });
  for (const [pos, ok, ms] of answers) r.add(pos, ok, ms, t + 1000);
  return r.record();
}
const at = (string, fret) => ({ string, fret });

test("select: one instrument's sessions, optionally one drill, oldest first", () => {
  const a = run([[at(0, 0), true, 900]], { t: 3000 });
  const b = run([[at(0, 0), true, 900]], { t: 1000, drill: "findOn" });
  const c = run([[at(0, 0), true, 900]], { t: 2000, i: other });
  assert.deepEqual(select([a, b, c], inst), [b, a]);
  assert.deepEqual(select([a, b, c], inst, a.key), [a]);
  assert.deepEqual(select([a, b, c], other), [c]);
});

test("drillsOf: each drill once, with its label and count, the most practised first", () => {
  const one = run([[at(0, 0), true, 900]], { t: 1 });
  const two = run([[at(0, 0), true, 900]], { t: 2, drill: "findOn" });
  const three = run([[at(0, 0), true, 900]], { t: 3, drill: "findOn" });
  const ds = drillsOf([one, two, three], inst);
  assert.deepEqual(ds.map(d => [d.key, d.sessions]), [[two.key, 2], [one.key, 1]]);
  assert.equal(ds[0].label, three.label);
});

test("by position: sessions add up, and thin positions are marked", () => {
  const s1 = run([[at(0, 3), true, 1000], [at(0, 3), false, 500], [at(1, 2), true, 2000]]);
  const s2 = run([[at(0, 3), true, 4000]], { t: 5000 });
  const ps = byPosition([s1, s2], inst);
  const g = ps.find(p => p.string === 0 && p.fret === 3);
  assert.equal(g.answers, 3);
  assert.ok(near(g.accuracy, 2 / 3));
  assert.ok(near(g.typicalMs, 2000));              // geometric mean of 1000 and 4000
  assert.equal(g.thin, 3 < MIN_HEAT);
  const d = ps.find(p => p.string === 1 && p.fret === 2);
  assert.equal(d.thin, true);
});

test("by position leaves out places no longer on the neck", () => {
  const s = run([[at(0, 20), true, 900], [at(5, 1), true, 900], [at(0, 1), true, 900]]);
  const shorter = { ...inst, frets: 12, strings: inst.strings.slice(0, 5) };
  const ps = byPosition([s], shorter);
  assert.deepEqual(ps.map(p => `${p.string}:${p.fret}`), ["0:1"]);
});

test("by note: every pitch class, pooled by the tuning", () => {
  // String 0 is the face-side string, low E2; string 5 the high E4. Both
  // open, and string 1 (A2) at fret 7, are all E.
  const s = run([[at(0, 0), true, 1000], [at(5, 0), false, 800], [at(1, 7), true, 1000],
                 [at(1, 0), true, 3000]]);
  const ns = byNote([s], inst);
  assert.equal(ns.length, 12);
  const e = ns[pitchClass(64)], a = ns[pitchClass(45)];
  assert.equal(e.answers, 3);
  assert.ok(near(e.accuracy, 2 / 3));
  assert.equal(a.answers, 1);
  assert.equal(ns.filter(n => n.answers === 0).length, 10);
  assert.equal(ns[1].accuracy, null);
  assert.equal(ns[1].typicalMs, null);
});

test("by string: every string, in the instrument's order", () => {
  const s = run([[at(0, 1), true, 1000], [at(0, 2), true, 1000], [at(3, 5), false, 900]]);
  const ss = byString([s], inst);
  assert.deepEqual(ss.map(x => x.answers), [2, 0, 0, 1, 0, 0]);
  assert.equal(ss[3].accuracy, 0);
});

test("overall matches a single session's own summary, and pools across several", () => {
  const s1 = run([[at(0, 1), true, 1000], [at(1, 1), false, 900]]);
  const s2 = run([[at(0, 1), true, 4000]], { t: 9000 });
  assert.deepEqual(overall([s1]), summarize(s1));
  const o = overall([s1, s2]);
  assert.equal(o.answers, 3);
  assert.ok(near(o.typicalMs, 2000));
  assert.deepEqual(overall([]), { answers: 0, accuracy: null, typicalMs: null, spread: 1 });
});

test("trend: a point per session, in order, with its totals", () => {
  const s1 = run([[at(0, 1), true, 1000]], { t: 1 });
  const s2 = run([[at(0, 1), false, 1000]], { t: 2 });
  const tr = trend([s1, s2]);
  assert.deepEqual(tr.map(p => [p.t, p.accuracy]), [[1, 1], [2, 0]]);
  assert.equal(tr[1].typicalMs, null);
  assert.equal(tr[0].label, s1.label);
});

test("limits: the mean plus and minus three sigmas, from the average moving range", () => {
  const l = limits([10, 12, 11, 13]);           // moving ranges 2, 1, 2
  const sigma = (5 / 3) / 1.128;
  assert.ok(near(l.centre, 11.5));
  assert.ok(near(l.sigma, sigma));
  assert.ok(near(l.hi, 11.5 + 3 * sigma));
  assert.ok(near(l.lo, 11.5 - 3 * sigma));
  assert.ok(Math.abs(3 * sigma - 2.66 * 5 / 3) < 0.01);   // the familiar 2.66
});

test("limits can be clamped to what the quantity can be", () => {
  const l = limits([0.9, 1, 0.8, 1], { range: [0, 1] });
  assert.equal(l.hi, 1);
  assert.ok(l.lo >= 0 && l.lo < 0.9);
});

test("limits on a log scale sit evenly either side by ratio, not difference", () => {
  const l = limits([1000, 2000, 1000, 2000], { log: true });
  assert.ok(near(l.centre, Math.SQRT2 * 1000, 1e-6));
  assert.ok(near(l.hi / l.centre, l.centre / l.lo, 1e-9));
  assert.ok(l.lo > 0);
});

test("limits skip missing values, need two points, and none for a flat line", () => {
  assert.equal(limits([]), null);
  assert.equal(limits([5, null]), null);
  assert.equal(limits([5, null, 5]), null);
  assert.equal(limits([0, 1000], { log: true }), null);
  assert.ok(limits([5, null, 6]));
});

/* Noise that stays well inside its limits: alternating around 10. */
const calm = n => Array.from({ length: n }, (_, i) => 10 + (i % 2 ? 1 : -1));

test("signals: none in steady noise", () => {
  assert.ok(signals(calm(20)).every(f => f.length === 0));
});

test("signals, rule 1: a point outside the limits", () => {
  const v = [...calm(20), 30];
  const f = signals(v);
  assert.ok(f[20].includes(1));
  assert.ok(f.slice(0, 20).every(x => !x.includes(1)));
});

test("signals, rule 2: eight in a row on one side, flagged from the eighth", () => {
  // calm(13) ends below the centre, so the run starts after it.
  const v = [...calm(13), 10.5, 10.6, 10.5, 10.7, 10.5, 10.6, 10.5, 10.6];
  const f = signals(v);
  const at = f.map((x, i) => x.includes(2) ? i : -1).filter(i => i >= 0);
  assert.deepEqual(at, [20]);
});

test("signals, rule 3: six in a row moving one way", () => {
  const v = [...calm(10), 10, 10.1, 10.2, 10.3, 10.4, 10.5];
  const f = signals(v);
  assert.ok(f[15].includes(3));
  assert.ok(!f[14].includes(3));
});

test("signals, rule 5: two of three past two sigmas on one side", () => {
  // 17 sits about 2.5 sigmas above this series' centre: past 2, inside 3.
  const f = signals([...calm(16), 17, 10, 17]);
  assert.deepEqual(f.slice(16), [[], [], [5]]);
});

test("signals work on logged values, and step over sessions with no value", () => {
  const v = [...calm(20).map(x => x * 100), null, 5000];
  const f = signals(v, { log: true });
  assert.deepEqual(f[20], []);
  assert.ok(f[21].includes(1));
  assert.equal(f.length, v.length);
});

test("formatting: a dash for nothing, never a zero that looks like a result", () => {
  assert.equal(fmtPct(null), "—");
  assert.equal(fmtPct(0), "0%");
  assert.equal(fmtPct(2 / 3), "67%");
  assert.equal(fmtTime(null), "—");
  assert.equal(fmtTime(1234), "1.23 s");
  assert.equal(fmtTime(12345), "12.3 s");
  assert.equal(fmtSpread(null), "—");
  assert.equal(fmtSpread(1.4), "×1.40");
  assert.equal(fmtDur(0), "0:00");
  assert.equal(fmtDur(42400), "0:42");
  assert.equal(fmtDur(725000), "12:05");
  assert.equal(fmtDur(3723000), "1:02:03");
});

const P = (string, fret, typicalMs, accuracy, thin = false) =>
  ({ string, fret, typicalMs, accuracy, thin, answers: thin ? 1 : 10 });

test("heat by time: fastest to slowest on a log scale", () => {
  const { cells, lo, hi } = heat([P(0, 1, 1000, 1), P(0, 2, 2000, 1), P(0, 3, 4000, 1)], "time");
  assert.equal(lo, 1000);
  assert.equal(hi, 4000);
  assert.deepEqual(cells.map(c => c.t), [0, 0.5, 1]);
  assert.ok(cells.every(c => !c.hollow));
});

test("heat: thin positions don't set the scale, and are hollow and clamped", () => {
  const { cells, hi } = heat([P(0, 1, 1000, 1), P(0, 2, 2000, 1), P(0, 3, 9000, 1, true)], "time");
  assert.equal(hi, 2000);
  assert.equal(cells[2].t, 1);
  assert.equal(cells[2].hollow, true);
});

test("heat by miss rate: from none missed, to at least the minimum scale", () => {
  const few = heat([P(0, 1, 1000, 1), P(0, 2, 1000, 0.9)], "miss");
  assert.equal(few.hi, MIN_MISS_SCALE);
  assert.ok(Math.abs(few.cells[1].t - 0.1 / MIN_MISS_SCALE) < 1e-9);
  assert.equal(few.cells[0].t, 0);
  const many = heat([P(0, 1, 1000, 1), P(0, 2, 1000, 0.5)], "miss");
  assert.equal(many.hi, 0.5);
  assert.equal(many.cells[1].t, 1);
});

test("heat: a spot with no time to show is hollow with no value", () => {
  const { cells } = heat([P(0, 1, 1000, 1), P(0, 2, null, 0)], "time");
  assert.equal(cells[1].t, null);
  assert.equal(cells[1].hollow, true);
  // The same spot has a miss rate, and a full one.
  assert.equal(heat([P(0, 1, 1000, 1), P(0, 2, null, 0)], "miss").cells[1].t, 1);
});

test("heat: one trusted time sits mid-scale; nothing trusted gives no scale", () => {
  assert.equal(heat([P(0, 1, 1500, 1)], "time").cells[0].t, 0.5);
  const none = heat([P(0, 1, 1500, 1, true)], "time");
  assert.equal(none.lo, null);
  assert.equal(none.cells[0].t, null);
});

test("ramp: cool slate to amber, muted for nothing to rate", () => {
  assert.equal(ramp(0), "#33414f");
  assert.equal(ramp(1), "#e8a33d");
  assert.equal(ramp(2), ramp(1));
  assert.equal(ramp(null), "#66788C");
  assert.match(ramp(0.5), /^#[0-9a-f]{6}$/);
});
