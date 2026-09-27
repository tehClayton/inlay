import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeBackup, readBackup, mergeBackup, backupFilename, importSummary, BACKUP_SCHEMA,
} from "../backup.js";
import { newInstrument, VIEW_PRESETS } from "../instrument.js";
import { createRecorder } from "../sessions.js";

function session(inst, t, drill = "findOn"){
  const r = createRecorder({ inst, drill, t });
  for (let i = 0; i < 5; i++) r.add({ string: i, fret: i + 1 }, i !== 2, 1000 + i, t + i);
  return r.record();
}

const text = x => JSON.stringify(x);

test("a backup round-trips through its own reader", () => {
  const g = newInstrument({ name: "Strat" });
  const b = makeBackup({ instruments: [g], sessions: [session(g, 10)] }, 123);
  assert.equal(b.app, "inlay");
  assert.equal(b.schema, BACKUP_SCHEMA);
  const r = readBackup(text(b));
  assert.ok(r.ok);
  assert.deepEqual(r.instruments, [g]);
  assert.equal(r.sessions.length, 1);
  assert.equal(r.skipped, 0);
  assert.equal(r.exported, 123);
});

test("files that aren't a readable inlay backup are refused whole", () => {
  const cases = [
    ["{not json", /can't be read/],
    [text({ app: "millitap", schema: 1, instruments: [] }), /isn't an inlay backup/],
    [text([1, 2]), /isn't an inlay backup/],
    [text({ app: "inlay", instruments: [] }), /doesn't say which version/],
    [text({ app: "inlay", schema: 2, instruments: [] }), /newer version/],
    [text({ app: "inlay", schema: 1, instruments: {} }), /expected form/],
    [text({ app: "inlay", schema: 1, instruments: [], sessions: "x" }), /expected form/],
  ];
  for (const [t, why] of cases){
    const r = readBackup(t);
    assert.equal(r.ok, false, t);
    assert.match(r.error, why);
  }
});

test("damaged records are skipped and counted; old shapes are upgraded", () => {
  const g = newInstrument();
  const { view, ...old } = newInstrument({ name: "Old" });
  const r = readBackup(text({
    app: "inlay", schema: 1,
    instruments: [g, { ...old, tabView: true }, { id: "x" }],
    sessions: [session(g, 1), { t: "nope" }],
  }));
  assert.ok(r.ok);
  assert.deepEqual(r.instruments.map(i => i.name), [g.name, "Old"]);
  assert.deepEqual(r.instruments[1].view, { ...VIEW_PRESETS.tab, span: 0 });
  assert.equal(r.sessions.length, 1);
  assert.equal(r.skipped, 2);
});

test("a backup without sessions is fine", () => {
  const r = readBackup(text({ app: "inlay", schema: 1, instruments: [newInstrument()] }));
  assert.ok(r.ok);
  assert.deepEqual(r.sessions, []);
});

test("merging: new instruments are added, and the newer copy of a shared one wins", () => {
  const mine = newInstrument({ name: "Mine" }, 100);
  const shared = newInstrument({ name: "Shared, old" }, 100);
  const theirs = newInstrument({ name: "Theirs" }, 100);
  const sharedNewer = { ...shared, name: "Shared, new", updated: 200 };
  const sharedOlder = { ...shared, name: "Shared, older", updated: 50 };

  let m = mergeBackup({ instruments: [mine, shared], sessions: [] },
                      { instruments: [theirs, sharedNewer], sessions: [] });
  assert.deepEqual(m.instruments.map(i => i.name).sort(), ["Mine", "Shared, new", "Theirs"]);
  assert.equal(m.counts.added, 1);
  assert.equal(m.counts.updated, 1);

  m = mergeBackup({ instruments: [shared], sessions: [] }, { instruments: [sharedOlder], sessions: [] });
  assert.deepEqual(m.instruments.map(i => i.name), ["Shared, old"]);
  assert.equal(m.counts.kept, 1);
});

test("merging: sessions already here aren't added twice; orphans are skipped", () => {
  const g = newInstrument(), gone = newInstrument();
  const here = session(g, 10), same = session(g, 10), fresh = session(g, 20), orphan = session(gone, 30);
  const m = mergeBackup({ instruments: [g], sessions: [here] },
                        { instruments: [], sessions: [same, fresh, orphan] });
  assert.deepEqual(m.sessions.map(s => s.t), [10, 20]);
  assert.equal(m.counts.sessionsAdded, 1);
  assert.equal(m.counts.duplicates, 1);
  assert.equal(m.counts.orphans, 1);
});

test("merging brings sessions whose instrument arrives in the same backup", () => {
  const theirs = newInstrument();
  const m = mergeBackup({ instruments: [], sessions: [] },
                        { instruments: [theirs], sessions: [session(theirs, 5)] });
  assert.equal(m.sessions.length, 1);
});

test("merging keeps the newest sessions under the limit", () => {
  const g = newInstrument();
  const m = mergeBackup({ instruments: [g], sessions: [session(g, 1), session(g, 3)] },
                        { instruments: [], sessions: [session(g, 2), session(g, 4)] }, 3);
  assert.deepEqual(m.sessions.map(s => s.t), [2, 3, 4]);
  assert.equal(m.counts.dropped, 1);
});

test("the filename carries the date", () => {
  assert.equal(backupFilename(new Date(2026, 8, 7)), "inlay-backup-2026-09-07.json");
});

test("the import summary says what happened", () => {
  assert.equal(importSummary({ added: 1, updated: 0, kept: 0, sessionsAdded: 12, duplicates: 3, orphans: 0, dropped: 0 }),
    "1 instrument added, 12 sessions added. (3 sessions already here.)");
  assert.equal(importSummary({ added: 0, updated: 0, kept: 2, sessionsAdded: 0, duplicates: 5, orphans: 0, dropped: 0 }, 1),
    "Nothing new: everything in it was already here. (5 sessions already here; 1 damaged record skipped.)");
});
