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

/* How the neck is drawn: a camera looking at a real neck. Rotations are about
   the screen's axes, applied to a neck lying level with its bass edge
   nearest you:

     flip         false: the bass edge (the face-side string, a guitar's low
                  E) at the bottom, as in tab. true: at the top.
     tilt         about x, degrees: the face tips away, bass edge towards you.
                  Strings flatten and close up away from you, the far long
                  edge shortens, and the side of the fretboard comes into view.
     turn         about y, degrees: the headstock end swings away.
     angle        about z, degrees: the neck turned on screen, headstock up.
     perspective  how close the eye is, 0–1: 0 is none (parallel lines stay
                  parallel), 1 is close enough that the far side is clearly
                  smaller. Tilt and turn only look like depth with some.
     edge         how deep the fretboard's side is, 0–1 of a string gap. Tilt
                  is what shows it; with no tilt it is edge-on and unseen.

   Presets are named starting points. Any other combination is "custom". */
export const VIEW_PRESETS = Object.freeze({
  tab:     Object.freeze({ flip: false, tilt: 0,  turn: 0, angle: 0, perspective: 0,    edge: 0.4 }),
  flipped: Object.freeze({ flip: true,  tilt: 0,  turn: 0, angle: 0, perspective: 0,    edge: 0.4 }),
  player:  Object.freeze({ flip: false, tilt: 35, turn: 0, angle: 0, perspective: 0.75, edge: 0.4 }),
});

/* Tilt and turn stop short of 90°, where the fretboard would be edge-on with
   nothing left to tap. Steep settings do make frets small; the editor warns
   when they get too small for a fingertip rather than forbidding them. */
export const VIEW_RANGES = Object.freeze({
  tilt:        [0, 80],
  turn:        [0, 80],
  angle:       [0, 90],
  perspective: [0, 1],
  edge:        [0, 1],
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
   validate() to judge. Earlier shapes, oldest first:
     tabView: true|false   true put the bass edge at the bottom, as tab does
     view: "tab" | "flipped" | "player"   the presets, by name
     view: { flip, squeeze, recession, angle, edge }   effect settings, which
       have no exact camera equivalent: squeeze becomes the player preset's
       tilt and perspective, recession a turn, and angle carries over. */
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
  const v = out.view;
  if (v && typeof v === "object" && "squeeze" in v && !("tilt" in v)){
    const squeezed = v.squeeze < 1, receded = v.recession < 1;
    out = { ...out, view: {
      flip: v.flip,
      tilt: squeezed ? VIEW_PRESETS.player.tilt : 0,
      turn: receded ? 25 : 0,
      angle: v.angle,
      perspective: squeezed || receded ? VIEW_PRESETS.player.perspective : 0,
      edge: VIEW_PRESETS.tab.edge,
    }};
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
