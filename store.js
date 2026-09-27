/* All persistence. Nothing else touches localStorage.

   Every key starts "inlay." because millitap is served from the same origin
   and shares this storage; nothing here ever calls localStorage.clear(). Keys
   carry a schema version so a future change of shape can migrate rather than
   misread. Storage can be blocked outright (private modes, embedded views), so
   reads fall back to empty and writes report failure instead of throwing.

   Sets join this file in a later milestone. */
import { validate as validateInstrument, upgrade as upgradeInstrument } from "./instrument.js";
import { NOTE_PREFS, CHORDS, SCALES } from "./theory.js";
import { DRILL_KINDS, ALL_INTERVALS, DEFAULT_CHORDS, DEFAULT_SCALES } from "./drills.js";
import { isSession } from "./sessions.js";

export const KEYS = {
  instruments: "inlay.instruments.v1",
  settings:    "inlay.settings.v1",
  sessions:    "inlay.sessions.v1",
};

function read(key, fallback){
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value){
  return tryWrite(key, value) === "ok";
}

/* "ok", "quota" when storage is full, or "error" for anything else, such as
   storage being blocked. Browsers name a full store differently. */
function tryWrite(key, value){
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return "ok";
  } catch (e) {
    const full = e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED"
                       || e.code === 22 || e.code === 1014);
    return full ? "quota" : "error";
  }
}

/* ---------------------------------------------------------- instruments */

/* Older shapes are upgraded on the way in. Anything that still doesn't
   validate is dropped rather than half-used: a record the app can't draw is
   worse than one it doesn't show. */
export function loadInstruments(){
  const list = read(KEYS.instruments, []);
  return Array.isArray(list)
    ? list.map(upgradeInstrument).filter(x => validateInstrument(x).length === 0)
    : [];
}

/* Insert or replace by id, stamping `updated`. Returns false if the write
   failed or the instrument is invalid; the stored list is then unchanged. */
export function saveInstrument(inst, now = Date.now()){
  const next = { ...inst, updated: now };
  if (validateInstrument(next).length) return false;
  const list = loadInstruments();
  const i = list.findIndex(x => x.id === next.id);
  if (i >= 0) list[i] = next; else list.push(next);
  return write(KEYS.instruments, list);
}

/* Its sessions go with it: history for an instrument that's gone can't be
   shown against anything. */
export function deleteInstrument(id){
  return deleteSessionsFor(id) && write(KEYS.instruments, loadInstruments().filter(x => x.id !== id));
}

/* ------------------------------------------------------------- sessions */

export const MAX_SESSIONS = 2000;

/* Every stored session, oldest first; anything malformed is dropped. */
export function loadSessions(){
  const list = read(KEYS.sessions, []);
  return Array.isArray(list) ? list.filter(isSession).sort((a, b) => a.t - b.t) : [];
}

export const sessionsFor = inst => loadSessions().filter(s => s.inst === inst);

/* Saves a session, replacing any earlier save of the same run (same
   instrument and start time), so a run saved when the page was hidden and
   again on Stop is one record. Keeps the newest MAX_SESSIONS. If storage is
   full, the oldest tenth goes and it tries again, until it fits or there's
   nothing older left to drop. Returns { ok, pruned }: how many old sessions
   went to make room, so the page can suggest an export. */
export function saveSession(s){
  if (!isSession(s)) return { ok: false, pruned: 0 };
  let list = loadSessions().filter(x => !(x.inst === s.inst && x.t === s.t));
  list.push(s);
  list.sort((a, b) => a.t - b.t);
  let pruned = 0;
  if (list.length > MAX_SESSIONS){ pruned = list.length - MAX_SESSIONS; list = list.slice(pruned); }
  for (;;){
    const r = tryWrite(KEYS.sessions, list);
    if (r === "ok") return { ok: true, pruned };
    const older = list.filter(x => x !== s).length;
    if (r !== "quota" || !older) return { ok: false, pruned: 0 };
    const drop = Math.max(1, Math.floor(list.length / 10));
    list = [...list.filter(x => x !== s).slice(drop), s].sort((a, b) => a.t - b.t);
    pruned += drop;
  }
}

/* ------------------------------------------------------------- your data */

/* Everything a backup carries. */
export const loadAll = () => ({ instruments: loadInstruments(), sessions: loadSessions() });

/* Writes a merged import: instruments, then sessions. If the sessions don't
   fit, the instruments are put back as they were, so an import never half
   happens. Returns true if both were written. */
export function writeAll({ instruments, sessions }){
  const before = (() => { try { return localStorage.getItem(KEYS.instruments); } catch { return null; } })();
  if (!write(KEYS.instruments, instruments)) return false;
  if (write(KEYS.sessions, sessions)) return true;
  try {
    if (before === null) localStorage.removeItem(KEYS.instruments);
    else localStorage.setItem(KEYS.instruments, before);
  } catch { /* storage refusing even that: nothing more to do */ }
  return false;
}

/* Deletes everything inlay has stored, and nothing else: millitap shares
   this storage, so this is every "inlay." key rather than clear(). */
export function deleteAllData(){
  try {
    const mine = [];
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if (k && k.startsWith("inlay.")) mine.push(k);
    }
    for (const k of mine) localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function deleteSessionsFor(inst){
  const all = read(KEYS.sessions, null);
  if (all === null) return true;               // nothing stored, nothing to do
  return write(KEYS.sessions, loadSessions().filter(s => s.inst !== inst));
}

/* ------------------------------------------------------------- settings */

/* Device preferences. Not part of a backup: they describe this device, not
   your practice. */
export const SETTINGS_DEFAULTS = Object.freeze({
  notePref: "sharp",     // sharp | flat | both
  instrument: null,      // id of the instrument last used
  drill: "findOn",       // the drill last chosen: see drills.js
  drillNotes: "all",     // all | naturals
  drillIntervals: ALL_INTERVALS,   // the interval drill's intervals, as semitones
  drillChords: DEFAULT_CHORDS,     // the chord drill's chord types (theory.js CHORDS)
  drillScales: DEFAULT_SCALES,     // the scale drill's scale types (theory.js SCALES)
  drillScaleOrder: "any",          // any | up
  drillRoot: null,                 // the theory drills' root: a pitch class, or null for random
  lastExport: null,      // when a backup was last exported from this device, ms
});

const SETTINGS_VALID = {
  notePref: v => NOTE_PREFS.includes(v),
  instrument: v => v === null || typeof v === "string",
  drill: v => DRILL_KINDS.includes(v),
  drillNotes: v => v === "all" || v === "naturals",
  drillIntervals: v => Array.isArray(v) && v.length > 0 && new Set(v).size === v.length &&
    v.every(s => ALL_INTERVALS.includes(s)),
  drillChords: v => Array.isArray(v) && v.length > 0 && new Set(v).size === v.length &&
    v.every(id => Object.hasOwn(CHORDS, id)),
  drillScales: v => Array.isArray(v) && v.length > 0 && new Set(v).size === v.length &&
    v.every(id => Object.hasOwn(SCALES, id)),
  drillScaleOrder: v => v === "any" || v === "up",
  drillRoot: v => v === null || (Number.isInteger(v) && v >= 0 && v < 12),
  lastExport: v => v === null || (Number.isFinite(v) && v > 0),
};

/* Defaults, overlaid with whatever stored values are still valid, so a bad
   or outdated field falls back on its own instead of spoiling the rest. */
export function loadSettings(){
  const stored = read(KEYS.settings, {});
  const out = { ...SETTINGS_DEFAULTS };
  if (stored && typeof stored === "object"){
    for (const [k, ok] of Object.entries(SETTINGS_VALID)){
      if (k in stored && ok(stored[k])) out[k] = stored[k];
    }
  }
  return out;
}

export function saveSettings(patch){
  const next = { ...loadSettings() };
  for (const [k, v] of Object.entries(patch)){
    if (SETTINGS_VALID[k] && SETTINGS_VALID[k](v)) next[k] = v;
  }
  return write(KEYS.settings, next);
}
