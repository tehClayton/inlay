/* The fretboard: geometry, hit-testing and SVG drawing.

   layout() and cellAt() are pure, so the geometry is tested without a browser.
   createFretboard() is the DOM half; it only draws what layout() computed.

   Geometry is worked out in one canonical orientation — nut on the left, the
   face-side string at the top — and mirrored at the end for left-handed and
   tab view, so there is exactly one set of arithmetic to get right. */

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

/* Everything the renderer draws and the hit test reads, in CSS pixels of a
   width x height box. */
export function layout(inst, { width, height }){
  const n = inst.strings.length;
  const top = PAD_TOP;
  const bottom = Math.max(top + n * 8, height - NUMBERS_H - 4);
  const pitch = (bottom - top) / n;             // vertical space per string

  // Canonical x: wire[f] is the right-hand edge of fret f; wire[0] is the nut.
  const weights = [];
  for (let f = 1; f <= inst.frets; f++) weights.push(TAPER ** (f - 1));
  const total = OPEN_WEIGHT + weights.reduce((a, b) => a + b, 0);
  const unit = (width - 2 * PAD_X) / total;
  const wire = [PAD_X + OPEN_WEIGHT * unit];
  for (const w of weights) wire.push(wire.at(-1) + w * unit);
  const left = f => (f === 0 ? PAD_X : wire[f - 1]);

  // Mirroring, applied once on the way out.
  const X = x => (inst.leftHanded ? width - x : x);
  const Y = y => (inst.tabView ? top + bottom - y : y);
  const span = (a, b) => [Math.min(X(a), X(b)), Math.max(X(a), X(b))];

  const strings = inst.strings.map((s, i) => {
    const y = top + (i + 0.5) * pitch;
    // A string starts at its own nut: the main nut, or a banjo's fifth-string
    // spike at fret `start`.
    const [x0, x1] = span(s.start === 0 ? wire[0] : wire[s.start], wire[inst.frets]);
    return { index: i, y: Y(y), x0, x1, open: s.open, nutX: s.start ? X(wire[s.start]) : null };
  });

  /* One cell per playable position. Fret `start` is a string's open position,
     drawn in the space just before its nut, like the open column. */
  const cells = [];
  inst.strings.forEach((s, i) => {
    const y0 = top + i * pitch, y1 = y0 + pitch;
    for (let f = s.start; f <= inst.frets; f++){
      const [x0, x1] = span(left(f), f === 0 ? wire[0] : wire[f]);
      const [ya, yb] = [Y(y0), Y(y1)].sort((a, b) => a - b);
      cells.push({ string: i, fret: f, x0, x1, y0: ya, y1: yb,
                   cx: (x0 + x1) / 2, cy: Y(y0 + pitch / 2) });
    }
  });

  const mid = (top + bottom) / 2;
  const inlays = [];
  const centre = f => X((left(f) + wire[f]) / 2);
  for (const f of INLAY_SINGLE) if (f <= inst.frets) inlays.push({ fret: f, cx: centre(f), cy: mid });
  for (const f of INLAY_DOUBLE) if (f <= inst.frets){
    // In the gaps either side of the middle, where they sit on a real neck:
    // between strings 2–3 and 4–5 on a guitar. With an odd count the middle
    // is a string, so step out to the next gaps. Too few strings to have
    // such gaps: a quarter in from each edge.
    const off = n >= 4 ? (n % 2 ? 1.5 : 1) * pitch : (bottom - top) / 4;
    inlays.push({ fret: f, cx: centre(f), cy: Y(mid - off) },
                { fret: f, cx: centre(f), cy: Y(mid + off) });
  }

  const numbered = [...INLAY_SINGLE, ...INLAY_DOUBLE].filter(f => f <= inst.frets);

  return {
    width, height, top, bottom, pitch,
    nutX: X(wire[0]),
    wires: wire.slice(1).map(X),
    neck: span(wire[0], wire[inst.frets]),
    openCol: span(PAD_X, wire[0]),
    strings, cells, inlays,
    numbers: numbered.map(f => ({ fret: f, cx: centre(f), y: bottom + NUMBERS_H - 3 })),
  };
}

/* The playable position under a point, or null. */
export function cellAt(L, x, y){
  for (const c of L.cells){
    if (x >= c.x0 && x < c.x1 && y >= c.y0 && y < c.y1) return { string: c.string, fret: c.fret };
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

    const [n0, n1] = L.neck, [o0, o1] = L.openCol;
    const g = [];
    g.push(el("rect", { class: "fb-open", x: o0, y: L.top, width: o1 - o0, height: L.bottom - L.top }));
    g.push(el("rect", { class: "fb-wood", x: n0, y: L.top, width: n1 - n0, height: L.bottom - L.top, rx: 2 }));
    for (const d of L.inlays) g.push(el("circle", { class: "fb-inlay", cx: d.cx, cy: d.cy,
      r: Math.min(L.pitch * 0.2, 7) }));
    for (const x of L.wires) g.push(el("line", { class: "fb-fret", x1: x, x2: x, y1: L.top, y2: L.bottom }));
    g.push(el("line", { class: "fb-nut", x1: L.nutX, x2: L.nutX, y1: L.top, y2: L.bottom }));
    for (const s of L.strings){
      if (s.nutX !== null) g.push(el("circle", { class: "fb-spike", cx: s.nutX, cy: s.y, r: 3 }));
      g.push(el("line", { class: "fb-string", x1: s.x0, x2: s.x1, y1: s.y, y2: s.y,
        "stroke-width": gauge(s.open) }));
    }
    for (const nb of L.numbers) g.push(el("text", { class: "fb-num", x: nb.cx, y: nb.y }, String(nb.fret)));

    // Everything outside the drill's fret window is dimmed, not hidden: the
    // neck stays whole, so where the window sits on it is itself information.
    if (windowFrets){
      const [a, b] = windowFrets;
      for (const c of L.cells) if (c.fret < a || c.fret > b){
        g.push(el("rect", { class: "fb-dim", x: c.x0, y: c.y0, width: c.x1 - c.x0, height: c.y1 - c.y0 }));
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
    const r = Math.min((c.x1 - c.x0) * 0.42, L.pitch * 0.46, 17);
    const g = el("g", { class: `fb-mark ${kind}` });
    g.append(el("circle", { cx: c.cx, cy: c.cy, r }));
    // Sized to the label, so "C♯/D♭" fits the same circle as "E".
    const size = Math.max(7, Math.min(r * 0.82, 2.6 * r / Math.max(1, [...(text ?? "")].length)));
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
