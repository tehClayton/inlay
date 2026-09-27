import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRecorder, totals, summarize, isSession, sessionKey, sessionLabel, MIN_ANSWERS,
} from "../sessions.js";
import { newInstrument } from "../instrument.js";
import { SLOW_MS } from "../drills.js";

const inst = newInstrument();
const A = { string: 0, fret: 5 }, B = { string: 1, fret: 7 };

test("a recorder aggregates answers by position", () => {
  const r = createRecorder({ inst, drill: "findOn", t: 1000 });
  r.add(A, true, 1000, 2000);
  r.add(A, true, 4000, 3000);
  r.add(A, false, 500, 4000);
  r.add(B, true, SLOW_MS + 1, 5000);     // right, too slow to time
  assert.equal(r.answers, 4);
  const s = r.record();
  assert.equal(s.inst, inst.id);
  assert.equal(s.t, 1000);
  assert.equal(s.dur, 4000);
  assert.deepEqual(Object.keys(s.pos).sort(), ["0:5", "1:7"]);
  const [n, miss, timed, sumLn, sumLn2] = s.pos["0:5"];
  assert.deepEqual([n, miss, timed], [3, 1, 2]);
  assert.ok(Math.abs(sumLn - (Math.log(1000) + Math.log(4000))) < 1e-9);
  assert.ok(Math.abs(sumLn2 - (Math.log(1000) ** 2 + Math.log(4000) ** 2)) < 1e-9);
  assert.deepEqual(s.pos["1:7"], [1, 0, 0, 0, 0]);
  assert.ok(isSession(s));
});

test("a record is a snapshot: later answers don't change it", () => {
  const r = createRecorder({ inst, drill: "name", t: 0 });
  r.add(A, true, 900, 10);
  const first = r.record();
  r.add(A, true, 900, 20);
  assert.equal(first.pos["0:5"][0], 1);
  assert.equal(r.record().pos["0:5"][0], 2);
});

test("totals: accuracy, typical time and spread, by adding up", () => {
  const t = totals([[3, 1, 2, Math.log(1000) + Math.log(4000), Math.log(1000) ** 2 + Math.log(4000) ** 2],
                    [1, 0, 0, 0, 0]]);
  assert.equal(t.answers, 4);
  assert.equal(t.accuracy, 0.75);
  assert.ok(Math.abs(t.typicalMs - 2000) < 1e-6);     // geometric mean of 1s and 4s
  assert.ok(Math.abs(t.spread - 2) < 1e-6);           // each is 2x from 2s
  assert.deepEqual(totals([]), { answers: 0, accuracy: null, typicalMs: null, spread: 1 });
});

test("summarize a whole session", () => {
  const r = createRecorder({ inst, drill: "findAny", t: 0 });
  for (let i = 0; i < 6; i++) r.add(i % 2 ? A : B, i !== 3, 1500, i);
  const s = summarize(r.record());
  assert.equal(s.answers, 6);
  assert.ok(Math.abs(s.accuracy - 5 / 6) < 1e-9);
  assert.ok(Math.abs(s.typicalMs - 1500) < 1e-6);
});

test("keys group the same drill and filters; labels say it in words", () => {
  assert.equal(sessionKey({ drill: "findOn", notes: "all", strings: null }), "findOn:all:all");
  assert.equal(sessionKey({ drill: "name", notes: "naturals", strings: [0, 2] }), "name:naturals:0.2");
  assert.equal(sessionLabel({ drill: "findAllNeck", notes: "all", strings: null }, inst), "Find all on the neck");
  assert.equal(sessionLabel({ drill: "name", notes: "naturals", strings: [0, 1] }, inst),
    "Name the note · naturals · 2 of 6 strings");
});

test("isSession rejects anything malformed", () => {
  const good = createRecorder({ inst, drill: "findAny", t: 5 });
  good.add(A, true, 800, 6);
  const s = good.record();
  assert.ok(isSession(s));
  for (const bad of [
    null, 3, {}, { ...s, t: "x" }, { ...s, inst: "" }, { ...s, drill: "juggle" },
    { ...s, dur: -1 }, { ...s, pos: { "a:b": [1, 0, 0, 0, 0] } },
    { ...s, pos: { "0:5": [1, 0, 0] } }, { ...s, pos: { "0:5": [1, 1, 1, 0, 0] } },
    { ...s, pos: { "0:5": [0, 0, 0, 0, 0] } },
  ]) assert.equal(isSession(bad), false, JSON.stringify(bad));
});

test("the minimum run worth keeping", () => {
  assert.equal(MIN_ANSWERS, 5);
});
