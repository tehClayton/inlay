/* The fretboard: geometry, hit-testing and SVG drawing.

   layout() and cellAt() are pure, so the geometry is tested without a browser.
   createFretboard() is the DOM half; it only draws what layout() computed.

   Geometry is worked out FLAT in one canonical orientation — nut on the left,
   face-side string at the top — and every point then goes through a single
   transform for the view: a vertical flip for tab, a perspective projection
   for the player's view, a horizontal flip for left-handed. So there is one
   set of fret arithmetic, and hit-testing is the same transform run backwards
   into the flat layout, where finding a cell is a rectangle test. */

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

/* The player's view: the neck as you see it while playing, looking down
   across the fretboard from above its low-string side, along the plane of
   the strings. The string nearest your eye is nearest the screen's bottom
   edge, and each string further away is foreshortened a little more, so the
   gaps close up towards the far side: on a guitar, B to high E looks tighter
   than low E to A.

   That is a perspective along one axis only. Frets stay vertical and the
   neck keeps its height from nut to body — really, the headstock end would
   recede a little too, but a level, full-height neck is easier to read and
   to hit, and the cross-string foreshortening is what makes the view.

   FAR_SPACING is how wide the far edge's string spacing looks relative to the
   near edge's. EDGE is the side of the fretboard you see from above, below
   the near string, where the side dots sit. */
const FAR_SPACING = 0.7;
const EDGE = 7;

/* ------------------------------------------------------------ projection */

/* A one-dimensional perspective on [0, 1], 0 nearest the eye: t(v) =
   (1+c)v / (1+cv). It fixes both ends, and its slope falls from (1+c) at
   the near end to 1/(1+c) at the far end, so the far/near spacing ratio is
   1/(1+c)², which sets c from FAR_SPACING. It is the projective map of a
   line, so what is evenly spaced on the fretboard stays in order on screen
   and simply closes up with distance. */
const PERSPECTIVE_C = 1 / Math.sqrt(FAR_SPACING) - 1;
export const recede = (v, c = PERSPECTIVE_C) => (1 + c) * v / (1 + c * v);
export const unrecede = (t, c = PERSPECTIVE_C) => t / (1 + c - c * t);

const dist = ([ax, ay], [bx, by]) => Math.hypot(bx - ax, by - ay);

/* ---------------------------------------------------------------- layout */

/* Everything the renderer draws and the hit test reads, in CSS pixels of a
   width x height box. Shapes come out already transformed: polygons as point
   lists, lines as endpoint pairs, inlays as ellipses. */
export function layout(inst, { width, height }){
  const player = inst.view === "player";
  const n = inst.strings.length;
  const top = PAD_TOP;
  const bottom = Math.max(top + n * 8, height - NUMBERS_H - 4 - (player ? EDGE + 2 : 0));
  const pitch = (bottom - top) / n;             // vertical space per string
  const mid = (top + bottom) / 2;

  // Flat x: wire[f] is the right-hand edge of fret f; wire[0] is the nut.
  const weights = [];
  for (let f = 1; f <= inst.frets; f++) weights.push(TAPER ** (f - 1));
  const total = OPEN_WEIGHT + weights.reduce((a, b) => a + b, 0);
  const unit = (width - 2 * PAD_X) / total;
  const wire = [PAD_X + OPEN_WEIGHT * unit];
  for (const w of weights) wire.push(wire.at(-1) + w * unit);
  const left = f => (f === 0 ? PAD_X : wire[f - 1]);
  const X0 = PAD_X, X1 = wire[inst.frets];

  /* The view transform, flat -> screen, and its inverse. Each step is its own
     inverse or has one, so T⁻¹ is the steps undone in reverse order. */
  const flipY = inst.view !== "flipped";        // tab and player: face side at the bottom
  const fy = y => (flipY ? top + bottom - y : y);
  const fx = x => (inst.leftHanded ? width - x : x);
  let proj = p => p, unproj = p => p;
  if (player){
    // After the flip the near (face) side is at the bottom: v runs 0 there
    // to 1 at the top, and only y changes.
    const H = bottom - top;
    proj = ([x, y]) => [x, bottom - H * recede((bottom - y) / H)];
    unproj = ([x, y]) => [x, bottom - H * unrecede((bottom - y) / H)];
  }
  const T = ([x, y]) => { const [px, py] = proj([x, fy(y)]); return [fx(px), py]; };
  const Tinv = ([x, y]) => { const [ux, uy] = unproj([fx(x), y]); return [ux, fy(uy)]; };

  const quad = (x0, y0, x1, y1) => [T([x0, y0]), T([x1, y0]), T([x1, y1]), T([x0, y1])];
  const seg = (x0, y0, x1, y1) => [T([x0, y0]), T([x1, y1])];
  /* How much the view scales things near a flat point, across and along. */
  const scaleAt = (x, y) => [dist(T([x - 1, y]), T([x + 1, y])) / 2, dist(T([x, y - 1]), T([x, y + 1])) / 2];

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
        r: Math.min(w * 0.42, hgt * 0.46, 17),   // the marker that fits it
        flat: [x0, y0, x1, y1],
      });
    }
  });

  const centre = f => (left(f) + wire[f]) / 2;
  const dotR = Math.min(pitch * 0.2, 7);
  const ellipse = (x, y, r) => {
    const [cx, cy] = T([x, y]), [sx, sy] = scaleAt(x, y);
    return { cx, cy, rx: r * sx, ry: r * sy };
  };
  const inlays = [];
  for (const f of INLAY_SINGLE) if (f <= inst.frets) inlays.push({ fret: f, ...ellipse(centre(f), mid, dotR) });
  for (const f of INLAY_DOUBLE) if (f <= inst.frets){
    // In the gaps either side of the middle, where they sit on a real neck:
    // between strings 2–3 and 4–5 on a guitar. With an odd count the middle
    // is a string, so step out to the next gaps. Too few strings to have
    // such gaps: a quarter in from each edge.
    const off = n >= 4 ? (n % 2 ? 1.5 : 1) * pitch : (bottom - top) / 4;
    inlays.push({ fret: f, ...ellipse(centre(f), mid - off, dotR) },
                { fret: f, ...ellipse(centre(f), mid + off, dotR) });
  }
  const numbered = [...INLAY_SINGLE, ...INLAY_DOUBLE].filter(f => f <= inst.frets).sort((a, b) => a - b);

  /* The fretboard's near edge, seen from above in the player's view: the
     face side's edge, beyond its string, with side dots along it. */
  const edge = player ? quad(wire[0], top - EDGE, X1, top) : null;
  const sideDots = player ? numbered.map(f => ellipse(centre(f), top - EDGE / 2, 1.9)) : [];

  // Fret numbers sit just below whatever is drawn lowest at that fret.
  const numbers = numbered.map(f => {
    const ys = [T([centre(f), top]), T([centre(f), bottom])];
    if (player) ys.push(T([centre(f), top - EDGE]));
    return { fret: f, cx: T([centre(f), mid])[0], y: Math.max(...ys.map(p => p[1])) + 12 };
  });

  return {
    width, height, top, bottom, pitch, view: inst.view,
    wood: quad(wire[0], top, X1, bottom),
    openCol: quad(X0, top, wire[0], bottom),
    nut: seg(wire[0], top, wire[0], bottom),
    wires: wire.slice(1).map(x => seg(x, top, x, bottom)),
    strings, cells, inlays, edge, sideDots, numbers,
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
    for (const d of L.sideDots) g.push(el("ellipse", { class: "fb-side", cx: d.cx, cy: d.cy, rx: d.rx, ry: d.ry }));
    for (const d of L.inlays) g.push(el("ellipse", { class: "fb-inlay", cx: d.cx, cy: d.cy, rx: d.rx, ry: d.ry }));
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
    destroy(){ ro.disconnect(); svg.remove(); },
  };
}
