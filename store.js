/* All persistence. Nothing else touches localStorage.

   Every key starts "inlay." because millitap is served from the same origin
   and shares this storage; nothing here ever calls localStorage.clear(). Keys
   carry a schema version so a future change of shape can migrate rather than
   misread. Storage can be blocked outright (private modes, embedded views), so
   reads fall back to empty and writes report failure instead of throwing.

   Sessions and sets join this file in later milestones. */
import { validate as validateInstrument, upgrade as upgradeInstrument } from "./instrument.js";
import { NOTE_PREFS } from "./theory.js";

export const KEYS = {
  instruments: "inlay.instruments.v1",
  settings:    "inlay.settings.v1",
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
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
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

export function deleteInstrument(id){
  return write(KEYS.instruments, loadInstruments().filter(x => x.id !== id));
}

/* ------------------------------------------------------------- settings */

/* Device preferences. Not part of a backup: they describe this device, not
   your practice. */
export const SETTINGS_DEFAULTS = Object.freeze({
  notePref: "sharp",     // sharp | flat | both
  instrument: null,      // id of the instrument last used
});

const SETTINGS_VALID = {
  notePref: v => NOTE_PREFS.includes(v),
  instrument: v => v === null || typeof v === "string",
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
