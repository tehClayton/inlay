/* What the history screen shows, from saved sessions: everything pooled by
   position, by note, by string and overall, and each session as a point on
   a trend with its control limits. Pure: history.html draws it.

   Sessions store per-position sums (sessions.js), so any grouping is just
   those rows added up and handed to totals(). */
import { totals } from "./sessions.js";
import { pitchAt } from "./instrument.js";
import { pitchClass } from "./theory.js";

/* Fewer answers than this at a position and the heatmap draws it hollow:
   too little to say whether it's slow or fast. */
export const MIN_HEAT = 3;

/* The sessions of one instrument, optionally of one drill (a session key),
   oldest first. */
export function select(sessions, inst, key = null){
  return sessions
    .filter(s => s.inst === inst.id && (key == null || s.key === key))
    .sort((a, b) => a.t - b.t);
}

/* The drills an instrument has sessions for, to filter by: each key with its
   latest label and how many sessions, the most practised first. */
export function drillsOf(sessions, inst){
  const by = new Map();
  for (const s of select(sessions, inst)){
    const d = by.get(s.key) ?? { key: s.key, label: s.label, sessions: 0 };
    d.label = s.label;
    d.sessions++;
    by.set(s.key, d);
  }
  return [...by.values()].sort((a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label));
}

const add = (into, row) => { for (let i = 0; i < 5; i++) into[i] += row[i]; };

/* Every position's rows summed across sessions: Map "string:fret" → row. */
function pooled(sessions){
  const m = new Map();
  for (const s of sessions) for (const [k, row] of Object.entries(s.pos)){
    if (!m.has(k)) m.set(k, [0, 0, 0, 0, 0]);
    add(m.get(k), row);
  }
  return m;
}

const parse = k => { const [string, fret] = k.split(":").map(Number); return { string, fret }; };

/* Per position: { string, fret, ...totals, thin } for every position answered
   that's still on the neck. Positions from before the instrument lost strings
   or frets are left out: there's nowhere to draw them. */
export function byPosition(sessions, inst){
  const out = [];
  for (const [k, row] of pooled(sessions)){
    const p = parse(k);
    if (pitchAt(inst, p.string, p.fret) == null) continue;
    const t = totals([row]);
    out.push({ ...p, ...t, thin: t.answers < MIN_HEAT });
  }
  return out;
}

/* Per pitch class, 0–11, by the instrument's tuning now: an entry for each,
   with answers 0 where nothing was asked. */
export function byNote(sessions, inst){
  const rows = Array.from({ length: 12 }, () => [0, 0, 0, 0, 0]);
  for (const [k, row] of pooled(sessions)){
    const { string, fret } = parse(k);
    const p = pitchAt(inst, string, fret);
    if (p != null) add(rows[pitchClass(p)], row);
  }
  return rows.map((r, pc) => ({ pc, ...totals([r]) }));
}

/* Per string, in the instrument's order: an entry for each. */
export function byString(sessions, inst){
  const rows = inst.strings.map(() => [0, 0, 0, 0, 0]);
  for (const [k, row] of pooled(sessions)){
    const { string, fret } = parse(k);
    if (pitchAt(inst, string, fret) != null) add(rows[string], row);
  }
  return rows.map((r, string) => ({ string, ...totals([r]) }));
}

export const overall = sessions => totals(sessions.flatMap(s => Object.values(s.pos)));

/* Each session as a point, oldest first: when, which drill, and its totals. */
export const trend = sessions => sessions.map(s => ({
  t: s.t, key: s.key, label: s.label, dur: s.dur, ...totals(Object.values(s.pos)),
}));

/* ------------------------------------------------------------- heatmap */

/* Positions (from byPosition) as heat, 0 cool to 1 hot, for one metric:
   "time" (typical time) or "miss" (miss rate). The scale is set by the
   positions with enough answers to trust, so a thin spot can't stretch it:
     time — from the fastest to the slowest, on a log scale, as times are
            judged by ratio: 1 s to 2 s is as big a step as 2 s to 4 s;
     miss — from none missed to the worst miss rate, but at least 20%, so a
            neck with a handful of slips isn't painted as if it were on fire.
   Thin positions are placed on the same scale, clamped, and marked hollow;
   one with nothing to show for the metric (every answer missed, so no time)
   gets t null. Returns { cells: [{ string, fret, value, t, hollow }], lo, hi }. */
export const MIN_MISS_SCALE = 0.2;
export function heat(positions, metric){
  const valueOf = p => metric === "time" ? p.typicalMs : (p.accuracy == null ? null : 1 - p.accuracy);
  const trusted = positions.filter(p => !p.thin).map(valueOf).filter(v => v != null);
  let lo, hi;
  if (metric === "time"){
    lo = trusted.length ? Math.min(...trusted) : null;
    hi = trusted.length ? Math.max(...trusted) : null;
  } else {
    lo = 0;
    hi = Math.max(MIN_MISS_SCALE, ...trusted);
  }
  const scale = v => {
    if (v == null || lo == null) return null;
    if (hi === lo) return metric === "time" ? 0.5 : 0;
    const t = metric === "time" ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo);
    return Math.max(0, Math.min(1, t));
  };
  const cells = positions.map(p => {
    const value = valueOf(p);
    return { string: p.string, fret: p.fret, value, t: scale(value), hollow: p.thin || value == null };
  });
  return { cells, lo, hi };
}

/* The heatmap's colour for t: one ramp from the raised slate of the page's
   controls, which reads as "nothing wrong", to millitap's amber, which reads
   as "look here". Null is muted ink: answered, but nothing to rate. */
const COOL = [0x33, 0x41, 0x4F], WARM = [0xE8, 0xA3, 0x3D];
export function ramp(t){
  if (t == null) return "#66788C";
  const k = Math.max(0, Math.min(1, t));
  const hex = COOL.map((c, i) => Math.round(c + (WARM[i] - c) * k).toString(16).padStart(2, "0"));
  return `#${hex.join("")}`;
}

/* ---------------------------------------------------------- formatting */
/* Numbers as the history screen writes them. A dash where there's nothing
   to say, never a 0 that looks like a result. */
const DASH = "—";
export const fmtPct = x => x == null ? DASH : `${Math.round(x * 100)}%`;
export const fmtTime = ms => ms == null ? DASH : `${(ms / 1000).toFixed(ms < 9950 ? 2 : 1)} s`;
export const fmtSpread = r => r == null ? DASH : `×${r.toFixed(2)}`;

/* A length of time: "0:42", "12:05", "1:02:03". */
export function fmtDur(ms){
  const s = Math.round(ms / 1000);
  const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
  const p = n => String(n).padStart(2, "0");
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}

/* ------------------------------------------------------- control chart */
/* An individuals (XmR) chart, as millitap's history draws them: one point per
   session, a centre line at the mean, and limits three sigmas either side,
   sigma estimated from the average moving range (÷ d2 = 1.128, so the limits
   are the familiar 2.66 average moving ranges). A point outside them is more
   than your session-to-session noise.

   Read the signals forward, not as faults: practising is trying to move the
   level, so a signal is usually the evidence that it moved. */
const D2 = 1.128;

/* Fewer sessions than this and limits would mostly describe the noise in
   their own estimate: the chart draws the trend alone, and says so. Below
   SPC_FIRM they are drawn, but called provisional. */
export const SPC_MIN = 8;
export const SPC_FIRM = 20;

/* The values a chart works in: finite, and for `log` positive and logged,
   since times are judged by ratio and their noise grows with their size. A
   null (a session with nothing timed) has no value and is skipped. */
const series = (values, log) => values.map(v =>
  v == null || !Number.isFinite(v) || (log && v <= 0) ? null : (log ? Math.log(v) : v));

/* Centre line and limits, in the values' own units: { centre, lo, hi, sigma }
   with sigma in the working (logged, for `log`) units. Null with fewer than
   two values, or when they never move, which would collapse the limits onto
   the centre and flag every point that ever did. `range` clamps the limits
   to what the quantity can be (accuracy lives in [0, 1]). */
export function limits(values, { log = false, range = null } = {}){
  const xs = series(values, log).filter(v => v != null);
  if (xs.length < 2) return null;
  const centre = xs.reduce((a, b) => a + b, 0) / xs.length;
  let mr = 0;
  for (let i = 1; i < xs.length; i++) mr += Math.abs(xs[i] - xs[i - 1]);
  const sigma = mr / (xs.length - 1) / D2;
  if (!(sigma > 0)) return null;
  const back = x => log ? Math.exp(x) : x;
  let lo = back(centre - 3 * sigma), hi = back(centre + 3 * sigma);
  if (range){ lo = Math.max(range[0], lo); hi = Math.min(range[1], hi); }
  return { centre: back(centre), lo, hi, sigma };
}

/* The run rules worth reading in practice, a subset of Western Electric's:
     1  a point outside the limits: this session wasn't like the others
     2  eight in a row on one side: the level has moved, and stayed moved
     3  six in a row climbing or falling (five steps): it's moving now
     5  two of three past two sigmas on one side: too big a shift to sit on
   Each is flagged on the point that completes it. Returns an array of rule
   numbers per value; null values get [] and are stepped over, so a session
   with nothing timed doesn't break a run. */
export const RULES = {
  1: "outside the limits",
  2: "eight in a row on one side",
  3: "six in a row moving one way",
  5: "two of three past 2σ",
};
export function signals(values, { log = false } = {}){
  const all = series(values, log);
  const flags = values.map(() => []);
  const idx = all.map((v, i) => v == null ? -1 : i).filter(i => i >= 0);
  const xs = idx.map(i => all[i]);
  const k = limits(values, { log });
  if (!k) return flags;
  const centre = xs.reduce((a, b) => a + b, 0) / xs.length;
  const z = j => (xs[j] - centre) / k.sigma;
  const flag = (j, rule) => flags[idx[j]].push(rule);
  for (let j = 0; j < xs.length; j++){
    if (Math.abs(z(j)) > 3) flag(j, 1);
    if (j >= 7){
      const side = Math.sign(z(j));
      if (side && [...Array(8)].every((_, n) => Math.sign(z(j - n)) === side)) flag(j, 2);
    }
    if (j >= 5){
      const steps = [...Array(5)].map((_, n) => xs[j - n] - xs[j - n - 1]);
      if (steps.every(d => d > 0) || steps.every(d => d < 0)) flag(j, 3);
    }
    if (j >= 2){
      for (const side of [1, -1]){
        const far = [j - 2, j - 1, j].filter(n => side * z(n) > 2);
        if (far.length >= 2 && far.at(-1) === j){ flag(j, 5); break; }
      }
    }
  }
  return flags;
}
