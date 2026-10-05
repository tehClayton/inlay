/* Study mode: an unscored way to explore the neck, like millitap's listen
   mode. Tap frets to label them, label every one, or mark a scale or chord
   across the neck; by note name, or by interval from a root you choose.
   Nothing is recorded. Pure: the page draws what this says.

   A study is { show, labels, root, picked, set }:
     show    "tapped" — the frets you've tapped; "all" — every one;
             "set" — every place that plays a note of `set` over the root
     labels  "notes" — note names; "degrees" — intervals from the root
     root    a pitch class, or null; degrees and sets need one, and without
             it degrees fall back to names and a set shows nothing
     picked  the tapped positions, as "string:fret" keys
     set     which scale or chord: "scale:dorian", "chord:dom7" */
import { pitchAt } from "./instrument.js";
import { noteName, pitchClass, degreeName, SCALES, CHORDS, tones, spell } from "./theory.js";

export const newStudy = () => ({ show: "tapped", labels: "notes", root: null, picked: new Set(), set: "scale:major" });

const LIBRARY = { scale: SCALES, chord: CHORDS };

/* The scale or chord a study's `set` names: { kind, id, name, formula }. */
export function studySet(ref){
  const [kind, id] = ref.split(":");
  const entry = LIBRARY[kind]?.[id];
  return entry ? { kind, id, ...entry } : null;
}

const key = pos => `${pos.string}:${pos.fret}`;
const byDegree = s => s.labels === "degrees" && s.root != null;
const showingSet = s => s.show === "set" && s.root != null && studySet(s.set);

/* What a position says, and how it's drawn: the root stands out, and every
   other label is quieter when the whole neck is labelled, so a board full
   of them still reads. A scale or chord's notes are spelled for it, so F
   major shows B♭ whatever the preference. Null off the neck. */
export function studyLabel(inst, pos, study, pref = "sharp"){
  const midi = pitchAt(inst, pos.string, pos.fret);
  if (midi == null) return null;
  const pc = pitchClass(midi);
  const kind = study.root != null && pc === study.root ? "root" : (study.show === "all" ? "label" : "note");
  let text;
  if (byDegree(study)) text = degreeName(pc, study.root);
  else if (showingSet(study)){
    const spelled = spell(study.root, studySet(study.set).formula, pref).find(n => n.pc === pc);
    text = spelled ? spelled.name : noteName(pc, pref);
  } else text = noteName(pc, pref);
  return { pos, kind, text };
}

/* Every playable position on the neck. */
function everywhere(inst){
  const out = [];
  inst.strings.forEach((s, string) => {
    for (let fret = s.start; fret <= inst.frets; fret++) out.push({ string, fret });
  });
  return out;
}

const pcAt = (inst, p) => pitchClass(pitchAt(inst, p.string, p.fret));

/* The marks for the board: every position, a scale or chord's, or the
   tapped ones. With a root and only tapped frets, the root's places are
   marked too, so there's always something to count the intervals from. */
export function studyMarks(inst, study, pref = "sharp"){
  let positions;
  if (study.show === "all") positions = everywhere(inst);
  else if (study.show === "set"){
    if (!showingSet(study)) return [];
    const ts = tones(study.root, studySet(study.set).formula);
    positions = everywhere(inst).filter(p => ts.includes(pcAt(inst, p)));
  } else {
    positions = [...study.picked].map(k => { const [string, fret] = k.split(":").map(Number); return { string, fret }; });
    if (study.root != null){
      const roots = everywhere(inst).filter(p => pcAt(inst, p) === study.root);
      positions = [...roots.filter(p => !study.picked.has(key(p))), ...positions];
    }
  }
  return positions.map(p => studyLabel(inst, p, study, pref)).filter(Boolean);
}

/* A tap in study: a tapped fret is labelled, or unlabelled if it already
   was. Returns a new study; with the neck labelled for you — every note,
   or a scale or chord — taps change nothing. */
export function studyTap(study, pos){
  if (study.show !== "tapped") return study;
  const picked = new Set(study.picked);
  if (picked.has(key(pos))) picked.delete(key(pos)); else picked.add(key(pos));
  return { ...study, picked };
}

/* The strip's line for the study: what the board is showing. */
export function studySummary(study, pref = "sharp"){
  if (study.show === "set"){
    const set = studySet(study.set);
    if (study.root == null) return `choose a root for the ${set.name} ${set.kind}`;
    const root = spell(study.root, set.formula, pref)[0].name;
    return `${root} ${set.name}${study.labels === "degrees" ? " · as intervals" : ""}`;
  }
  const what = study.show === "all" ? "every note" : "tap frets to label them";
  if (study.labels !== "degrees") return what;
  return study.root == null ? `${what} · choose a root for intervals`
                            : `${what} · intervals from ${noteName(study.root, pref)}`;
}
