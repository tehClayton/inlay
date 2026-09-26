/* The instrument editor. Works on a draft: nothing is stored until Save, so
   Cancel is always safe, and Save is only offered while the draft is valid.

   Tunings are typed ("E2", "Db3") because that is faster than any picker for
   someone who knows their tuning, and it covers every instrument without a
   list of presets to maintain. Each field says immediately whether it reads. */
import { h, label } from "./ui.js";
import { parsePitch, pitchName, noteName } from "./theory.js";
import {
  validate, stringNumber, VIEW_PRESETS, VIEW_RANGES, presetOf, MIN_SPAN,
  MAX_STRINGS, MAX_FRETS, MAX_NAME,
} from "./instrument.js";
import { createFretboard, layout, readout, smallestCell } from "./fretboard.js";

const int = v => (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN);

/* Below this, a target is fiddly for a fingertip on the real board. */
const SMALL_TARGET = 14;

/* Renders into `root`. `inst` is the instrument being edited, or a fresh one
   from newInstrument() when `isNew`. `boardSize` is the practice board's
   size, so the editor can warn when a view makes frets too small there. */
export function renderEditor(root, { inst, isNew, notePref, boardSize, onSave, onCancel, onDelete }){
  root._preview?.destroy();
  const draft = {
    name: inst.name,
    strings: inst.strings.map(s => ({ text: pitchName(s.open, notePref), start: String(s.start) })),
    frets: String(inst.frets),
    leftHanded: inst.leftHanded,
    view: { ...inst.view },
  };

  const title = h("h2", { id: "editTitle" }, isNew ? "New instrument" : "Edit instrument");
  const name = h("input", {
    type: "text", maxlength: MAX_NAME, value: draft.name, autocomplete: "off",
    oninput: e => { draft.name = e.target.value; check(); },
  });
  const rows = h("div", { class: "strows" });
  const frets = h("input", {
    type: "text", inputmode: "numeric", value: draft.frets, class: "num",
    oninput: e => { draft.frets = e.target.value; check(); },
  });
  const err = h("p", { class: "err", role: "alert" });
  const save = h("button", { class: "go", onclick: commit }, "Save");
  const addTop = h("button", { class: "mini", onclick: () => add(0) }, "Add at top");
  const addEnd = h("button", { class: "mini", onclick: () => add(draft.strings.length) }, "Add at bottom");

  /* Rows are rebuilt whenever strings are added or removed; typing only
     updates the draft, so a field never loses focus under the cursor. */
  function drawRows(){
    rows.replaceChildren(...draft.strings.map((s, i) => {
      const n = stringNumber(i, draft.strings.length);
      const tune = h("input", {
        type: "text", class: "tune", value: s.text, autocomplete: "off",
        spellcheck: "false", autocapitalize: "characters",
        oninput: e => { s.text = e.target.value; check(); },
        onblur: e => {
          const m = parsePitch(s.text);
          if (m !== null){ s.text = pitchName(m, notePref); e.target.value = s.text; }
        },
      });
      label(tune, `String ${n} tuning, e.g. E2`);
      const start = h("input", {
        type: "text", inputmode: "numeric", class: "num sm", value: s.start,
        oninput: e => { s.start = e.target.value; check(); },
      });
      label(start, `String ${n} nut position: the first fret it can be played at. ` +
                   `0 for most strings, 5 for a banjo's short fifth string`);
      const del = h("button", {
        class: "mini warn", disabled: draft.strings.length <= 1,
        onclick: () => { draft.strings.splice(i, 1); drawRows(); check(); },
      }, "✕");
      label(del, `Remove string ${n}`);
      return h("div", { class: "strow", "data-i": i },
        h("span", { class: "sn" }, String(n)), tune,
        h("span", { class: "nutlab", "aria-hidden": "true" }, "nut"), start, del);
    }));
    addTop.disabled = addEnd.disabled = draft.strings.length >= MAX_STRINGS;
  }

  /* A new string copies its neighbour's tuning, which is at least a real
     pitch on this instrument and usually one edit from right. */
  function add(at){
    const near = draft.strings[Math.min(at, draft.strings.length - 1)];
    draft.strings.splice(at, 0, { text: near ? near.text : "E2", start: "0" });
    drawRows();
    check();
    rows.querySelectorAll(".tune")[at].focus();
  }

  function build(){
    return {
      ...inst,
      name: draft.name.trim(),
      strings: draft.strings.map(s => ({ open: parsePitch(s.text), start: int(s.start) })),
      frets: int(draft.frets),
      leftHanded: draft.leftHanded,
      view: { ...draft.view },
    };
  }

  /* Field-level marks for the two things people actually mistype, tunings
     and numbers; the model's own validate() has the last word on the rest. */
  function check(){
    const out = build();
    rows.querySelectorAll(".strow").forEach((row, i) => {
      const s = out.strings[i];
      row.querySelector(".tune").toggleAttribute("aria-invalid", s.open === null);
      row.querySelector(".num").toggleAttribute("aria-invalid",
        !Number.isInteger(s.start) || !(s.start < out.frets || !Number.isInteger(out.frets)));
    });
    frets.toggleAttribute("aria-invalid", !(out.frets >= 1 && out.frets <= MAX_FRETS));
    const errs = validate(out);
    const bad = out.strings.findIndex(s => s.open === null);
    const n = stringNumber(bad, out.strings.length);
    err.textContent =
      bad >= 0 ? `String ${n}: "${draft.strings[bad].text}" isn't a pitch. Try a note and octave, like E2 or C#4.`
      : errs.length ? friendly(errs[0], out.strings.length)
      : "";
    save.disabled = errs.length > 0;
    refreshView(out);
    return errs.length === 0;
  }

  function commit(){
    if (check()) onSave(build());
  }

  const checkbox = (key, text) => h("label", { class: "check" },
    h("input", { type: "checkbox", checked: draft[key],
                 onchange: e => { draft[key] = e.target.checked; } }),
    text);

  /* ------------------------------------------------------------- view */
  /* Presets are starting points; the sliders adjust from any of them. The
     sliders are the camera (tilt, turn, angle, perspective, edge depth), and
     underneath them a line says what that does to the picture in the words
     you'd describe it by ("B–E at 81% of E–A"), measured from the drawing. A
     live preview draws the draft instrument through the draft view. */
  const PRESET_TEXT = {
    tab:     ["Tab", "low string at the bottom"],
    flipped: ["Flipped", "low string on top"],
    player:  ["Player's view", "tilted, as you look down at it"],
  };
  const presetPick = h("div", { class: "pick", role: "radiogroup", "aria-labelledby": "viewLabel" });
  const previewBox = h("div", { class: "fbprev", "aria-hidden": "true" });
  const preview = createFretboard(previewBox);
  root._preview = preview;
  const effects = h("p", { class: "effects" });
  const warn = h("p", { class: "err" });
  let lastGood = null;

  const deg = v => (v ? `${Math.round(v)}°` : "none");
  const SLIDERS = [
    { key: "tilt",        name: "Tilt",        axis: "x", step: 1,    say: deg },
    { key: "turn",        name: "Turn",        axis: "y", step: 1,    say: deg },
    { key: "angle",       name: "Angle",       axis: "z", step: 1,    say: v => (v ? `${Math.round(v)}°` : "level") },
    { key: "perspective", name: "Perspective", axis: "",  step: 0.05, say: v => (v ? `${Math.round(v * 100)}%` : "none") },
    { key: "edge",        name: "Edge depth",  axis: "",  step: 0.05, say: v => (v ? `${Math.round(v * 100)}% of a string gap` : "none") },
  ];

  const sliders = SLIDERS.map(sl => {
    const [min, max] = VIEW_RANGES[sl.key];
    const out = h("output", { class: "val" });
    const input = h("input", {
      type: "range", min, max, step: sl.step,
      oninput: e => { draft.view[sl.key] = Number(e.target.value); refreshView(build()); },
    });
    label(input, sl.axis ? `${sl.name}, about the ${sl.axis} axis` : sl.name);
    return { ...sl, input, out, row: h("label", { class: "slide" },
      h("span", {}, sl.name, sl.axis ? h("i", { class: "axis" }, ` ${sl.axis}`) : null), input, out) };
  });

  /* What the view does to the picture, in the terms we describe it by. */
  function describe(inst, L){
    const { gaps, nut } = readout(L);
    const parts = [];
    const n = inst.strings.length;
    if (n >= 3 && Math.abs(gaps - 1) > 0.005){
      const nm = i => noteName(inst.strings[i].open, notePref);
      parts.push(`${nm(n - 2)}–${nm(n - 1)} at ${Math.round(gaps * 100)}% of ${nm(0)}–${nm(1)}`);
    }
    if (Math.abs(nut - 1) > 0.005) parts.push(`nut end at ${Math.round(nut * 100)}%`);
    return parts.length ? parts.join(" · ") : "flat: no foreshortening";
  }

  const flip = h("input", { type: "checkbox",
    onchange: e => { draft.view.flip = e.target.checked; refreshView(build()); } });

  /* Frets shown at a time: the same setting as the − / + above the board.
     The slider runs up to this neck's own fret count, and the top of it is
     "all", stored as 0 so the whole neck stays whole if frets are added. */
  const neckFrets = () => {
    const f = int(draft.frets);
    return f >= 1 && f <= MAX_FRETS ? f : (lastGood ? lastGood.frets : MAX_FRETS);
  };
  const spanOut = h("output", { class: "val" });
  const spanInput = h("input", { type: "range", step: 1,
    oninput: e => {
      const v = Number(e.target.value);
      draft.view.span = v >= neckFrets() ? 0 : v;
      refreshView(build());
    } });
  label(spanInput, "Frets shown at a time");
  const spanRow = h("label", { class: "slide" }, h("span", {}, "Frets shown"), spanInput, spanOut);

  /* `inst` is the draft built into an instrument. While it doesn't validate
     (a half-typed tuning), the preview keeps showing the last one that did. */
  function refreshView(inst){
    if (inst && validate(inst).length === 0) lastGood = inst;
    const which = presetOf(draft.view);
    // Filtered, because replaceChildren prints a null as the text "null".
    presetPick.replaceChildren(...[
      ...Object.keys(VIEW_PRESETS).map(p => {
        const on = which === p;
        return h("button", {
          class: "chip two" + (on ? " sel" : ""), role: "radio", "aria-checked": String(on),
          // How many frets are shown isn't part of a preset; keep it.
          onclick: () => { draft.view = { ...VIEW_PRESETS[p], span: draft.view.span }; refreshView(build()); },
        }, h("b", {}, PRESET_TEXT[p][0]), h("i", {}, PRESET_TEXT[p][1]));
      }),
      which ? null : h("span", { class: "chip two sel custom", "aria-current": "true" },
        h("b", {}, "Custom"), h("i", {}, "adjusted below")),
    ].filter(Boolean));
    for (const sl of sliders){
      sl.input.value = String(draft.view[sl.key]);
      sl.out.textContent = sl.say(draft.view[sl.key]);
    }
    flip.checked = draft.view.flip;
    // min and max before value, or the browser clamps the value to the old range.
    const nf = neckFrets(), part = draft.view.span > 0 && draft.view.span < nf;
    spanInput.min = String(Math.min(MIN_SPAN, nf));
    spanInput.max = String(nf);
    spanInput.disabled = nf <= MIN_SPAN;
    spanInput.value = String(part ? draft.view.span : nf);
    spanOut.textContent = part ? `${draft.view.span} at a time` : `all ${nf}`;
    if (!lastGood) return;
    const shown = { ...lastGood, view: { ...draft.view } };
    preview.show(shown);
    // Measured on the real board's size when known: that's what you'll tap.
    const size = boardSize && boardSize.width ? boardSize : { width: 720, height: 240 };
    const L = layout(shown, size);
    effects.textContent = describe(shown, L);
    const small = smallestCell(L);
    warn.textContent = small < SMALL_TARGET
      ? `Some frets will be ${Math.round(small)}px across on your board: small to tap. ` +
        `Less tilt or angle, or fewer frets shown, makes them bigger.`
      : "";
  }

  label(name, "Instrument name");
  label(frets, `Number of frets, 1 to ${MAX_FRETS}`);

  root.replaceChildren(
    h("div", { class: "sect" }, title, name),
    h("div", { class: "sect" },
      h("h2", {}, "Strings ", h("span", { class: "hint" }, "nearest your face first")),
      rows,
      h("div", { class: "pick" }, addTop, addEnd)),
    h("div", { class: "sect" },
      h("label", { class: "inline" }, "Frets", frets),
      checkbox("leftHanded", "Left-handed: nut on the right")),
    h("div", { class: "sect" },
      h("h2", { id: "viewLabel" }, "View"),
      presetPick,
      previewBox,
      h("label", { class: "check" }, flip, "Low string on top"),
      spanRow,
      ...sliders.map(sl => sl.row),
      effects,
      warn),
    h("div", { class: "sect actions" },
      err,
      h("div", { class: "btns" },
        isNew ? null : h("button", { class: "mini warn", onclick: () => onDelete(inst) }, "Delete"),
        h("span", { class: "grow" }),
        h("button", { onclick: onCancel }, "Cancel"),
        save)),
  );
  root.setAttribute("aria-labelledby", "editTitle");
  drawRows();
  check();
}

/* validate() counts strings from the face side, 1-based; people count them
   the other way (see stringNumber), so its messages are renumbered. */
function friendly(e, count){
  if (e === "name missing") return "Give the instrument a name.";
  if (e.startsWith("frets")) return `Frets must be a whole number from 1 to ${MAX_FRETS}.`;
  const m = /^string (\d+): first fret/.exec(e);
  if (m) return `String ${stringNumber(Number(m[1]) - 1, count)}: the nut must sit below the last fret.`;
  return e;
}
