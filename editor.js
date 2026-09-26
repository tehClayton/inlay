/* The instrument editor. Works on a draft: nothing is stored until Save, so
   Cancel is always safe, and Save is only offered while the draft is valid.

   Tunings are typed ("E2", "Db3") because that is faster than any picker for
   someone who knows their tuning, and it covers every instrument without a
   list of presets to maintain. Each field says immediately whether it reads. */
import { h, label } from "./ui.js";
import { parsePitch, pitchName } from "./theory.js";
import { validate, stringNumber, VIEWS, MAX_STRINGS, MAX_FRETS, MAX_NAME } from "./instrument.js";

const int = v => (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN);

/* Renders into `root`. `inst` is the instrument being edited, or a fresh one
   from newInstrument() when `isNew`. */
export function renderEditor(root, { inst, isNew, notePref, onSave, onCancel, onDelete }){
  const draft = {
    name: inst.name,
    strings: inst.strings.map(s => ({ text: pitchName(s.open, notePref), start: String(s.start) })),
    frets: String(inst.frets),
    leftHanded: inst.leftHanded,
    view: inst.view,
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
      view: draft.view,
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
    return errs.length === 0;
  }

  function commit(){
    if (check()) onSave(build());
  }

  const checkbox = (key, text) => h("label", { class: "check" },
    h("input", { type: "checkbox", checked: draft[key],
                 onchange: e => { draft[key] = e.target.checked; } }),
    text);

  /* One of three, so radio chips rather than a checkbox. Labelled by what you
     see, since "tab" and "flipped" mean little until you've seen both. */
  const VIEW_TEXT = {
    tab:     ["Tab", "low string at the bottom"],
    flipped: ["Flipped", "low string on top"],
    player:  ["Player's view", "looking down across the strings"],
  };
  const viewPick = h("div", { class: "pick", role: "radiogroup", "aria-labelledby": "viewLabel" });
  function drawViews(){
    viewPick.replaceChildren(...VIEWS.map(v => {
      const on = draft.view === v;
      return h("button", {
        class: "chip two" + (on ? " sel" : ""), role: "radio", "aria-checked": String(on),
        onclick: () => { draft.view = v; drawViews(); },
      }, h("b", {}, VIEW_TEXT[v][0]), h("i", {}, VIEW_TEXT[v][1]));
    }));
  }
  drawViews();

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
      viewPick),
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
