import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  KEYS, loadInstruments, saveInstrument, deleteInstrument,
  loadSettings, saveSettings, SETTINGS_DEFAULTS,
  loadSessions, sessionsFor, saveSession, deleteSessionsFor, MAX_SESSIONS,
  loadAll, writeAll, deleteAllData,
} from "../store.js";
import { newInstrument, VIEW_PRESETS } from "../instrument.js";
import { createRecorder } from "../sessions.js";

/* A small real session for instrument `inst`, started at t. */
function session(inst, t, answers = 5){
  const r = createRecorder({ inst, drill: "findOn", t });
  for (let i = 0; i < answers; i++) r.add({ string: i % 6, fret: i % 12 }, i % 4 !== 0, 900 + i * 10, t + i);
  return r.record();
}

/* A stand-in for localStorage, with a switch to make it behave the way a
   blocked or full store does: every access throws. */
class FakeStorage {
  constructor(){ this.m = new Map(); this.broken = false; this.limit = Infinity; }
  get length(){ if (this.broken) throw new Error("blocked"); return this.m.size; }
  key(i){ if (this.broken) throw new Error("blocked"); return [...this.m.keys()][i] ?? null; }
  getItem(k){ if (this.broken) throw new Error("blocked"); return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v){
    if (this.broken) throw new Error("blocked");
    // Full: the total stored would pass the limit, as a browser's quota does.
    let size = String(v).length;
    for (const [key, val] of this.m) if (key !== k) size += val.length;
    if (size > this.limit){ const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }
    this.m.set(k, String(v));
  }
  removeItem(k){ if (this.broken) throw new Error("blocked"); this.m.delete(k); }
}

let store;
beforeEach(() => { store = new FakeStorage(); globalThis.localStorage = store; });

test("keys are prefixed so millitap's storage is never touched", () => {
  for (const k of Object.values(KEYS)) assert.match(k, /^inlay\./);
});

test("instruments round-trip and replace by id", () => {
  assert.deepEqual(loadInstruments(), []);
  const g = newInstrument({}, 1);
  assert.ok(saveInstrument(g, 2));
  assert.equal(loadInstruments().length, 1);
  assert.equal(loadInstruments()[0].updated, 2);

  assert.ok(saveInstrument({ ...g, name: "Strat" }, 3));
  const list = loadInstruments();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Strat");
  assert.equal(list[0].created, 1);
});

test("an invalid instrument is refused and leaves storage alone", () => {
  const g = newInstrument();
  saveInstrument(g);
  assert.equal(saveInstrument({ ...g, frets: 0 }), false);
  assert.equal(loadInstruments()[0].frets, g.frets);
});

test("stored records that no longer validate are dropped on load", () => {
  const good = newInstrument();
  store.setItem(KEYS.instruments, JSON.stringify([good, { id: "x" }, null]));
  assert.deepEqual(loadInstruments().map(x => x.id), [good.id]);
});

test("instruments stored in the old shape load upgraded, not dropped", () => {
  const { view, ...old } = newInstrument({ name: "Old" });
  store.setItem(KEYS.instruments, JSON.stringify([{ ...old, tabView: false }]));
  const [loaded] = loadInstruments();
  assert.equal(loaded.name, "Old");
  assert.deepEqual(loaded.view, { ...VIEW_PRESETS.flipped, span: 0 });
  assert.ok(!("tabView" in loaded));
});

test("corrupt JSON reads as empty", () => {
  store.setItem(KEYS.instruments, "{not json");
  assert.deepEqual(loadInstruments(), []);
  store.setItem(KEYS.instruments, JSON.stringify({ not: "a list" }));
  assert.deepEqual(loadInstruments(), []);
});

test("delete removes only that instrument", () => {
  const a = newInstrument({ name: "A" }), b = newInstrument({ name: "B" });
  saveInstrument(a); saveInstrument(b);
  assert.ok(deleteInstrument(a.id));
  assert.deepEqual(loadInstruments().map(x => x.name), ["B"]);
});

test("settings default, merge, and ignore invalid values", () => {
  assert.deepEqual(loadSettings(), SETTINGS_DEFAULTS);
  assert.ok(saveSettings({ notePref: "flat" }));
  assert.ok(saveSettings({ instrument: "abc" }));
  assert.ok(saveSettings({ drill: "findAll", drillNotes: "naturals" }));
  const want = { ...SETTINGS_DEFAULTS, notePref: "flat", instrument: "abc", drill: "findAll", drillNotes: "naturals" };
  assert.deepEqual(loadSettings(), want);

  saveSettings({ notePref: "sideways", drill: "juggle", drillNotes: "some", bogus: 1 });
  assert.deepEqual(loadSettings(), want);
});

test("the interval drill's intervals: all by default, and never none, repeats or strays", () => {
  assert.deepEqual(loadSettings().drillIntervals, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(saveSettings({ drillIntervals: [3, 4, 7] }));
  assert.deepEqual(loadSettings().drillIntervals, [3, 4, 7]);
  for (const bad of [[], [3, 3], [0], [13], "3", [3.5]]){
    saveSettings({ drillIntervals: bad });
    assert.deepEqual(loadSettings().drillIntervals, [3, 4, 7], JSON.stringify(bad));
  }
});

test("the chord drill's types and the theory drills' root", () => {
  assert.deepEqual(loadSettings().drillChords, ["major", "minor", "dom7"]);
  assert.equal(loadSettings().drillRoot, null);
  assert.ok(saveSettings({ drillChords: ["maj7", "min7"], drillRoot: 9 }));
  assert.deepEqual(loadSettings().drillChords, ["maj7", "min7"]);
  assert.equal(loadSettings().drillRoot, 9);
  for (const bad of [[], ["major", "major"], ["power"], "major"]){
    saveSettings({ drillChords: bad });
    assert.deepEqual(loadSettings().drillChords, ["maj7", "min7"], JSON.stringify(bad));
  }
  for (const bad of [12, -1, 1.5, "A"]){
    saveSettings({ drillRoot: bad });
    assert.equal(loadSettings().drillRoot, 9, JSON.stringify(bad));
  }
  assert.ok(saveSettings({ drillRoot: null }));
  assert.equal(loadSettings().drillRoot, null);
});

test("the scale drill's types and order", () => {
  assert.deepEqual(loadSettings().drillScales, ["major", "minor", "minorPentatonic"]);
  assert.equal(loadSettings().drillScaleOrder, "any");
  assert.ok(saveSettings({ drillScales: ["dorian", "blues"], drillScaleOrder: "up" }));
  assert.deepEqual(loadSettings().drillScales, ["dorian", "blues"]);
  assert.equal(loadSettings().drillScaleOrder, "up");
  for (const bad of [[], ["dorian", "dorian"], ["bebop"]]){
    saveSettings({ drillScales: bad });
    assert.deepEqual(loadSettings().drillScales, ["dorian", "blues"], JSON.stringify(bad));
  }
  saveSettings({ drillScaleOrder: "down" });
  assert.equal(loadSettings().drillScaleOrder, "up");
});

test("a bad stored setting falls back without spoiling the rest", () => {
  store.setItem(KEYS.settings, JSON.stringify({ notePref: 7, instrument: "abc", drill: "name" }));
  assert.deepEqual(loadSettings(), { ...SETTINGS_DEFAULTS, instrument: "abc", drill: "name" });
});

test("sessions save, load oldest first, and group by instrument", () => {
  const a = newInstrument(), b = newInstrument();
  assert.deepEqual(saveSession(session(a, 300)), { ok: true, pruned: 0 });
  saveSession(session(b, 200));
  saveSession(session(a, 100));
  assert.deepEqual(loadSessions().map(s => s.t), [100, 200, 300]);
  assert.deepEqual(sessionsFor(a.id).map(s => s.t), [100, 300]);
});

test("saving the same run again replaces it rather than adding another", () => {
  const a = newInstrument();
  saveSession(session(a, 100, 5));
  saveSession(session(a, 100, 9));             // saved when hidden, then on Stop
  const list = loadSessions();
  assert.equal(list.length, 1);
  assert.equal(Object.values(list[0].pos).reduce((n, v) => n + v[0], 0), 9);
});

test("malformed sessions are refused on save and dropped on load", () => {
  const a = newInstrument();
  assert.equal(saveSession({ t: 1 }).ok, false);
  store.setItem(KEYS.sessions, JSON.stringify([session(a, 5), { junk: true }, null]));
  assert.equal(loadSessions().length, 1);
});

test("only the newest MAX_SESSIONS are kept", () => {
  const a = newInstrument();
  const many = Array.from({ length: MAX_SESSIONS }, (_, i) => session(a, i + 1, 1));
  store.setItem(KEYS.sessions, JSON.stringify(many));
  const r = saveSession(session(a, MAX_SESSIONS + 1, 5));
  assert.deepEqual(r, { ok: true, pruned: 1 });
  const list = loadSessions();
  assert.equal(list.length, MAX_SESSIONS);
  assert.equal(list[0].t, 2);                  // the oldest went
});

test("a full store drops the oldest tenth and tries again", () => {
  const a = newInstrument();
  for (let t = 1; t <= 40; t++) saveSession(session(a, t));
  store.limit = store.m.get(KEYS.sessions).length;   // exactly full
  const r = saveSession(session(a, 41));
  assert.ok(r.ok);
  assert.ok(r.pruned >= 4, `pruned ${r.pruned}`);
  const list = loadSessions();
  assert.equal(list.at(-1).t, 41);             // the new one is kept
  assert.ok(list[0].t > 1);                    // the oldest went
});

test("if even one session won't fit, the save fails and nothing is lost", () => {
  const a = newInstrument();
  saveSession(session(a, 1));
  const before = store.m.get(KEYS.sessions);
  store.limit = 10;
  assert.deepEqual(saveSession(session(a, 2)), { ok: false, pruned: 0 });
  assert.equal(store.m.get(KEYS.sessions), before);
});

test("deleting an instrument deletes its sessions, and only its", () => {
  const a = newInstrument(), b = newInstrument();
  saveInstrument(a); saveInstrument(b);
  saveSession(session(a, 1)); saveSession(session(b, 2));
  assert.ok(deleteInstrument(a.id));
  assert.deepEqual(loadSessions().map(s => s.inst), [b.id]);
  assert.ok(deleteSessionsFor("nobody"));
});

test("writeAll writes instruments and sessions together", () => {
  const a = newInstrument();
  assert.ok(writeAll({ instruments: [a], sessions: [session(a, 1), session(a, 2)] }));
  const all = loadAll();
  assert.deepEqual(all.instruments.map(i => i.id), [a.id]);
  assert.equal(all.sessions.length, 2);
});

test("if the sessions don't fit, the instruments are put back: no half import", () => {
  const a = newInstrument({ name: "Here" }), b = newInstrument({ name: "Incoming" });
  saveInstrument(a);
  const before = store.m.get(KEYS.instruments);
  // Room for a second instrument, not for the sessions that come with it.
  store.limit = before.length * 2 + 50;
  const many = Array.from({ length: 30 }, (_, i) => session(b, i + 1));
  assert.equal(writeAll({ instruments: [a, b], sessions: many }), false);
  assert.equal(store.m.get(KEYS.instruments), before);
  assert.deepEqual(loadInstruments().map(i => i.name), ["Here"]);
});

test("delete all removes every inlay key and leaves millitap's alone", () => {
  saveInstrument(newInstrument());
  saveSettings({ notePref: "flat" });
  store.setItem("millitap.sessions.v1", "[]");
  store.setItem("something.else", "x");
  assert.ok(deleteAllData());
  assert.deepEqual([...store.m.keys()].sort(), ["millitap.sessions.v1", "something.else"]);
});

test("the last export date is a setting, null until the first", () => {
  assert.equal(loadSettings().lastExport, null);
  saveSettings({ lastExport: 1790000000000 });
  assert.equal(loadSettings().lastExport, 1790000000000);
  saveSettings({ lastExport: "yesterday" });
  assert.equal(loadSettings().lastExport, 1790000000000);
});

test("blocked storage reads empty and reports failed writes", () => {
  store.broken = true;
  assert.deepEqual(loadInstruments(), []);
  assert.deepEqual(loadSettings(), SETTINGS_DEFAULTS);
  assert.equal(saveInstrument(newInstrument()), false);
  assert.equal(saveSettings({ notePref: "flat" }), false);
  assert.equal(deleteInstrument("x"), false);
  assert.deepEqual(loadSessions(), []);
  assert.deepEqual(saveSession(session(newInstrument(), 1)), { ok: false, pruned: 0 });
  assert.equal(writeAll({ instruments: [], sessions: [] }), false);
  assert.equal(deleteAllData(), false);
});
