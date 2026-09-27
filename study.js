/* Study mode: an unscored way to explore the neck, like millitap's listen
   mode. Tap frets to label them, or label every one; by note name, or by
   interval from a root you choose. Nothing is recorded. Pure: the page
   draws what this says.

   A study is { show, labels, root, picked }:
     show    "tapped" — the frets you've tapped; "all" — every one
     labels  "notes" — note names; "degrees" — intervals from the root
     root    a pitch class, or null; degrees need one, and fall back to names
     picked  the tapped positions, as "string:fret" keys */
import { pitchAt } from "./instrument.js";
import { noteName, pitchClass, degreeName } from "./theory.js";

export const newStudy = () => ({ show: "tapped", labels: "notes", root: null, picked: new Set() });

const key = pos => `${pos.string}:${pos.fret}`;
const byDegree = s => s.labels === "degrees" && s.root != null;

/* What a position says, and how it's drawn: the root stands out, and every
   other label is quieter when the whole neck is labelled, so a board full
   of them still reads. Null off the neck. */
export function studyLabel(inst, pos, study, pref = "sharp"){
  const midi = pitchAt(inst, pos.string, pos.fret);
  if (midi == null) return null;
  const pc = pitchClass(midi);
  const kind = study.root != null && pc === study.root ? "root" : (study.show === "all" ? "label" : "note");
  return { pos, kind, text: byDegree(study) ? degreeName(pc, study.root) : noteName(pc, pref) };
}

/* Every playable position on the neck. */
function everywhere(inst){
  const out = [];
  inst.strings.forEach((s, string) => {
    for (let fret = s.start; fret <= inst.frets; fret++) out.push({ string, fret });
  });
  return out;
}

/* The marks for the board: every position, or the tapped ones. With a root
   and only tapped frets, the root's places are marked too, so there's
   always something to count the intervals from. */
export function studyMarks(inst, study, pref = "sharp"){
  let positions;
  if (study.show === "all") positions = everywhere(inst);
  else {
    positions = [...study.picked].map(k => { const [string, fret] = k.split(":").map(Number); return { string, fret }; });
    if (study.root != null){
      const roots = everywhere(inst).filter(p => pitchClass(pitchAt(inst, p.string, p.fret)) === study.root);
      positions = [...roots.filter(p => !study.picked.has(key(p))), ...positions];
    }
  }
  return positions.map(p => studyLabel(inst, p, study, pref)).filter(Boolean);
}

/* A tap in study: a tapped fret is labelled, or unlabelled if it already
   was. Returns a new study; with every fret labelled, taps change nothing. */
export function studyTap(study, pos){
  if (study.show === "all") return study;
  const picked = new Set(study.picked);
  if (picked.has(key(pos))) picked.delete(key(pos)); else picked.add(key(pos));
  return { ...study, picked };
}

/* The strip's line for the study: what the board is showing. */
export function studySummary(study, pref = "sharp"){
  const what = study.show === "all" ? "every note" : "tap frets to label them";
  if (study.labels !== "degrees") return what;
  return study.root == null ? `${what} · choose a root for intervals`
                            : `${what} · intervals from ${noteName(study.root, pref)}`;
}
