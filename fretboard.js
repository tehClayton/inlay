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

/* Perspective 1 puts the eye this many board-heights away divided into one:
   at full strength the eye is 2.5 board-heights from the neck's centre. */
const PERSPECTIVE_K = 0.4;

const dist = ([ax, ay], [bx, by]) => Math.hypot(bx - ax, by - ay);
const identity = p => p;
const rad = d => d * Math.PI / 180;

/* ---------------------------------------------------------------- camera */

/* The camera for a view, working in coordinates centred on the neck with y
   pointing to the bass edge. `height` is the neck's flat height, which sets
   the eye's distance. `project` takes a point on or off the fretboard's face
   (z > 0 towards the eye) to the screen; `unproject` takes a screen point
   back to the face (z = 0), where it has a unique answer. */
export function camera({ tilt, turn, perspective, bassSign }, height){
  const a = rad(tilt) * bassSign;               // the bass edge comes towards you
  const b = rad(turn);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const q = perspective * PERSPECTIVE_K / height;  // 1 / eye distance; 0 is none

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
  const midX = (X0 + X1) / 2;

  // 1. Orientation. Canonical has the bass edge at the top; self-inverse.
  const orient = ([x, y]) => [x, v.flip ? y : top + bottom - y];
  const bassSign = v.flip ? -1 : 1;             // which way is the bass edge, on screen
  const bassY = v.flip ? top : bottom;

  // 2. Camera, centred on the neck.
  const cam = camera({ ...v, bassSign }, H);
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
  const numbered = [...INLAY_SINGLE, ...INLAY_DOUBLE].filter(f => f <= inst.frets).sort((a, b) => a - b);
  const numberAt = numbered.map(f => {
    const ys = [level([centre(f), top])[1], level([centre(f), bottom])[1]];
    if (hasEdge) ys.push(sidePoint(centre(f), depth)[1]);
    return [level([centre(f), mid])[0], Math.max(...ys) + 12];
  });

  // 4. Fit. Only when steps 1–3 spill out of the box, and then uniformly,
  //    so nothing is distorted: the neck is shrunk and centred.
  const outline = [
    ...[[X0, top], [X1, top], [X1, bottom], [X0, bottom]].map(level),
    ...(hasEdge ? [sidePoint(wire[0], depth), sidePoint(X1, depth)] : []),
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

  // 5. Handedness; self-inverse.
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
  const ellipseAt = (at, r) => {
    const [cx, cy] = at(0, 0);
    const a0 = at(-1, 0), a1 = at(1, 0);
    return { cx, cy, rx: r * dist(a0, a1) / 2, ry: r * dist(at(0, -1), at(0, 1)) / 2,
             rot: Math.atan2(a1[1] - a0[1], a1[0] - a0[0]) * 180 / Math.PI };
  };
  const ellipse = (x, y, r) => ellipseAt((dx, dy) => T([x + dx, y + dy]), r);
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

  const onScreen = p => fromLevel(p);
  const edge = hasEdge
    ? [sidePoint(wire[0], 0), sidePoint(X1, 0), sidePoint(X1, depth), sidePoint(wire[0], depth)].map(onScreen)
    : null;
  // Side dots sit halfway down the side, drawn in the side's own plane.
  const sideDots = hasEdge
    ? numbered.map(f => ellipseAt((dx, dy) => onScreen(sidePoint(centre(f) + dx, depth / 2 + dy)),
                                  Math.min(1.9, depth * 0.3)))
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
  const frets = [...new Set(L.cells.map(c => c.fret))];
  const f = frets[Math.floor(frets.length / 2)];
  const at = i => cellOf(L, { string: i, fret: f });
  const gap = (i, j) => (at(i) && at(j) ? dist([at(i).cx, at(i).cy], [at(j).cx, at(j).cy]) : null);
  const near = gap(0, 1), far = gap(n - 2, n - 1);

  const midOf = ([[ax, ay], [bx, by]]) => [(ax + bx) / 2, (ay + by) / 2];
  const [nx, ny] = midOf(L.nut), [bx, by] = midOf(L.wires.at(-1));
  const al = Math.hypot(bx - nx, by - ny), ux = (bx - nx) / al, uy = (by - ny) / al;
  const across = ([[ax, ay], [cx, cy]]) => Math.abs((cx - ax) * uy - (cy - ay) * ux);
  return {
    gaps: n >= 3 && near && far ? far / near : 1,
    nut: across(L.nut) / across(L.wires.at(-1)),
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
