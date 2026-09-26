/* The instrument model. Pure: no DOM and no storage, so it is shared by the
   editor, the fretboard, the drills and import validation, and tested directly.

   Strings are listed in PHYSICAL order, from the string nearest the player's
   face to the one nearest the floor, not in pitch order. On most instruments
   those agree; on a ukulele's re-entrant high G or a banjo's short drone string
   they don't, and the fretboard has to draw strings where they actually are.

   Each string is { open, start }:
     open  - the pitch it sounds unfretted, as a MIDI number
     start - the fret its nut sits at: 0 normally, 5 for a banjo's fifth string.
             It is only playable from there up, and fretting it at `start + n`
             sounds `open + n`. */
import { parsePitch, pitchName } from "./theory.js";

export const MAX_STRINGS = 12;
export const MAX_FRETS   = 36;
export const MAX_NAME    = 40;

/* What a new instrument starts as. Standard-tuned guitar is the most likely
   thing someone is holding; everything about it is editable. */
export const DEFAULT_TUNING = ["E2", "A2", "D3", "G3", "B3", "E4"];
export const DEFAULT_FRETS  = 22;

/* How the neck is drawn. Described by what you see, not by where an eye
   would be, so each setting changes one visible thing:

     flip       false: the bass edge (the face-side string, a guitar's low E)
                at the bottom, as in tab. true: at the top.
     squeeze    string spacing across the neck closes up away from the bass
                edge, as seen by an eye above that edge. The far edge's
                spacing as a fraction of the near edge's; 1 is none.
     recession  the headstock end drawn smaller, as if receding. Its height
                as a fraction of the body end's; 1 is none.
     angle      the neck turned on screen, headstock end up, in degrees.
     edge       the side of the fretboard along the bass edge, with its side
                dots, as a fraction of one string gap; 0 is hidden.

   Presets are named starting points. Any other combination is "custom". */
export const VIEW_PRESETS = Object.freeze({
  tab:     Object.freeze({ flip: false, squeeze: 1,   recession: 1, angle: 0, edge: 0 }),
  flipped: Object.freeze({ flip: true,  squeeze: 1,   recession: 1, angle: 0, edge: 0 }),
  player:  Object.freeze({ flip: false, squeeze: 0.7, recession: 1, angle: 0, edge: 0.2 }),
});

/* Past these, frets get too small to tap on a phone or the neck stops
   reading as a neck. */
export const VIEW_RANGES = Object.freeze({
  squeeze:   [0.5, 1],
  recession: [0.6, 1],
  angle:     [0, 30],
  edge:      [0, 1],
});

const near = (a, b) => Math.abs(a - b) < 1e-6;
export const sameView = (a, b) =>
  a.flip === b.flip && Object.keys(VIEW_RANGES).every(k => near(a[k], b[k]));

/* The preset a view matches, or null for a custom one. */
export const presetOf = view =>
  Object.keys(VIEW_PRESETS).find(k => sameView(VIEW_PRESETS[k], view)) ?? null;

export function newInstrument(fields = {}, now = Date.now()){
  return {
    id: crypto.randomUUID(),
    name: "Guitar",
    strings: DEFAULT_TUNING.map(t => ({ open: parsePitch(t), start: 0 })),
    frets: DEFAULT_FRETS,
    leftHanded: false,
    view: { ...VIEW_PRESETS.tab },
    ...fields,
    created: now,
    updated: now,
  };
}

/* Brings an older stored shape up to date; anything else passes through for
   validate() to judge. Two earlier shapes:
     tabView: true|false  — true put the bass edge at the bottom, as tab does
     view: "tab" | "flipped" | "player"  — the presets, by name */
export function upgrade(x){
  if (!x || typeof x !== "object") return x;
  let out = x;
  if (!("view" in out) && typeof out.tabView === "boolean"){
    const { tabView, ...rest } = out;
    out = { ...rest, view: tabView ? "tab" : "flipped" };
  }
  if (typeof out.view === "string" && out.view in VIEW_PRESETS){
    out = { ...out, view: { ...VIEW_PRESETS[out.view] } };
  }
  return out;
}

function viewErrors(v){
  if (!v || typeof v !== "object") return ["view missing"];
  const errs = [];
  if (typeof v.flip !== "boolean") errs.push("view.flip not true/false");
  for (const [k, [lo, hi]] of Object.entries(VIEW_RANGES)){
    if (!Number.isFinite(v[k]) || v[k] < lo - 1e-9 || v[k] > hi + 1e-9) errs.push(`view.${k} not ${lo}–${hi}`);
  }
  return errs;
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/* Every reason x is not a usable instrument; empty when it is. Used on load
   and on import, where anything could be in the data, so it assumes nothing. */
export function validate(x){
  if (!x || typeof x !== "object") return ["not an object"];
  const errs = [];
  if (typeof x.id !== "string" || !x.id) errs.push("id missing");
  if (typeof x.name !== "string" || !x.name.trim()) errs.push("name missing");
  else if (x.name.length > MAX_NAME) errs.push(`name over ${MAX_NAME} characters`);
  if (!isInt(x.frets, 1, MAX_FRETS)) errs.push(`frets not 1–${MAX_FRETS}`);
  if (!Array.isArray(x.strings) || x.strings.length < 1 || x.strings.length > MAX_STRINGS){
    errs.push(`strings not 1–${MAX_STRINGS}`);
  } else {
    x.strings.forEach((s, i) => {
      if (!s || !isInt(s.open, 0, 127)) errs.push(`string ${i + 1}: pitch not 0–127`);
      else if (!isInt(s.start, 0, isInt(x.frets, 1, MAX_FRETS) ? x.frets - 1 : MAX_FRETS - 1)){
        errs.push(`string ${i + 1}: first fret out of range`);
      }
    });
  }
  if (typeof x.leftHanded !== "boolean") errs.push("leftHanded not true/false");
  errs.push(...viewErrors(x.view));
  for (const k of ["created", "updated"]){
    if (!Number.isFinite(x[k])) errs.push(`${k} missing`);
  }
  return errs;
}

/* The pitch at a position, or null if that string can't be played there. */
export function pitchAt(inst, string, fret){
  const s = inst.strings[string];
  if (!s || !Number.isInteger(fret) || fret < s.start || fret > inst.frets) return null;
  return s.open + fret - s.start;
}

/* The number a player calls a string. Players count from the floor side: a
   guitar's high E is string 1 and its low E string 6. `index` is physical
   order, face side first, so the two run in opposite directions. */
export const stringNumber = (index, count) => count - index;

/* "E2 A2 D3 G3 B3 E4 · 22 frets". */
export function summary(inst, pref = "sharp"){
  const tuning = inst.strings.map(s => pitchName(s.open, pref)).join(" ");
  return `${tuning} · ${inst.frets} fret${inst.frets === 1 ? "" : "s"}`;
}
