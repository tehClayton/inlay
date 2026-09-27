/* Backups: one JSON file with everything you've made — instruments and
   practice sessions — to keep, or to carry to another device. Pure: making,
   reading and merging them; store.js writes the result and the page handles
   the file.

   Device settings (note names, the drill last chosen) aren't in it: they
   describe this device, not your practice.

   Import merges rather than replaces, so bringing in a backup can only add
   to what's here: an instrument in both keeps whichever copy was changed
   more recently, and a session already here isn't added twice. */
import { upgrade, validate } from "./instrument.js";
import { isSession } from "./sessions.js";

export const BACKUP_APP = "inlay";
export const BACKUP_SCHEMA = 1;

export function makeBackup({ instruments, sessions }, now = Date.now()){
  return { app: BACKUP_APP, schema: BACKUP_SCHEMA, exported: now, instruments, sessions };
}

/* "inlay-backup-2026-09-27.json", in local time. */
export function backupFilename(date = new Date()){
  const p = n => String(n).padStart(2, "0");
  return `inlay-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.json`;
}

/* A backup file's text, checked all the way through before anything is
   written. A file that isn't an inlay backup, or was made by a newer inlay
   than this one, is refused whole: better nothing than half-understood. A
   record that doesn't hold up on its own is skipped, and counted. Older
   instrument shapes are upgraded, as they are on load. */
export function readBackup(text){
  let data;
  try { data = JSON.parse(text); }
  catch { return { ok: false, error: "That file isn't a backup: it can't be read as one." }; }
  if (!data || typeof data !== "object" || data.app !== BACKUP_APP){
    return { ok: false, error: "That file isn't an inlay backup." };
  }
  if (!Number.isInteger(data.schema) || data.schema < 1){
    return { ok: false, error: "That backup is damaged: it doesn't say which version made it." };
  }
  if (data.schema > BACKUP_SCHEMA){
    return { ok: false, error: "That backup was made by a newer version of inlay. Update the app, then import it." };
  }
  if (!Array.isArray(data.instruments) || (data.sessions !== undefined && !Array.isArray(data.sessions))){
    return { ok: false, error: "That backup is damaged: its contents aren't in the expected form." };
  }
  const instruments = data.instruments.map(upgrade).filter(x => validate(x).length === 0);
  const sessions = (data.sessions ?? []).filter(isSession);
  const skipped = data.instruments.length - instruments.length + (data.sessions ?? []).length - sessions.length;
  return { ok: true, instruments, sessions, skipped, exported: Number.isFinite(data.exported) ? data.exported : null };
}

/* Merges an incoming backup's records into what's here.

   Instruments are matched by id; where both have one, the more recently
   changed copy wins. Sessions are matched by instrument, start time and
   drill; one already here is left alone. A session whose instrument is in
   neither place can't be shown against anything, so it's skipped. At most
   `maxSessions` are kept, newest first, the same rule as saving. */
export function mergeBackup(local, incoming, maxSessions = Infinity){
  const counts = { added: 0, updated: 0, kept: 0, sessionsAdded: 0, duplicates: 0, orphans: 0, dropped: 0 };

  const byId = new Map(local.instruments.map(i => [i.id, i]));
  for (const inc of incoming.instruments){
    const here = byId.get(inc.id);
    if (!here){ byId.set(inc.id, inc); counts.added++; }
    else if (inc.updated > here.updated){ byId.set(inc.id, inc); counts.updated++; }
    else counts.kept++;
  }
  const instruments = [...byId.values()];

  const ids = new Set(byId.keys());
  const seen = new Set(local.sessions.map(s => `${s.inst}|${s.t}|${s.key}`));
  let sessions = [...local.sessions];
  for (const s of incoming.sessions){
    const k = `${s.inst}|${s.t}|${s.key}`;
    if (seen.has(k)){ counts.duplicates++; continue; }
    if (!ids.has(s.inst)){ counts.orphans++; continue; }
    seen.add(k);
    sessions.push(s);
    counts.sessionsAdded++;
  }
  sessions.sort((a, b) => a.t - b.t);
  if (sessions.length > maxSessions){
    counts.dropped = sessions.length - maxSessions;
    sessions = sessions.slice(counts.dropped);
  }
  return { instruments, sessions, counts };
}

/* What an import did, in a sentence. */
export function importSummary(c, skipped = 0){
  const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts = [];
  if (c.added) parts.push(`${n(c.added, "instrument")} added`);
  if (c.updated) parts.push(`${n(c.updated, "instrument")} updated`);
  if (c.sessionsAdded) parts.push(`${n(c.sessionsAdded, "session")} added`);
  if (!parts.length) parts.push("Nothing new: everything in it was already here");
  const notes = [];
  if (c.duplicates) notes.push(`${n(c.duplicates, "session")} already here`);
  if (c.orphans) notes.push(`${n(c.orphans, "session")} for missing instruments skipped`);
  if (skipped) notes.push(`${n(skipped, "damaged record")} skipped`);
  if (c.dropped) notes.push(`${n(c.dropped, "oldest session")} over the limit removed`);
  return parts.join(", ") + "." + (notes.length ? ` (${notes.join("; ")}.)` : "");
}
