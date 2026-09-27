/* Export and import, which both pages offer, as millitap does: the practice
   page's settings and the history page's "Your data" card are the same two
   buttons doing the same thing. Deleting everything is on the history page
   only, set apart at the bottom. */
import { h, say } from "./ui.js";
import { loadAll, writeAll, loadSettings, saveSettings, MAX_SESSIONS } from "./store.js";
import { makeBackup, readBackup, mergeBackup, backupFilename, importSummary } from "./backup.js";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* "3 days ago", or a date once it's been a while. */
export function ago(ms, now = Date.now()){
  const days = Math.floor((now - ms) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString();
}

/* What's stored, and when it was last backed up. */
export function dataNote(){
  const { instruments, sessions } = loadAll();
  const { lastExport } = loadSettings();
  const what = `${plural(instruments.length, "instrument")}, ${plural(sessions.length, "practice session")}`;
  const last = lastExport ? `Last backup: ${ago(lastExport)}.` : "Not backed up yet.";
  return `Everything stays on this device: ${what}. ${last}`;
}

/* The file is made in the page and handed to the browser to save. */
function exportBackup(){
  const data = makeBackup(loadAll());
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  const a = h("a", { href: url, download: backupFilename() });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  saveSettings({ lastExport: data.exported });
  say(`Backup saved: ${plural(data.instruments.length, "instrument")}, ${plural(data.sessions.length, "session")}.`);
}

/* Wires a page's Export and Import buttons. `beforeImport` runs once a file
   has been read and is about to be merged in (the practice page stops a run
   there); `changed` after anything is written, to redraw. */
export function wireBackup({ exportBtn, importBtn, importFile, beforeImport = () => {}, changed = () => {} }){
  exportBtn.onclick = () => { exportBackup(); changed(); };
  importBtn.onclick = () => { importFile.value = ""; importFile.click(); };
  importFile.onchange = async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const read = readBackup(await file.text());
    if (!read.ok){ say(read.error, 5000); return; }
    beforeImport();
    const merged = mergeBackup(loadAll(), read, MAX_SESSIONS);
    if (!writeAll(merged)){ say("Couldn't import: storage is full or blocked. Nothing was changed.", 5000); return; }
    changed();
    say(importSummary(merged.counts, read.skipped), 6000);
  };
}
