import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  KEYS, loadInstruments, saveInstrument, deleteInstrument,
  loadSettings, saveSettings, SETTINGS_DEFAULTS,
} from "../store.js";
import { newInstrument, VIEW_PRESETS } from "../instrument.js";

/* A stand-in for localStorage, with a switch to make it behave the way a
   blocked or full store does: every access throws. */
class FakeStorage {
  constructor(){ this.m = new Map(); this.broken = false; }
  getItem(k){ if (this.broken) throw new Error("blocked"); return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v){ if (this.broken) throw new Error("blocked"); this.m.set(k, String(v)); }
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

test("a bad stored setting falls back without spoiling the rest", () => {
  store.setItem(KEYS.settings, JSON.stringify({ notePref: 7, instrument: "abc", drill: "name" }));
  assert.deepEqual(loadSettings(), { ...SETTINGS_DEFAULTS, instrument: "abc", drill: "name" });
});

test("blocked storage reads empty and reports failed writes", () => {
  store.broken = true;
  assert.deepEqual(loadInstruments(), []);
  assert.deepEqual(loadSettings(), SETTINGS_DEFAULTS);
  assert.equal(saveInstrument(newInstrument()), false);
  assert.equal(saveSettings({ notePref: "flat" }), false);
  assert.equal(deleteInstrument("x"), false);
});
