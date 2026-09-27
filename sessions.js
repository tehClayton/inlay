/* A session is one run, from Start to Stop, kept as aggregates rather than
   every answer: a count per position is enough for everything the history
   screen shows, and small enough that thousands fit in the storage millitap
   shares with us. Pure: store.js saves them.

   A record:
     { t,        start time, ms since the epoch; with inst, what identifies it
       inst,     the instrument's id
       drill,    which drill (drills.js)
       key,      the drill and its filters, which group sessions of the same drill
       label,    the same in words
       dur,      ms from start to the last answer
       pos: { "string:fret": [n, miss, timed, sumLn, sumLn2] } }

   Per position: answers, misses, right answers that were timed (under
   SLOW_MS), and the sum and sum of squares of their ln(ms). From those, any
   grouping — a position, a note, a string, the whole run — gets its accuracy,
   typical time (a geometric mean) and spread by adding up. */
import { SLOW_MS, DRILLS } from "./drills.js";

/* Shorter runs aren't worth keeping: a slip of the Start button. */
export const MIN_ANSWERS = 5;

export function sessionKey({ drill, notes, strings }){
  return `${drill}:${notes}:${strings ? strings.join(".") : "all"}`;
}

export function sessionLabel({ drill, notes, strings }, inst){
  const parts = [DRILLS[drill].name];
  if (notes === "naturals") parts.push("naturals");
  if (strings && inst) parts.push(`${strings.length} of ${inst.strings.length} strings`);
  return parts.join(" · ");
}

/* Builds one session as its answers come in. */
export function createRecorder({ inst, drill, notes = "all", strings = null, t = Date.now() }){
  const pos = {};
  let answers = 0, last = t;
  return {
    /* An answer at a position: right or not, and how long it took. */
    add({ string, fret }, ok, ms, now = Date.now()){
      const k = `${string}:${fret}`;
      const a = pos[k] ?? (pos[k] = [0, 0, 0, 0, 0]);
      a[0]++;
      answers++;
      last = now;
      if (!ok){ a[1]++; return; }
      if (ms > 0 && ms < SLOW_MS){
        const ln = Math.log(ms);
        a[2]++; a[3] += ln; a[4] += ln * ln;
      }
    },
    get answers(){ return answers; },
    /* The record as it stands; call again later for a fuller one. */
    record(){
      const cfg = { drill, notes, strings };
      return {
        t, inst: inst.id, drill, key: sessionKey(cfg), label: sessionLabel(cfg, inst),
        dur: Math.max(0, last - t),
        pos: Object.fromEntries(Object.entries(pos).map(([k, v]) => [k, [...v]])),
      };
    },
  };
}

/* Adds up a session's positions — or any list of [n, miss, timed, sumLn,
   sumLn2] — into what the page shows. */
export function totals(rows){
  const s = [0, 0, 0, 0, 0];
  for (const r of rows) for (let i = 0; i < 5; i++) s[i] += r[i];
  const [n, miss, timed, sumLn, sumLn2] = s;
  const mean = timed ? sumLn / timed : null;
  return {
    answers: n,
    accuracy: n ? (n - miss) / n : null,
    typicalMs: timed ? Math.exp(mean) : null,
    // Spread as a ratio: most answers fall within this factor either side of
    // typical. 1 with fewer than two timed answers.
    spread: timed > 1 ? Math.exp(Math.sqrt(Math.max(0, sumLn2 / timed - mean * mean))) : 1,
  };
}

export const summarize = session => totals(Object.values(session.pos));

/* Is x a session record the app can use? Loaded and imported data can be
   anything, so this assumes nothing. */
export function isSession(x){
  if (!x || typeof x !== "object") return false;
  if (!Number.isFinite(x.t) || typeof x.inst !== "string" || !x.inst) return false;
  if (!(x.drill in DRILLS) || typeof x.key !== "string" || typeof x.label !== "string") return false;
  if (!Number.isFinite(x.dur) || x.dur < 0) return false;
  if (!x.pos || typeof x.pos !== "object") return false;
  for (const [k, v] of Object.entries(x.pos)){
    if (!/^\d+:\d+$/.test(k) || !Array.isArray(v) || v.length !== 5) return false;
    if (!v.every(Number.isFinite)) return false;
    const [n, miss, timed] = v;
    if (n < 1 || miss < 0 || timed < 0 || miss + timed > n) return false;
  }
  return true;
}
