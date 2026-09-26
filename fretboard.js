/* The fretboard: geometry, hit-testing and SVG drawing.

   layout() and cellAt() are pure, so the geometry is tested without a browser.
   createFretboard() is the DOM half; it only draws what layout() computed.

   Geometry is worked out FLAT in one canonical orientation — nut on the left,
   bass edge at the top — and every point then goes through one chain of view
   steps, each undoable:

     1. orientation  the bass edge to the bottom, unless the view is flipped
     2. squeeze      string spacing closes up away from the bass edge
     3. recession    the headstock end drawn smaller
     4. angle        the neck turned on screen, headstock end up
     5. fit          scaled down, only if the result spills out of the box
     6. handedness   mirrored left to right for a left-handed instrument

   So there is one set of fret arithmetic, every step keeps straight lines
   straight (frets and strings are still drawn as lines), and hit-testing is
   the chain run backwards into the flat layout, where finding a cell is a
   rectangle test. The view's settings are described in instrument.js. */

/* Real frets shrink by 2^(-1/12) each, halving by the 12th. Drawn to scale,
   a 24-fret neck on a phone leaves the high frets too narrow to hit, and
   drawn evenly it stops looking like a neck. Half the real taper keeps both:
   the 12th fret is about 70% of the 1st. */
const TAPER = 2 ** (-1 / 24);

/* Single dots, and the doubles at the octaves. Standard on guitar and bass;
   close enough elsewhere to orient by. */
export const INLAY_SINGLE = [3, 5, 7, 9, 15, 17, 19, 21];
export const INLAY_DOUBLE = [12, 24];

const OPEN_WEIGHT = 0.8;   // the open-string column, relative to fret 1
const PAD_X = 6;
const PAD_TOP = 8;
const NUMBERS_H = 16;      // the strip of fret numbers under the neck
const FIT_MARGIN = 2;

/* ------------------------------------------------------------ projection */

/* Squeeze: a one-dimensional perspective on [0, 1], 0 nearest the eye:
   t(v) = (1+c)v / (1+cv). It fixes both ends, and its slope falls from
   (1+c) at the near end to 1/(1+c) at the far end, so the far/near spacing
   ratio is 1/(1+c)². What is evenly spaced on the fretboard stays in order
   on screen and simply closes up with distance. */
export const squeezeC = squeeze => 1 / Math.sqrt(squeeze) - 1;
export const recede = (v, c) => (1 + c) * v / (1 + c * v);
export const unrecede = (t, c) => t / (1 + c - c * t);

/* How much tighter the farthest string gap looks than the nearest: on a
   guitar, B to high E against low E to A. What the squeeze slider reports. */
export function gapRatio(squeeze, strings){
  if (strings < 3) return 1;
  const c = squeezeC(squeeze), at = i => recede((i + 0.5) / strings, c);
  return (at(strings - 1) - at(strings - 2)) / (at(1) - at(0));
}

/* Recession: the projective map taking the unit square onto a quadrilateral,
   corners in order (0,0) (1,0) (1,1) (0,1) — Heckbert's closed form. */
export function squareToQuad([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]){
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12){
    return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0];
  }
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
}

export function applyH([a, b, c, d, e, f, g, h], u, v){
  const w = g * u + h * v + 1;
  return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
}

/* The inverse map, from the adjugate of the 3x3 matrix, normalised so its
   last entry is 1 like the forward map's. */
export function invertH([a, b, c, d, e, f, g, h]){
  const A = e - f * h, B = c * h - b, C = b * f - c * e;
  const D = f * g - d, E = a - c * g, F = c * d - a * f;
  const G = d * h - e * g, Hh = b * g - a * h, I = a * e - b * d;
  return [A / I, B / I, C / I, D / I, E / I, F / I, G / I, Hh / I];
}

const dist = ([ax, ay], [bx, by]) => Math.hypot(bx - ax, by - ay);
const identity = p => p;

/* ---------------------------------------------------------------- layout */

/* Everything the renderer draws and the hit test reads, in CSS pixels of a
   width x height box. Shapes come out already transformed: polygons as point
   lists, lines as endpoint pairs, inlays as (possibly turned) ellipses. */
export function layout(inst, { width, height }){
  const v = inst.view;
  const n = inst.strings.length;
  const top = PAD_TOP;
  const bottom = Math.max(top + n * 8, height - NUMBERS_H - 4);
  const H = bottom - top;
  const pitch = H / n;                          // vertical space per string
  const mid = (top + bottom) / 2;

  // Flat x: wire[f] is the right-hand edge of fret f; wire[0] is the nut.
  const weights = [];
  for (let f = 1; f <= inst.frets; f++) weights.push(TAPER ** (f - 1));
  const total = OPEN_WEIGHT + weights.reduce((a, b) => a + b, 0);
  const unit = (width - 2 * PAD_X) / total;
  const wire = [PAD_X + OPEN_WEIGHT * unit];
  for (const w of weights) wire.push(wire.at(-1) + w * unit);
  const left = f => (f === 0 ? PAD_X : wire[f - 1]);
  const centre = f => (left(f) + wire[f]) / 2;
  const X0 = PAD_X, X1 = wire[inst.frets];

  // The edge strip lies beyond the bass string, flat y from edgeY to top.
  const edgeY = top - v.edge * pitch;

  // 1. Orientation. Canonical has the bass edge at the top; self-inverse.
  const orient = ([x, y]) => [x, v.flip ? y : top + bottom - y];

  // 2. Squeeze, measured from the bass edge wherever orientation put it.
  const c = squeezeC(v.squeeze);
  const bassY = v.flip ? top : bottom, away = v.flip ? 1 : -1;
  const squeeze   = ([x, y]) => [x, bassY + away * H * recede(away * (y - bassY) / H, c)];
  const unsqueeze = ([x, y]) => [x, bassY + away * H * unrecede(away * (y - bassY) / H, c)];

  // 3. Recession: the neck onto a trapezoid, the nut at `recession` of the
  //    body end's height. Anchored on the nut, not the open column's edge,
  //    so the setting means what it says; the open column carries on the
  //    same taper just beyond it.
  let recess = identity, unrecess = identity;
  if (v.recession < 1){
    const N = wire[0], half = H / 2;
    const M = squareToQuad([[N, mid - v.recession * half], [X1, top], [X1, bottom],
                            [N, mid + v.recession * half]]);
    const Mi = invertH(M);
    recess = ([x, y]) => applyH(M, (x - N) / (X1 - N), (y - top) / H);
    unrecess = ([x, y]) => { const [u, w] = applyH(Mi, x, y); return [N + u * (X1 - N), top + w * H]; };
  }
  const level = p => recess(squeeze(orient(p)));           // flat -> level screen space
  const unlevel = p => orient(unsqueeze(unrecess(p)));

  // 4. Angle, about the box centre. Positive turns the body end down, which
  //    brings the headstock end up, as the neck lies in your lap.
  const th = v.angle * Math.PI / 180, cos = Math.cos(th), sin = Math.sin(th);
  const ox = width / 2, oy = height / 2;
  const turn   = ([x, y]) => [ox + (x - ox) * cos - (y - oy) * sin, oy + (x - ox) * sin + (y - oy) * cos];
  const unturn = ([x, y]) => [ox + (x - ox) * cos + (y - oy) * sin, oy - (x - ox) * sin + (y - oy) * cos];

  /* Fret numbers are placed in level space, just below whatever is drawn
     lowest at that fret, so they turn with the neck but stay upright. */
  const numbered = [...INLAY_SINGLE, ...INLAY_DOUBLE].filter(f => f <= inst.frets).sort((a, b) => a - b);
  const numberAt = numbered.map(f => {
    const ys = [top, bottom, edgeY].map(y => level([centre(f), y])[1]);
    return [level([centre(f), mid])[0], Math.max(...ys) + 12];
  });

  // 5. Fit. Only when steps 1–4 spill out of the box, and then uniformly,
  //    so nothing is distorted: the neck is shrunk and centred.
  const outline = [
    ...[[X0, top], [X1, top], [X1, bottom], [X0, bottom], [X0, edgeY], [X1, edgeY]].map(level),
    ...numberAt.flatMap(([x, y]) => [[x - 8, y - 10], [x + 8, y + 3]]),
  ].map(turn);
  const xs = outline.map(p => p[0]), ys = outline.map(p => p[1]);
  const [bx0, bx1, by0, by1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let fit = identity, unfit = identity;
  if (bx0 < FIT_MARGIN || by0 < FIT_MARGIN || bx1 > width - FIT_MARGIN || by1 > height - FIT_MARGIN){
    const k = Math.min(1, (width - 2 * FIT_MARGIN) / (bx1 - bx0), (height - 2 * FIT_MARGIN) / (by1 - by0));
    const bcx = (bx0 + bx1) / 2, bcy = (by0 + by1) / 2;
    fit   = ([x, y]) => [ox + (x - bcx) * k, oy + (y - bcy) * k];
    unfit = ([x, y]) => [bcx + (x - ox) / k, bcy + (y - oy) / k];
  }

  // 6. Handedness; self-inverse.
  const mirror = ([x, y]) => [inst.leftHanded ? width - x : x, y];

  const fromLevel = p => mirror(fit(turn(p)));
  const T = p => fromLevel(level(p));
  const Tinv = p => unlevel(unturn(unfit(mirror(p))));

  const quad = (x0, y0, x1, y1) => [T([x0, y0]), T([x1, y0]), T([x1, y1]), T([x0, y1])];
  const seg = (x0, y0, x1, y1) => [T([x0, y0]), T([x1, y1])];

  const strings = inst.strings.map((s, i) => {
    const y = top + (i + 0.5) * pitch;
    // A string starts at its own nut: the main nut, or a banjo's fifth-string
    // spike at fret `start`.
    const x0 = s.start === 0 ? wire[0] : wire[s.start];
    return { index: i, line: seg(x0, y, X1, y), open: s.open,
             spike: s.start ? T([wire[s.start], y]) : null, y: T([X1, y])[1] };
  });

  /* One cell per playable position. Fret `start` is a string's open position,
     drawn in the space just before its nut, like the open column. `flat` is
     the untransformed rectangle the hit test checks. */
  const cells = [];
  inst.strings.forEach((s, i) => {
    const y0 = top + i * pitch, y1 = y0 + pitch, cy = y0 + pitch / 2;
    for (let f = s.start; f <= inst.frets; f++){
      const x0 = left(f), x1 = f === 0 ? wire[0] : wire[f], cx = (x0 + x1) / 2;
      const pts = quad(x0, y0, x1, y1);
      const [ccx, ccy] = T([cx, cy]);
      const w = dist(T([x0, cy]), T([x1, cy])), hgt = dist(T([cx, y0]), T([cx, y1]));
      cells.push({
        string: i, fret: f, pts, cx: ccx, cy: ccy,
        x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])),
        y0: Math.min(...pts.map(p => p[1])), y1: Math.max(...pts.map(p => p[1])),
        size: Math.min(w, hgt),                  // what a fingertip has to hit
        r: Math.min(w * 0.42, hgt * 0.46, 17),   // the marker that fits it
        flat: [x0, y0, x1, y1],
      });
    }
  });

  /* A flat circle of radius r at (x, y), as the view draws it: an ellipse
     stretched by the local scale along and across the neck, turned with it. */
  const ellipse = (x, y, r) => {
    const [cx, cy] = T([x, y]);
    const a0 = T([x - 1, y]), a1 = T([x + 1, y]);
    return { cx, cy, rx: r * dist(a0, a1) / 2, ry: r * dist(T([x, y - 1]), T([x, y + 1])) / 2,
             rot: Math.atan2(a1[1] - a0[1], a1[0] - a0[0]) * 180 / Math.PI };
  };
  const dotR = Math.min(pitch * 0.2, 7);
  const inlays = [];
  for (const f of INLAY_SINGLE) if (f <= inst.frets) inlays.push({ fret: f, ...ellipse(centre(f), mid, dotR) });
  for (const f of INLAY_DOUBLE) if (f <= inst.frets){
    // In the gaps either side of the middle, where they sit on a real neck:
    // between strings 2–3 and 4–5 on a guitar. With an odd count the middle
    // is a string, so step out to the next gaps. Too few strings to have
    // such gaps: a quarter in from each edge.
    const off = n >= 4 ? (n % 2 ? 1.5 : 1) * pitch : H / 4;
    inlays.push({ fret: f, ...ellipse(centre(f), mid - off, dotR) },
                { fret: f, ...ellipse(centre(f), mid + off, dotR) });
  }

  const hasEdge = v.edge > 0;
  const edge = hasEdge ? quad(wire[0], edgeY, X1, top) : null;
  const sideDots = hasEdge
    ? numbered.map(f => ellipse(centre(f), (edgeY + top) / 2, Math.min(1.9, (top - edgeY) * 0.3)))
    : [];

  return {
    width, height, top, bottom, pitch, view: v,
    wood: quad(wire[0], top, X1, bottom),
    openCol: quad(X0, top, wire[0], bottom),
    nut: seg(wire[0], top, wire[0], bottom),
    wires: wire.slice(1).map(x => seg(x, top, x, bottom)),
    strings, cells, inlays, edge, sideDots,
    numbers: numbered.map((f, i) => {
      const [x, y] = fromLevel(numberAt[i]);
      return { fret: f, cx: x, y };
    }),
    toFlat: Tinv,
  };
}

/* The playable position under a point, or null. The point is taken back
   into the flat layout, where cells are plain rectangles. */
export function cellAt(L, x, y){
  const [fx, fy] = L.toFlat([x, y]);
  for (const c of L.cells){
    const [x0, y0, x1, y1] = c.flat;
    if (fx >= x0 && fx < x1 && fy >= y0 && fy < y1) return { string: c.string, fret: c.fret };
  }
  return null;
}

export const cellOf = (L, pos) =>
  L.cells.find(c => c.string === pos.string && c.fret === pos.fret) ?? null;

/* The smallest target on the neck, in pixels: what the editor warns about
   when a view makes frets too small to tap. */
export const smallestCell = L => Math.min(...L.cells.map(c => c.size));

/* ---------------------------------------------------------------- drawing */

const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, text){
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

const points = pts => pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
const line = (cls, [[x1, y1], [x2, y2]], extra = {}) =>
  el("line", { class: cls, x1, y1, x2, y2, ...extra });
const oval = (cls, d) => el("ellipse", { class: cls, cx: d.cx, cy: d.cy, rx: d.rx, ry: d.ry,
  transform: `rotate(${d.rot.toFixed(2)} ${d.cx.toFixed(2)} ${d.cy.toFixed(2)})` });

/* Heavier strings for lower pitches, as on the instrument: roughly 3px at a
   bass's low B down to 1px at a guitar's high E. */
const gauge = open => Math.max(1, Math.min(3.2, 3.2 - (open - 23) * (2.2 / 41)));

/* Draws `inst` into `host`, redrawing on resize. `onTap({string, fret})` fires
   on pointerdown over a playable position — pointerdown rather than click,
   because the drills time the answer and a click lands up to a tap's length
   later. */
export function createFretboard(host, { onTap } = {}){
  const svg = el("svg", { class: "fb", role: "img" });
  host.replaceChildren(svg);
  let inst = null, L = null, marks = [], windowFrets = null;

  function draw(){
    if (!inst) { svg.replaceChildren(); return; }
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    L = layout(inst, { width, height });
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("aria-label",
      `Fretboard: ${inst.strings.length} strings, ${inst.frets} frets`);

    const g = [];
    g.push(el("polygon", { class: "fb-open", points: points(L.openCol) }));
    if (L.edge) g.push(el("polygon", { class: "fb-edge", points: points(L.edge) }));
    g.push(el("polygon", { class: "fb-wood", points: points(L.wood) }));
    for (const d of L.sideDots) g.push(oval("fb-side", d));
    for (const d of L.inlays) g.push(oval("fb-inlay", d));
    for (const w of L.wires) g.push(line("fb-fret", w));
    g.push(line("fb-nut", L.nut));
    for (const s of L.strings){
      if (s.spike) g.push(el("circle", { class: "fb-spike", cx: s.spike[0], cy: s.spike[1], r: 3 }));
      g.push(line("fb-string", s.line, { "stroke-width": gauge(s.open) }));
    }
    for (const nb of L.numbers) g.push(el("text", { class: "fb-num", x: nb.cx, y: nb.y }, String(nb.fret)));

    // Everything outside the drill's fret window is dimmed, not hidden: the
    // neck stays whole, so where the window sits on it is itself information.
    if (windowFrets){
      const [a, b] = windowFrets;
      for (const c of L.cells) if (c.fret < a || c.fret > b){
        g.push(el("polygon", { class: "fb-dim", points: points(c.pts) }));
      }
    }

    const mg = el("g", { class: "fb-marks" });
    for (const m of marks) drawMark(mg, m);
    g.push(mg);
    svg.replaceChildren(...g);
  }

  function drawMark(parent, { pos, kind, text }){
    const c = cellOf(L, pos);
    if (!c) return;
    const g = el("g", { class: `fb-mark ${kind}` });
    g.append(el("circle", { cx: c.cx, cy: c.cy, r: c.r }));
    // Sized to the label, so "C♯/D♭" fits the same circle as "E".
    const size = Math.max(7, Math.min(c.r * 0.82, 2.6 * c.r / Math.max(1, [...(text ?? "")].length)));
    if (text) g.append(el("text", { x: c.cx, y: c.cy, "font-size": size }, text));
    parent.append(g);
  }

  svg.addEventListener("pointerdown", e => {
    if (!L || !onTap) return;
    const r = svg.getBoundingClientRect();
    const hit = cellAt(L, e.clientX - r.left, e.clientY - r.top);
    if (hit){ e.preventDefault(); onTap(hit, e); }
  });

  const ro = new ResizeObserver(draw);
  ro.observe(host);

  return {
    /* The instrument to draw, and optionally a [from, to] fret window. */
    show(next, { window: w = null } = {}){ inst = next; windowFrets = w; marks = []; draw(); },
    /* A marker on a position: kind is a class ("note", "true", "miss",
       "target"), text an optional label inside it. */
    mark(pos, kind, text){ marks.push({ pos, kind, text }); draw(); },
    clearMarks(){ marks = []; draw(); },
    /* The current layout, for whoever needs its measurements. */
    get layout(){ return L; },
    destroy(){ ro.disconnect(); svg.remove(); },
  };
}
