import { test } from "node:test";
import assert from "node:assert/strict";
import {
  select, drillsOf, byPosition, byNote, byString, overall, trend, limits, MIN_HEAT,
  fmtPct, fmtTime, fmtSpread, fmtDur,
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

test("limits: the mean plus and minus 2.66 average moving ranges", () => {
  const l = limits([10, 12, 11, 13]);           // moving ranges 2, 1, 2
  assert.ok(near(l.centre, 11.5));
  assert.ok(near(l.hi, 11.5 + 2.66 * 5 / 3));
  assert.ok(near(l.lo, 11.5 - 2.66 * 5 / 3));
});

test("limits on a log scale sit evenly either side by ratio, not difference", () => {
  const l = limits([1000, 2000, 1000, 2000], { log: true });
  assert.ok(near(l.centre, Math.SQRT2 * 1000, 1e-6));
  assert.ok(near(l.hi / l.centre, l.centre / l.lo, 1e-9));
  assert.ok(l.lo > 0);
});

test("limits skip missing values and need two points", () => {
  assert.equal(limits([]), null);
  assert.equal(limits([5, null]), null);
  assert.deepEqual(limits([5, null, 5]), { centre: 5, lo: 5, hi: 5 });
  assert.equal(limits([0, 1000], { log: true }), null);
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
