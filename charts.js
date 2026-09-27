/* The history page's charts, drawn as SVG. The numbers come from stats.js;
   this only decides where they go. Adapted from millitap's history charts,
   so the two apps' charts read alike: recessed wells, dashed limits, a solid
   centre line, and signals ringed rather than recoloured. */
import { limits, signals, RULES, SPC_MIN } from "./stats.js";
import { fill } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs = {}, text){
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

/* ------------------------------------------------------------- the tip */
/* One floating note for every chart, placed over the pointer and kept on
   screen. `tipEl` is the page's #tip. */
function bindTip(tipEl, node, parts){
  const show = e => {
    fill(tipEl, parts());
    tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    tipEl.style.left = `${Math.min(Math.max(8, e.clientX - r.width / 2), innerWidth - r.width - 8)}px`;
    tipEl.style.top = `${Math.max(8, e.clientY - r.height - 14)}px`;
  };
  node.addEventListener("pointerenter", show);
  node.addEventListener("pointermove", show);
  node.addEventListener("pointerleave", () => { tipEl.hidden = true; });
}

/* ------------------------------------------------------------- scales */
/* Round steps for a linear axis: 1, 2, 2.5 or 5 times a power of ten. */
function linearTicks(lo, hi, want = 4){
  const raw = (hi - lo) / want, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/* Times read in round seconds, so a log axis gets them rather than evenly
   spaced logs: 0.5 s, 1 s, 2 s and so on, thinned to about five. */
const TIME_TICKS = [100, 200, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000,
                    10000, 15000];
function logTicks(lo, hi){
  let t = TIME_TICKS.filter(v => v >= lo && v <= hi);
  while (t.length > 5) t = t.filter((_, i) => i % 2 === 0);
  return t.length >= 2 ? t : [lo, hi];
}

const shortDate = t => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/* ------------------------------------------------------ control chart */
/* An individuals chart of one value per session, into `host`:
     points  [{ t, value, parts }] oldest first; value null draws nothing,
             parts() the tip's lines
     log     plot and judge on a log scale (times)
     range   what the value can be, e.g. [0, 1], clamping axis and limits
     fmt     a value in words, for the label
     axis    a value as the axis puts it, shorter; fmt if not given
     name    what it is, for the chart's label
   Limits and signals appear from SPC_MIN sessions. Returns { limits,
   signals: how many points signal }. */
export function controlChart(host, { points, log = false, range = null, fmt, axis = fmt, name, tip, height = 180 }){
  host.replaceChildren();
  const values = points.map(p => p.value);
  const have = values.filter(v => v != null);
  if (!have.length) return { limits: null, signals: 0 };

  const k = points.length >= SPC_MIN ? limits(values, { log, range }) : null;
  const flags = k ? signals(values, { log }) : values.map(() => []);

  const w = Math.max(260, host.clientWidth || 300);
  const f = { L: 50, R: w - 14, T: 10, B: height - 24 };
  const svg = el("svg", { viewBox: `0 0 ${w} ${height}`, width: w, height, role: "img" });

  // The axis covers the data and the limits, with a little room.
  let lo = Math.min(...have, ...(k ? [k.lo] : [])), hi = Math.max(...have, ...(k ? [k.hi] : []));
  const T = v => log ? Math.log(v) : v;
  let [a, b] = [T(lo), T(hi)];
  if (a === b){ a -= log ? 0.2 : 0.05; b += log ? 0.2 : 0.05; }
  const room = (b - a) * 0.08;
  a -= room; b += room;
  if (range){ a = Math.max(T(range[0]), a); b = Math.min(T(range[1]), b); }
  lo = log ? Math.exp(a) : a; hi = log ? Math.exp(b) : b;
  const Y = v => f.B - (T(v) - a) / (b - a) * (f.B - f.T);
  const X = i => points.length === 1 ? (f.L + f.R) / 2 : f.L + i / (points.length - 1) * (f.R - f.L);

  for (const v of log ? logTicks(lo, hi) : linearTicks(lo, hi)){
    svg.append(el("line", { class: "gl", x1: f.L, y1: Y(v), x2: f.R, y2: Y(v) }),
               el("text", { class: "ax", x: f.L - 6, y: Y(v) + 3, "text-anchor": "end" }, axis(v)));
  }
  if (k){
    for (const [v, cls, text] of [[k.hi, "lim", "upper limit"], [k.centre, "cl", null], [k.lo, "lim", "lower limit"]]){
      const y = Y(v);
      if (y < f.T - 1 || y > f.B + 1) continue;
      svg.append(el("line", { class: cls, x1: f.L, y1: y, x2: f.R, y2: y }));
      if (text && y > f.T + 8 && y < f.B - 2)
        svg.append(el("text", { class: "limlab", x: f.R - 2, y: y - 4, "text-anchor": "end" }, text));
    }
  }

  const drawn = points.map((p, i) => p.value == null ? null : [X(i), Y(p.value)]).filter(Boolean);
  if (drawn.length > 1)
    svg.append(el("polyline", { class: "trend", points: drawn.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ") }));

  let signalling = 0;
  points.forEach((p, i) => {
    if (p.value == null) return;
    const [x, y] = [X(i), Y(p.value)];
    if (flags[i].length){ signalling++; svg.append(el("circle", { class: "sigring", cx: x, cy: y, r: 8.5 })); }
    svg.append(el("circle", { class: "pt", cx: x, cy: y, r: 4.5 }));
    // A bigger, invisible target for a finger.
    const hit = el("circle", { cx: x, cy: y, r: 12, fill: "transparent" });
    svg.append(hit);
    if (tip) bindTip(tip, hit, () => [
      ...p.parts(),
      ...(flags[i].length ? [el2("span", `Signal: ${flags[i].map(r => RULES[r]).join("; ")}`)] : []),
    ]);
  });

  svg.append(el("text", { class: "ax", x: f.L, y: f.B + 16, "text-anchor": "start" }, shortDate(points[0].t)));
  if (points.length > 1)
    svg.append(el("text", { class: "ax", x: f.R, y: f.B + 16, "text-anchor": "end" }, shortDate(points.at(-1).t)));

  const last = have.at(-1);
  svg.setAttribute("aria-label", `${name} over ${points.length} session${points.length === 1 ? "" : "s"}: ` +
    `latest ${fmt(last)}` + (k ? `, centre line ${fmt(k.centre)}, ${signalling} signalling` : ""));
  host.append(svg);
  return { limits: k, signals: signalling };
}

/* ------------------------------------------------------ by category */
/* One column per category — a note, a string — as millitap's "by position"
   draws its beats: a dot at the typical time and a whisker for the spread
   (typical ÷ spread to typical × spread, the band most answers fall in), on
   a log scale. A dashed line across is the typical time over everything,
   so a slow note stands out against your own average rather than against
   nothing. Accuracy is written under each column, in rose when it is well
   below the overall.
     items   [{ label, typicalMs, spread, accuracy, answers, thin, parts }]
             answers 0 is a category never asked: a dash, not a weakness
     overall { typicalMs, accuracy }
     axis    a time as the axis puts it
   */
export function spreadChart(host, { items, overall, axis, name, tip, height = 200 }){
  host.replaceChildren();
  const timed = items.filter(i => i.typicalMs != null);
  if (!timed.length) return;

  const w = Math.max(260, host.clientWidth || 300);
  const f = { L: 44, R: w - 10, T: 10, B: height - 38 };
  const svg = el("svg", { viewBox: `0 0 ${w} ${height}`, width: w, height, role: "img" });

  const ends = timed.flatMap(i => [i.typicalMs / i.spread, i.typicalMs * i.spread]);
  if (overall.typicalMs != null) ends.push(overall.typicalMs);
  let a = Math.log(Math.min(...ends)), b = Math.log(Math.max(...ends));
  if (a === b){ a -= 0.2; b += 0.2; }
  const room = (b - a) * 0.08;
  a -= room; b += room;
  const Y = v => f.B - (Math.log(v) - a) / (b - a) * (f.B - f.T);
  const col = (f.R - f.L) / items.length;
  const X = i => f.L + (i + 0.5) * col;

  for (const v of logTicks(Math.exp(a), Math.exp(b))){
    svg.append(el("line", { class: "gl", x1: f.L, y1: Y(v), x2: f.R, y2: Y(v) }),
               el("text", { class: "ax", x: f.L - 6, y: Y(v) + 3, "text-anchor": "end" }, axis(v)));
  }
  if (overall.typicalMs != null){
    const y = Y(overall.typicalMs);
    svg.append(el("line", { class: "lim", x1: f.L, y1: y, x2: f.R, y2: y }));
  }

  items.forEach((it, i) => {
    const x = X(i);
    svg.append(el("text", { class: "ax cat", x, y: f.B + 14, "text-anchor": "middle" }, it.label));
    // Accuracy well below your own overall is worth the one colour this
    // chart spends: more than ten points under it.
    const weak = it.accuracy != null && overall.accuracy != null && it.accuracy < overall.accuracy - 0.1;
    svg.append(el("text", { class: "ax acc" + (weak ? " weak" : ""), x, y: f.B + 28, "text-anchor": "middle" },
      it.accuracy == null ? "—" : `${Math.round(it.accuracy * 100)}%`));
    if (it.typicalMs != null){
      const y = Y(it.typicalMs);
      svg.append(el("line", { class: "whisk", x1: x, y1: Y(it.typicalMs * it.spread), x2: x, y2: Y(it.typicalMs / it.spread) }));
      svg.append(el("circle", { class: "pt" + (it.thin ? " thin" : ""), cx: x, cy: y, r: 4.5 }));
    }
    if (it.answers && tip){
      // The whole column is the target: a finger needn't find the dot.
      const hit = el("rect", { x: x - col / 2, y: f.T, width: col, height: f.B + 30 - f.T, fill: "transparent" });
      svg.append(hit);
      bindTip(tip, hit, it.parts);
    }
  });

  const slowest = timed.reduce((s, i) => i.typicalMs > s.typicalMs ? i : s);
  svg.setAttribute("aria-label", `${name}: slowest is ${slowest.label} at ${axis(slowest.typicalMs)}` +
    (overall.typicalMs != null ? `, against ${axis(overall.typicalMs)} overall` : ""));
  host.append(svg);
}

/* An HTML element with text, for the tip. */
function el2(tag, text){
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}
