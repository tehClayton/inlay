/* The fretboard: geometry, hit-testing and SVG drawing.

   layout() and cellAt() are pure, so the geometry is tested without a browser.
   createFretboard() is the DOM half; it only draws what layout() computed.

   Geometry is worked out FLAT in one canonical orientation — nut on the left,
   bass edge at the top — and every point then goes through one chain of view
   steps, each undoable:

     1. orientation  the bass edge to the bottom, unless the view is flipped
     2. camera       the flat neck as a real one: tilted about x, turned about
                     y, and seen in perspective
     3. angle        turned on screen, about z, headstock end up
     4. fit          scaled down, only if the result spills out of the box
     5. handedness   mirrored left to right for a left-handed instrument

   So there is one set of fret arithmetic, every step keeps straight lines
   straight (frets and strings are still drawn as lines), and hit-testing is
   the chain run backwards into the flat layout, where finding a cell is a
   rectangle test. The view's settings are described in instrument.js. */

import { fretRange, lastFrom, VIEW_PRESETS } from "./instrument.js";

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
const PAD_TOP = 4;
const NUMBERS_H = 14;      // the strip of fret numbers under the neck
const FIT_MARGIN = 2;

/* Perspective 1 puts the eye this many board-heights away divided into one:
   at full strength the eye is 2.5 board-heights from the neck's centre. */
const PERSPECTIVE_K = 0.4;

const dist = ([ax, ay], [bx, by]) => Math.hypot(bx - ax, by - ay);
const identity = p => p;
const rad = d => d * Math.PI / 180;

/* ---------------------------------------------------------------- camera */

/* However the neck is turned, its nearest point stays at least this far in
   front of the eye, as a fraction of the eye's distance. Closer, and that end
   balloons; at or past the eye, the drawing breaks. */
const NEAREST = 0.4;

/* The camera for a view, working in coordinates centred on the neck with y
   pointing to the bass edge. `height` is the neck's flat height, which sets
   the eye's distance; `halfLength` and `depth` bound the neck, so the eye
   can be kept back from its nearest point. `project` takes a point on or off
   the fretboard's face (z > 0 towards the eye) to the screen; `unproject`
   takes a screen point back to the face (z = 0), where it has a unique
   answer. */
export function camera({ tilt, turn, perspective, bassSign }, height, halfLength = 0, depth = 0){
  const a = rad(tilt) * bassSign;               // the bass edge comes towards you
  const b = rad(turn);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);

  /* 1 / eye distance; 0 is none. Set by the board's height, so the same
     setting looks the same on any board — except where that would bring
     the eye too close to the neck's nearest point, which a big turn on a
     long, wide board can. */
  const toEye = ([x, y, z]) => x * sb + (y * sa + z * ca) * cb;
  const h = height / 2;
  const nearest = Math.max(0, ...[-halfLength, halfLength].flatMap(x =>
    [-h, h].flatMap(y => [toEye([x, y, 0]), toEye([x, y, -depth])])));
  const q = nearest > 0
    ? Math.min(perspective * PERSPECTIVE_K / height, (1 - NEAREST) / nearest)
    : perspective * PERSPECTIVE_K / height;

  function project([x, y, z]){
    // Tilt about x: the face tips, y towards or away from the eye.
    const y1 = y * ca - z * sa, z1 = y * sa + z * ca;
    // Turn about y: the headstock end (x < 0) swings away from the eye.
    const x2 = x * cb - z1 * sb, z2 = x * sb + z1 * cb;
    // Perspective: nearer is bigger. At z = 0 the scale is exactly 1.
    const w = 1 - q * z2;
    return [x2 / w, y1 / w];
  }

  /* For a point on the face, project() is x·(cb + q·sx·sb) + y·(q·sx·sa·cb −
     sa·sb) = sx and x·(q·sy·sb) + y·(ca + q·sy·sa·cb) = sy: linear in x and
     y once the screen point is known, so two equations, two unknowns. */
  function unproject([sx, sy]){
    const a11 = cb + q * sx * sb,  a12 = q * sx * sa * cb - sa * sb;
    const a21 = q * sy * sb,       a22 = ca + q * sy * sa * cb;
    const det = a11 * a22 - a12 * a21;
    return [(sx * a22 - a12 * sy) / det, (a11 * sy - a21 * sx) / det];
  }

  return { project, unproject };
}

/* ---------------------------------------------------------------- layout */

/* Everything the renderer draws and the hit test reads, in CSS pixels of a
   width x height box. Shapes come out already transformed: polygons as point
   lists, lines as endpoint pairs, inlays as (possibly turned) ellipses.

   The window (see fretRange; `from` is its first fret) sets the scale and
   the position: its frets span the board's width. The neck then carries on
   past it at the same scale, to the screen's edges or to the neck's own
   ends — the nut, or the last fret — whichever comes first. Cells say
   whether they are `inWindow`.

   The window also fills the board's height. A tilted neck is drawn shorter
   than a flat one (at 54° about 60% as tall), which would leave bands of
   empty board above and below it; so the flat neck is made taller by
   whatever `stretch` brings the drawn window to the board's proportions.
   Perspective scales with the neck, so the tilt's squeeze, keystone and
   edge look the same — the neck just isn't short. Stretch only makes up what
   tilt took (plus a little for the edge it reveals), so an angled but untilted
   neck isn't made absurdly thick to fill a wide board. */
const maxStretch = v => Math.min(6, 1.15 / Math.cos(rad(v.tilt)));
/* Near enough: a flat neck is a few percent short of the board's proportions
   (the fret numbers take a strip), and isn't worth changing for that. */
const FILLED = 0.05;

export function layout(inst, box, from = 0){
  const want = (box.height - 2 * FIT_MARGIN) / (box.width - 2 * FIT_MARGIN);
  let stretch = 1, L = layoutAt(inst, box, from, stretch);
  for (let i = 0; i < 4; i++){
    const have = L.bounds.h / L.bounds.w;
    if (have >= want * (1 - FILLED)) break;       // tall enough; fit handles any excess
    const next = Math.max(1, Math.min(maxStretch(inst.view), stretch * want / have));
    if (Math.abs(next - stretch) < 1e-3) break;
    stretch = next;
    L = layoutAt(inst, box, from, stretch);
  }
  return L;
}

function layoutAt(inst, { width, height }, from, stretch){
  const v = inst.view;
  const n = inst.strings.length;
  const [first, last] = fretRange(inst, from);
  const H0 = Math.max(n * 8, height - NUMBERS_H - 4 - PAD_TOP);
  const mid = PAD_TOP + H0 / 2;
  const H = H0 * stretch;
  const top = mid - H / 2, bottom = mid + H / 2;
  const pitch = H / n;                          // vertical space per string

  /* Flat x for the whole neck: wire[f] is the right-hand edge of fret f and
     wire[0] the nut. Each fret keeps its width from the neck's taper, scaled
     so the window fills the width, and shifted so the window starts at the
     left padding. */
  const wt = f => TAPER ** (f - 1);
  let inWin = first === 0 ? OPEN_WEIGHT : 0;
  for (let f = Math.max(first, 1); f <= last; f++) inWin += wt(f);
  const unit = (width - 2 * PAD_X) / inWin;
  const wire = [OPEN_WEIGHT * unit];
  for (let f = 1; f <= inst.frets; f++) wire.push(wire[f - 1] + wt(f) * unit);
  const shift = PAD_X - (first === 0 ? 0 : wire[first - 1]);
  for (let f = 0; f <= inst.frets; f++) wire[f] += shift;
  const left = f => (f === 0 ? shift : wire[f - 1]);
  const centre = f => (left(f) + wire[f]) / 2;
  const X0 = PAD_X, X1 = wire[last];            // the window
  const midX = (X0 + X1) / 2;

  /* What's drawn: the window, and the neck beyond it for up to a board's
     width either side — enough to reach the edges however the view turns
     it, and the screen clips the rest. */
  const reach = width;
  let dFirst = first, dLast = last;
  while (dFirst > 0 && wire[dFirst - 1] > -reach) dFirst--;
  while (dLast < inst.frets && left(dLast + 1) < width + reach) dLast++;
  const openShown = dFirst === 0;
  const DX0 = left(dFirst), DX1 = wire[dLast];
  const neckStart = openShown ? wire[0] : DX0;  // where the wood begins

  // 1. Orientation. Canonical has the bass edge at the top; self-inverse.
  const orient = ([x, y]) => [x, v.flip ? y : top + bottom - y];
  const bassSign = v.flip ? -1 : 1;             // which way is the bass edge, on screen
  const bassY = v.flip ? top : bottom;

  // 2. Camera, centred on the window, and kept clear of all that's drawn.
  const cam = camera({ ...v, bassSign }, H, Math.max(midX - DX0, DX1 - midX), v.edge * pitch);
  const view3 = ([x, y], z = 0) => {
    const [px, py] = cam.project([x - midX, y - mid, z]);
    return [px + midX, py + mid];
  };
  const level = p => view3(orient(p));
  const unlevel = ([x, y]) => {
    const [fx, fy] = cam.unproject([x - midX, y - mid]);
    return orient([fx + midX, fy + mid]);
  };

  // 3. Angle, about the box centre. Positive turns the body end down, which
  //    brings the headstock end up, as the neck lies in your lap.
  const th = rad(v.angle), cos = Math.cos(th), sin = Math.sin(th);
  const ox = width / 2, oy = height / 2;
  const turn   = ([x, y]) => [ox + (x - ox) * cos - (y - oy) * sin, oy + (x - ox) * sin + (y - oy) * cos];
  const unturn = ([x, y]) => [ox + (x - ox) * cos + (y - oy) * sin, oy - (x - ox) * sin + (y - oy) * cos];

  /* The side of the fretboard along the bass edge: the face's edge, and the
     same edge `depth` behind the face. Tilt is what brings it into view. */
  const depth = v.edge * pitch;
  const sidePoint = (x, d) => view3([x, bassY], -d);
  const hasEdge = depth > 0 && v.tilt > 0;

  /* Fret numbers are placed in level space, just below whatever is drawn
     lowest at that fret, so they turn with the neck but stay upright. */
  const inWindow = f => f >= first && f <= last;
  const numbered = [...INLAY_SINGLE, ...INLAY_DOUBLE].filter(f => f >= dFirst && f <= dLast).sort((a, b) => a - b);
  const numberAt = numbered.map(f => {
    const ys = [level([centre(f), top])[1], level([centre(f), bottom])[1]];
    if (hasEdge) ys.push(sidePoint(centre(f), depth)[1]);
    return [level([centre(f), mid])[0], Math.max(...ys) + 12];
  });

  // 4. Fit. Only when the window spills out of the box, and then uniformly,
  //    so nothing is distorted: shrunk and centred. The neck beyond the
  //    window doesn't count — that's meant to run off the edges.
  const outline = [
    ...[[X0, top], [X1, top], [X1, bottom], [X0, bottom]].map(level),
    ...(hasEdge ? [sidePoint(Math.max(neckStart, X0), depth), sidePoint(X1, depth)] : []),
    ...numberAt.filter((_, i) => inWindow(numbered[i]))
      .flatMap(([x, y]) => [[x - 8, y - 10], [x + 8, y + 3]]),
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

  // 5. Handedness; self-inverse.
  const mirror = ([x, y]) => [inst.leftHanded ? width - x : x, y];

  const fromLevel = p => mirror(fit(turn(p)));
  const T = p => fromLevel(level(p));
  const Tinv = p => unlevel(unturn(unfit(mirror(p))));

  const quad = (x0, y0, x1, y1) => [T([x0, y0]), T([x1, y0]), T([x1, y1]), T([x0, y1])];
  const seg = (x0, y0, x1, y1) => [T([x0, y0]), T([x1, y1])];

  /* A string starts at its own nut: the main nut, or a banjo's fifth-string
     spike at fret `start`. If that's before what's drawn, the string runs in
     from the edge; if it's past it, the string isn't drawn at all. */
  const strings = inst.strings.map((s, i) => {
    const y = top + (i + 0.5) * pitch;
    const drawn = s.start <= dLast;
    const x0 = s.start >= dFirst ? wire[s.start] : DX0;
    return { index: i, open: s.open,
             line: drawn ? seg(x0, y, DX1, y) : null,
             spike: s.start && s.start >= dFirst && drawn ? T([wire[s.start], y]) : null,
             y: T([X1, y])[1] };
  });

  /* One cell per playable position drawn. Fret `start` is a string's open
     position, drawn in the space just before its nut, like the open column.
     `flat` is the untransformed rectangle the hit test checks. */
  const cells = [];
  inst.strings.forEach((s, i) => {
    const y0 = top + i * pitch, y1 = y0 + pitch, cy = y0 + pitch / 2;
    for (let f = Math.max(s.start, dFirst); f <= dLast; f++){
      const x0 = left(f), x1 = wire[f], cx = (x0 + x1) / 2;
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
        inWindow: inWindow(f),
      });
    }
  });

  /* A flat circle of radius r at (x, y), as the view draws it: an ellipse
     stretched by the local scale along and across the neck, turned with it. */
  const ellipseAt = (at, r) => {
    const [cx, cy] = at(0, 0);
    const a0 = at(-1, 0), a1 = at(1, 0);
    return { cx, cy, rx: r * dist(a0, a1) / 2, ry: r * dist(at(0, -1), at(0, 1)) / 2,
             rot: Math.atan2(a1[1] - a0[1], a1[0] - a0[0]) * 180 / Math.PI };
  };
  const ellipse = (x, y, r) => ellipseAt((dx, dy) => T([x + dx, y + dy]), r);
  const dotR = Math.min(pitch * 0.2, 7);
  const inlays = [];
  const shown = f => f >= dFirst && f <= dLast;
  for (const f of INLAY_SINGLE) if (shown(f)) inlays.push({ fret: f, ...ellipse(centre(f), mid, dotR) });
  for (const f of INLAY_DOUBLE) if (shown(f)){
    // In the gaps either side of the middle, where they sit on a real neck:
    // between strings 2–3 and 4–5 on a guitar. With an odd count the middle
    // is a string, so step out to the next gaps. Too few strings to have
    // such gaps: a quarter in from each edge.
    const off = n >= 4 ? (n % 2 ? 1.5 : 1) * pitch : H / 4;
    inlays.push({ fret: f, ...ellipse(centre(f), mid - off, dotR) },
                { fret: f, ...ellipse(centre(f), mid + off, dotR) });
  }

  const onScreen = p => fromLevel(p);
  const edge = hasEdge
    ? [sidePoint(neckStart, 0), sidePoint(DX1, 0), sidePoint(DX1, depth), sidePoint(neckStart, depth)].map(onScreen)
    : null;
  // Side dots sit halfway down the side, drawn in the side's own plane.
  const sideDots = hasEdge
    ? numbered.map(f => ellipseAt((dx, dy) => onScreen(sidePoint(centre(f) + dx, depth / 2 + dy)),
                                  Math.min(1.9, depth * 0.3)))
    : [];

  // The wire at the left edge of what's drawn, when that's past the nut,
  // then the right edge of every fret drawn.
  const wireSeg = x => seg(x, top, x, bottom);
  const wires = [];
  if (!openShown) wires.push(wireSeg(DX0));
  for (let f = Math.max(dFirst, 1); f <= dLast; f++) wires.push(wireSeg(wire[f]));
  const nut = openShown ? wireSeg(wire[0]) : null;

  return {
    width, height, top, bottom, pitch, view: v, range: [first, last], stretch,
    bounds: { w: bx1 - bx0, h: by1 - by0 },   // the window before fitting: what stretch reads
    wood: quad(neckStart, top, DX1, bottom),
    openCol: openShown ? quad(left(0), top, wire[0], bottom) : null,
    nut, wires,
    // The window's two ends: what the readout compares.
    ends: [first === 0 ? wireSeg(wire[0]) : wireSeg(X0), wireSeg(X1)],
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
export const smallestCell = L => Math.min(...L.cells.filter(c => c.inWindow).map(c => c.size));

/* What the view does to the picture, measured from the drawing rather than
   worked out from the settings, so it is true whatever combination made it:

     gaps  the farthest string gap as a fraction of the nearest, at the fret
           nearest the middle of the neck (B–E against E–A on a guitar)
     nut   how tall the nut end looks against the body end, measured across
           the neck (perpendicular to its length), so a tilt's keystone
           slant doesn't read as the headstock receding

   Both are 1 when the view does nothing to them. */
export function readout(L){
  const n = L.strings.length;
  const frets = [...new Set(L.cells.filter(c => c.inWindow).map(c => c.fret))];
  const f = frets[Math.floor(frets.length / 2)];
  const at = i => cellOf(L, { string: i, fret: f });
  const gap = (i, j) => (at(i) && at(j) ? dist([at(i).cx, at(i).cy], [at(j).cx, at(j).cy]) : null);
  const near = gap(0, 1), far = gap(n - 2, n - 1);

  const [headEnd, bodyEnd] = L.ends;
  const midOf = ([[ax, ay], [bx, by]]) => [(ax + bx) / 2, (ay + by) / 2];
  const [nx, ny] = midOf(headEnd), [bx, by] = midOf(bodyEnd);
  const al = Math.hypot(bx - nx, by - ny), ux = (bx - nx) / al, uy = (by - ny) / al;
  const across = ([[ax, ay], [cx, cy]]) => Math.abs((cx - ax) * uy - (cy - ay) * ux);
  return {
    gaps: n >= 3 && near && far ? far / near : 1,
    nut: across(headEnd) / across(bodyEnd),
  };
}

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
  let inst = null, L = null, marks = [], dim = null, from = 0;

  function draw(){
    if (!inst) { svg.replaceChildren(); return; }
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    L = layout(inst, { width, height }, from);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const [a, b] = L.range;
    svg.setAttribute("aria-label", `Fretboard: ${inst.strings.length} strings, ` +
      (a === 0 && b === inst.frets ? `${inst.frets} frets` : `frets ${a || "open"} to ${b} of ${inst.frets}`));

    const g = [];
    if (L.openCol) g.push(el("polygon", { class: "fb-open", points: points(L.openCol) }));
    if (L.edge) g.push(el("polygon", { class: "fb-edge", points: points(L.edge) }));
    g.push(el("polygon", { class: "fb-wood", points: points(L.wood) }));
    for (const d of L.sideDots) g.push(oval("fb-side", d));
    for (const d of L.inlays) g.push(oval("fb-inlay", d));
    for (const w of L.wires) g.push(line("fb-fret", w));
    if (L.nut) g.push(line("fb-nut", L.nut));
    for (const s of L.strings){
      if (s.spike) g.push(el("circle", { class: "fb-spike", cx: s.spike[0], cy: s.spike[1], r: 3 }));
      if (s.line) g.push(line("fb-string", s.line, { "stroke-width": gauge(s.open) }));
    }
    for (const nb of L.numbers) g.push(el("text", { class: "fb-num", x: nb.cx, y: nb.y }, String(nb.fret)));

    // Everything outside the drill's fret window is dimmed, not hidden: the
    // neck stays whole, so where the window sits on it is itself information.
    if (dim){
      const [lo, hi] = dim;
      for (const c of L.cells) if (c.fret < lo || c.fret > hi){
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
    /* The instrument to draw; `from` is the first fret in view when it shows
       fewer than all of them, and `dim` an optional [lo, hi] of frets to
       leave bright, dimming the rest. */
    show(next, { from: f = 0, dim: d = null } = {}){ inst = next; from = f; dim = d; marks = []; draw(); },
    /* Moves the window along the neck, keeping the marks. */
    moveTo(f){ from = f; draw(); },
    /* Frets to leave bright, [lo, hi], dimming the rest; null for none.
       Keeps the marks. */
    setDim(d){
      if (d === dim || (d && dim && d[0] === dim[0] && d[1] === dim[1])) return;
      dim = d; draw();
    },
    /* A marker on a position: kind is a class ("note", "true", "miss",
       "target"), text an optional label inside it. */
    mark(pos, kind, text){ marks.push({ pos, kind, text }); draw(); },
    clearMarks(){ marks = []; draw(); },
    /* The current layout, for whoever needs its measurements. */
    get layout(){ return L; },
    destroy(){ ro.disconnect(); svg.remove(); },
  };
}

/* ------------------------------------------------------------- neck bar */

/* The whole neck in miniature, with the part the board is showing picked
   out, as a slider: drag or tap it to move along the neck, or use the arrow
   keys. Drawn flat and in the instrument's handedness, so it reads as a map
   of the neck you're holding whatever view the board uses. `onMove(from)`
   reports the new first fret in view. */
export function createNeckBar(host, { onMove } = {}){
  const svg = el("svg", { class: "nb", role: "slider", tabindex: "0",
                          "aria-orientation": "horizontal" });
  host.replaceChildren(svg);
  let inst = null, from = 0, L = null, dragging = false;

  function draw(){
    const width = host.clientWidth, height = host.clientHeight;
    if (!inst || !width || !height) return;
    /* The whole neck, flat. Only its frets and dots are drawn, so it's laid
       out with a single string: a real string count would ask for more
       height than a slim bar has. The box is sized so the neck fills the
       bar with 2px to spare, the room kept for fret numbers falling outside
       the viewBox. */
    const whole = { ...inst, strings: [{ open: 40, start: 0 }], view: { ...VIEW_PRESETS.tab, span: 0 } };
    L = layout(whole, { width, height: height - 4 + PAD_TOP + NUMBERS_H + 4 });
    const [a, b] = fretRange(inst, from);
    const inWindow = L.cells.filter(c => c.fret >= a && c.fret <= b);
    const xs = inWindow.flatMap(c => [c.x0, c.x1]);
    const [wx0, wx1] = [Math.min(...xs), Math.max(...xs)];
    svg.setAttribute("viewBox", `0 ${PAD_TOP - 2} ${width} ${height}`);   // the neck, with its 2px margins
    const g = [el("polygon", { class: "nb-wood", points: points(L.wood) })];
    if (L.openCol) g.push(el("polygon", { class: "nb-open", points: points(L.openCol) }));
    for (const w of L.wires) g.push(line("nb-fret", w));
    if (L.nut) g.push(line("nb-nut", L.nut));
    for (const d of L.inlays) g.push(oval("nb-dot", { ...d, rx: 2.2, ry: 2.2 }));
    g.push(el("rect", { class: "nb-win", x: wx0, y: L.top - 1, width: wx1 - wx0,
                        height: L.bottom - L.top + 2, rx: 3 }));
    svg.replaceChildren(...g);
    svg.setAttribute("aria-valuemin", "0");
    svg.setAttribute("aria-valuemax", String(lastFrom(inst)));
    svg.setAttribute("aria-valuenow", String(a));
    svg.setAttribute("aria-valuetext", a === 0 ? `open strings to fret ${b}` : `frets ${a} to ${b}`);
    svg.setAttribute("aria-label", "Position on the neck");
  }

  function set(f){
    const next = Math.max(0, Math.min(lastFrom(inst), f));
    if (next === from) return;
    from = next;
    draw();
    if (onMove) onMove(from);
  }

  /* Centre the window on the fret nearest the pointer. */
  function toPointer(e){
    if (!L) return;
    const x = e.clientX - svg.getBoundingClientRect().left;
    const nearest = L.cells.reduce((best, c) => (Math.abs(c.cx - x) < Math.abs(best.cx - x) ? c : best));
    set(nearest.fret - Math.floor(inst.view.span / 2));
  }

  svg.addEventListener("pointerdown", e => {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    toPointer(e);
    e.preventDefault();
  });
  svg.addEventListener("pointermove", e => { if (dragging) toPointer(e); });
  const end = e => {
    dragging = false;
    if (svg.hasPointerCapture && svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);

  /* Keys follow the neck, not the screen: "up the neck" is towards the body
     whichever way a left-handed instrument points it. */
  svg.addEventListener("keydown", e => {
    if (!inst) return;
    const toBody = inst.leftHanded ? "ArrowLeft" : "ArrowRight";
    const toNut  = inst.leftHanded ? "ArrowRight" : "ArrowLeft";
    const step = { [toBody]: 1, [toNut]: -1, ArrowUp: 1, ArrowDown: -1,
                   PageUp: inst.view.span, PageDown: -inst.view.span }[e.key];
    if (step !== undefined){ e.preventDefault(); set(from + step); }
    else if (e.key === "Home"){ e.preventDefault(); set(0); }
    else if (e.key === "End"){ e.preventDefault(); set(lastFrom(inst)); }
  });

  const ro = new ResizeObserver(draw);
  ro.observe(host);

  return {
    show(next, f = 0){ inst = next; from = Math.max(0, Math.min(lastFrom(next), f)); draw(); },
    destroy(){ ro.disconnect(); svg.remove(); },
  };
}
