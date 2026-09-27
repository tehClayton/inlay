import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidates, makePrompt, promptText, isRight, createScore, scoreText, DRILL_KINDS, SLOW_MS,
  answerName, usesNotes, ALL_INTERVALS, findsAll, needed, naming, DEGREE_LABELS, answerLabel, hasRoot,
} from "../drills.js";
import { newInstrument } from "../instrument.js";
import { parsePitch, noteName } from "../theory.js";

const guitar = () => newInstrument();
const P = parsePitch;

/* A repeatable stand-in for Math.random. */
function seeded(seed = 1){
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

test("candidates are the playable positions in the window", () => {
  const c = candidates(guitar(), [5, 9]);
  assert.equal(c.length, 6 * 5);
  assert.ok(c.every(p => p.fret >= 5 && p.fret <= 9));
  const a5 = c.find(p => p.string === 0 && p.fret === 5);
  assert.equal(a5.midi, P("A2"));
  assert.equal(a5.pc, 9);
});

test("the window includes the open strings when it starts at the nut", () => {
  const c = candidates(guitar(), [0, 3]);
  assert.ok(c.some(p => p.fret === 0));
});

test("filters: strings and naturals", () => {
  const c = candidates(guitar(), [0, 12], { strings: [0, 5], notes: "naturals" });
  assert.ok(c.every(p => p.string === 0 || p.string === 5));
  assert.ok(c.every(p => [0, 2, 4, 5, 7, 9, 11].includes(p.pc)));
  assert.equal(c.filter(p => p.string === 0).length, 8);   // E F G A B C D E, frets 0–12
});

test("a banjo's short string only offers positions from its nut up", () => {
  const banjo = newInstrument({ strings: [
    { open: P("G4"), start: 5 }, { open: P("D3"), start: 0 },
  ]});
  const c = candidates(banjo, [0, 7]);
  assert.deepEqual(c.filter(p => p.string === 0).map(p => p.fret), [5, 6, 7]);
  assert.equal(c.find(p => p.string === 0 && p.fret === 5).midi, P("G4"));
});

test("every kind of prompt's targets answer it", () => {
  const c = candidates(guitar(), [0, 12]), rng = seeded(7);
  for (const kind of DRILL_KINDS){
    for (let i = 0; i < 50; i++){
      const p = makePrompt(kind, c, { rng });
      assert.ok(p.targets.length >= 1, kind);
      for (const t of p.targets){
        // A chord's targets are any of its notes; every other drill's, one.
        if (kind === "chord" || kind === "scale") assert.ok(p.tones.includes(t.pc), kind);
        else assert.equal(t.pc, p.pc, kind);
        if (kind === "name") assert.ok(isRight(p, t.midi));
        else if (kind === "nameInterval") assert.ok(isRight(p, p.degree));
        else assert.ok(isRight(p, t), `${kind} target should be right`);
      }
    }
  }
});

test("interval: the exact pitch above the root, everywhere it can be played in view", () => {
  const c = candidates(guitar(), [0, 12]), rng = seeded(3);
  for (let i = 0; i < 200; i++){
    const p = makePrompt("interval", c, { rng });
    const root = c.find(x => x.string === p.root.string && x.fret === p.root.fret);
    assert.ok(ALL_INTERVALS.includes(p.semis));
    assert.equal(p.rootPc, root.pc);
    assert.ok(p.targets.length >= 1);
    // Every target is that very pitch — no other octave — and every place
    // in view that plays it is a target.
    assert.ok(p.targets.every(t => t.midi === root.midi + p.semis));
    assert.equal(p.targets.length, c.filter(x => x.midi === root.midi + p.semis).length);
  }
});

test("interval: another octave of the right note is wrong", () => {
  const c = candidates(guitar(), [0, 12]), rng = seeded(5);
  for (let i = 0; i < 100; i++){
    const p = makePrompt("interval", c, { rng });
    const want = p.targets[0].midi;
    for (const x of c.filter(x => x.pc === p.pc && x.midi !== want)) assert.ok(!isRight(p, x));
  }
});

test("interval: only the intervals chosen, each as often as the others", () => {
  const c = candidates(guitar(), [0, 12]), rng = seeded(9);
  const seen = {};
  for (let i = 0; i < 3000; i++){
    const p = makePrompt("interval", c, { rng, intervals: [3, 7, 12] });
    seen[p.semis] = (seen[p.semis] ?? 0) + 1;
  }
  assert.deepEqual(Object.keys(seen).map(Number).sort((a, b) => a - b), [3, 7, 12]);
  for (const n of Object.values(seen)) assert.ok(n > 850 && n < 1150, `${n} of 3000`);
});

test("interval: nothing to ask when no interval fits in view", () => {
  // One string, three frets: nothing is an octave away.
  const c = candidates(guitar(), [1, 3], { strings: [0] });
  assert.equal(makePrompt("interval", c, { intervals: [12] }), null);
  assert.ok(makePrompt("interval", c, { intervals: [12, 1] }));
});

test("interval: the prompt and its answer, spelled from the root", () => {
  // Frets 0–4 on the A string alone: a major 3rd above open A is C♯ at 4.
  const c = candidates(guitar(), [0, 4], { strings: [1] });
  const p = makePrompt("interval", c, { intervals: [4] });
  assert.equal(p.root.fret, 0);
  assert.deepEqual(p.targets.map(t => t.fret), [4]);
  assert.equal(promptText(p, guitar(), "flat"), "Major 3rd above A");
  assert.equal(answerName(p, "flat"), "C♯");             // not D♭: it's a 3rd
  assert.equal(answerName({ kind: "findAny", pc: 1 }, "flat"), "D♭");
});

test("the naturals filter is the note drills' alone", () => {
  assert.ok(usesNotes("findAny") && usesNotes("name"));
  assert.ok(!usesNotes("interval") && !usesNotes("chord"));
});

test("chord: every place in view that plays one of its notes, and nothing else", () => {
  const c = candidates(guitar(), [0, 5]), rng = seeded(4);
  for (let i = 0; i < 200; i++){
    const p = makePrompt("chord", c, { rng, chords: ["major", "minor", "dom7", "dim7"] });
    assert.deepEqual(p.targets, c.filter(x => p.tones.includes(x.pc)));
    for (const x of c.filter(x => !p.tones.includes(x.pc))) assert.ok(!isRight(p, x));
    assert.ok(findsAll("chord"));
  }
});

test("chord: only the types chosen, each as often as the others; the root random or fixed", () => {
  const c = candidates(guitar(), [0, 12]), rng = seeded(8);
  const types = {}, roots = new Set();
  for (let i = 0; i < 3000; i++){
    const p = makePrompt("chord", c, { rng, chords: ["minor", "maj7"] });
    types[p.type] = (types[p.type] ?? 0) + 1;
    roots.add(p.rootPc);
  }
  assert.deepEqual(Object.keys(types).sort(), ["maj7", "minor"]);
  for (const n of Object.values(types)) assert.ok(n > 1350 && n < 1650, `${n} of 3000`);
  assert.equal(roots.size, 12);
  for (let i = 0; i < 50; i++) assert.equal(makePrompt("chord", c, { rng, root: 9 }).rootPc, 9);
});

test("chord: only chords whose every note is in view", () => {
  // Frets 0–2 on the low E string: E F F♯. No chord's notes are all here.
  const c = candidates(guitar(), [0, 2], { strings: [0] });
  assert.equal(makePrompt("chord", c, { chords: ["major", "minor"] }), null);
  // Frets 0–4 on the A string and 0–2 on the D: A B♭ B C C♯, D E♭ E — A major fits.
  const d = candidates(guitar(), [0, 4], { strings: [1, 2] });
  const p = makePrompt("chord", d, { chords: ["major"], root: 9 });
  assert.equal(p.rootPc, 9);
  assert.ok(p.tones.every(pc => d.some(x => x.pc === pc)));
});

test("chord: named and spelled for the chord", () => {
  const c = candidates(guitar(), [0, 12]);
  const p = makePrompt("chord", c, { chords: ["major"], root: 9 });
  assert.equal(promptText(p, guitar(), "flat"), "A major");
  assert.equal(promptText(p, guitar(), "flat", 3), `A major · 3 of ${p.targets.length}`);
  assert.equal(answerName(p, "flat", 1), "C♯");         // its 3rd, not D♭
  const q = makePrompt("chord", c, { chords: ["dim7"], root: 0 });
  assert.equal(answerName(q, "sharp", 9), "B♭♭");       // C dim7's 7th
  // D♭ F A♭ has fewer accidentals than C♯ E♯ G♯, whatever the preference.
  const r = makePrompt("chord", c, { chords: ["major"], root: 1 });
  assert.equal(promptText(r, guitar(), "sharp"), "D♭ major");
});

test("scale, any order: every place in view that plays one of its notes", () => {
  const c = candidates(guitar(), [5, 9]), rng = seeded(6);
  for (let i = 0; i < 100; i++){
    const p = makePrompt("scale", c, { rng });
    assert.equal(p.order, "any");
    assert.deepEqual(p.targets, c.filter(x => p.tones.includes(x.pc)));
    assert.equal(needed(p), p.targets.length);
    assert.ok(["major", "minor", "minorPentatonic"].includes(p.type));
    assert.ok(findsAll("scale") && !usesNotes("scale"));
  }
});

test("scale going up: each pitch in view once, lowest first; any place playing it counts", () => {
  const c = candidates(guitar(), [5, 9]);
  const p = makePrompt("scale", c, { scales: ["major"], root: 0, order: "up" });   // C major
  assert.equal(p.order, "up");
  const pitches = [...new Set(p.targets.map(t => t.midi))].sort((a, b) => a - b);
  assert.deepEqual(p.steps, pitches);
  assert.equal(needed(p), pitches.length);
  // Walk it: at each step, every place playing that pitch is right, and
  // every other scale note is wrong until its turn.
  const found = [];
  for (const midi of p.steps){
    const here = p.targets.filter(t => t.midi === midi);
    for (const t of here) assert.ok(isRight(p, t, found));
    for (const t of p.targets.filter(t => t.midi !== midi)) assert.ok(!isRight(p, t, found));
    found.push(here[here.length - 1]);
  }
});

test("scale going up: the prompt says so, and counts steps", () => {
  const c = candidates(guitar(), [5, 9]);
  const p = makePrompt("scale", c, { scales: ["dorian"], root: 2, order: "up" });
  assert.equal(promptText(p, guitar(), "sharp"), "D dorian, going up");
  assert.equal(promptText(p, guitar(), "sharp", 2), `D dorian, going up · 2 of ${p.steps.length}`);
  const q = makePrompt("scale", c, { scales: ["dorian"], root: 2 });
  assert.equal(promptText(q, guitar(), "sharp"), "D dorian");
});

test("scale: spelled for the key", () => {
  const c = candidates(guitar(), [0, 12]);
  const p = makePrompt("scale", c, { scales: ["major"], root: 5 });            // F major
  assert.equal(answerName(p, "sharp", 10), "B♭");
  const q = makePrompt("scale", c, { scales: ["harmonicMinor"], root: 4 });    // E harmonic minor
  assert.equal(answerName(q, "flat", 3), "D♯");
});

test("scale: only the types chosen, and only when every note is in view", () => {
  const c = candidates(guitar(), [0, 12]), rng = seeded(2);
  for (let i = 0; i < 100; i++) assert.equal(makePrompt("scale", c, { rng, scales: ["blues"] }).type, "blues");
  // One string, frets 0–4: five notes, too few for a seven-note scale.
  const d = candidates(guitar(), [0, 4], { strings: [0] });
  assert.equal(makePrompt("scale", d, { scales: ["major"] }), null);
});

test("name the interval: a root and another place, above or below it, named as its degree", () => {
  const c = candidates(guitar(), [0, 5]), rng = seeded(11);
  for (let i = 0; i < 200; i++){
    const p = makePrompt("nameInterval", c, { rng });
    const r = c.find(x => x.string === p.root.string && x.fret === p.root.fret);
    const t = c.find(x => x.string === p.pos.string && x.fret === p.pos.fret);
    assert.ok(r && t, "both places are in view");
    assert.ok(r !== t, "never the root itself");
    // Counted by pitch class, in any octave: below the root is still "above".
    assert.equal(p.degree, ((t.midi - r.midi) % 12 + 12) % 12);
    assert.ok(isRight(p, p.degree));
    for (let d = 0; d < 12; d++) if (d !== p.degree) assert.ok(!isRight(p, d));
  }
  assert.ok(naming("nameInterval") && naming("name") && !naming("findAny"));
  assert.ok(!usesNotes("nameInterval"));
});

test("name the interval: every degree comes up about as often; a fixed root holds", () => {
  const c = candidates(guitar(), [0, 5]), rng = seeded(12);
  const seen = new Array(12).fill(0);
  for (let i = 0; i < 6000; i++) seen[makePrompt("nameInterval", c, { rng }).degree]++;
  for (const n of seen) assert.ok(n > 400 && n < 600, `${n} of 6000`);
  for (let i = 0; i < 50; i++) assert.equal(makePrompt("nameInterval", c, { rng, root: 9 }).rootPc, 9);
});

test("name the interval: the degree labels, the prompt and the answer", () => {
  assert.deepEqual([...DEGREE_LABELS], ["1", "♭2", "2", "♭3", "3", "4", "♯4/♭5", "5", "♭6", "6", "♭7", "7"]);
  // The A string alone, frets 0–3: from open A, fret 3 (C) is a ♭3.
  const c = candidates(guitar(), [0, 3], { strings: [1] });
  const p = makePrompt("nameInterval", c, { root: 9, rng: () => 0.99 });
  assert.equal(promptText(p, guitar(), "sharp"), "What degree of A?");
  assert.equal(answerName(p, "sharp"), DEGREE_LABELS[p.degree]);
  assert.equal(makePrompt("nameInterval", candidates(guitar(), [0, 0], { strings: [0] })), null);
});

test("scale-degree labels: a theory drill's notes by degree of its root, others by name", () => {
  const c = candidates(guitar(), [0, 12]);
  const chord = makePrompt("chord", c, { chords: ["major"], root: 9 });          // A major
  assert.equal(answerLabel(chord, "sharp", 1), "C♯");
  assert.equal(answerLabel(chord, "sharp", 1, "names"), "C♯");
  assert.equal(answerLabel(chord, "sharp", 1, "degrees"), "3");
  assert.equal(answerLabel(chord, "sharp", 9, "degrees"), "1");
  const scale = makePrompt("scale", c, { scales: ["dorian"], root: 2 });         // D dorian
  assert.equal(answerLabel(scale, "sharp", 5, "degrees"), "♭3");
  const iv = makePrompt("interval", c, { intervals: [7] });
  assert.equal(answerLabel(iv, "sharp", iv.pc, "degrees"), "5");
  // No root, no degrees: the note drills keep their names.
  const any = makePrompt("findAny", c);
  assert.equal(answerLabel(any, "flat", any.pc, "degrees"), noteName(any.pc, "flat"));
  assert.ok(hasRoot("chord") && hasRoot("interval") && !hasRoot("findAll"));
});

test("find on a string: the note on that string only, both octaves in view", () => {
  const c = candidates(guitar(), [0, 12]);
  // Low E string, frets 0–12: E at 0 and 12.
  const rng = () => 0;                          // picks the first candidate: string 0, fret 0
  const p = makePrompt("findOn", c, { rng });
  assert.equal(p.string, 0);
  assert.deepEqual(p.targets.map(t => t.fret), [0, 12]);
  assert.ok(p.targets.every(t => t.string === 0));
  assert.equal(isRight(p, { string: 5, fret: 0 }), false);   // high E is an E, but the wrong string
});

test("find all: every position of the note in view", () => {
  const c = candidates(guitar(), [0, 5]);
  const p = { ...makePrompt("findAll", c, { rng: seeded(3) }) };
  const expected = c.filter(x => x.pc === p.pc).length;
  assert.equal(p.targets.length, expected);
});

test("find all on the neck: given the whole neck, every position of the note", () => {
  const g = guitar();
  const whole = candidates(g, [0, g.frets]);
  const p = makePrompt("findAllNeck", whole, { rng: seeded(9) });
  // 23 positions a string (open to 22) is about two of each note per string:
  // 11 or 12 across six strings.
  assert.ok(p.targets.length === 11 || p.targets.length === 12, `${p.targets.length}`);
  assert.equal(p.targets.length, whole.filter(c => c.pc === p.pc).length);
  assert.ok(p.targets.some(t => t.fret > 12));
});

test("find any and find all choose notes evenly, not by how often they appear", () => {
  const c = candidates(guitar(), [0, 12]);
  const rng = seeded(11), counts = new Map();
  for (let i = 0; i < 6000; i++){
    const p = makePrompt("findAny", c, { rng });
    counts.set(p.pc, (counts.get(p.pc) ?? 0) + 1);
  }
  assert.equal(counts.size, 12);
  for (const n of counts.values()) assert.ok(n > 380 && n < 620, `${n}`);   // ~500 each
});

test("the same prompt never comes twice running when there's a choice", () => {
  const c = candidates(guitar(), [0, 5]), rng = seeded(5);
  for (const kind of DRILL_KINDS){
    let last = null;
    for (let i = 0; i < 200; i++){
      const p = makePrompt(kind, c, { rng, last });
      if (last) assert.notEqual(p.key, last.key, kind);
      last = p;
    }
  }
  // With only one thing to ask, it's asked again rather than not at all.
  const one = [{ string: 0, fret: 3, midi: 43, pc: 7 }];
  const p = makePrompt("name", one, { rng });
  assert.equal(makePrompt("name", one, { rng, last: p }).key, p.key);
});

test("nothing to ask gives no prompt", () => {
  assert.equal(makePrompt("findAny", []), null);
});

test("prompt text", () => {
  const g = guitar();
  assert.equal(promptText({ kind: "findAny", pc: 6 }, g, "sharp"), "F♯");
  assert.equal(promptText({ kind: "findAll", pc: 6 }, g, "flat"), "Every G♭");
  const neck = { kind: "findAllNeck", pc: 6, targets: new Array(8) };
  assert.equal(promptText(neck, g, "sharp"), "Every F♯ on the neck");
  assert.equal(promptText(neck, g, "sharp", 3), "Every F♯ on the neck · 3 of 8");
  assert.equal(promptText({ kind: "findOn", pc: 6, string: 1 }, g, "sharp"), "F♯ on string 5 (A)");
  // A guitar's two E strings are told apart by number.
  assert.equal(promptText({ kind: "findOn", pc: 0, string: 5 }, g, "sharp"), "C on string 1 (E)");
  assert.equal(promptText({ kind: "name", pc: 0 }, g, "sharp"), "Name this note");
});

test("naming is right by pitch class, whatever the spelling", () => {
  const p = { kind: "name", pc: 1, targets: [] };
  assert.ok(isRight(p, 1));
  assert.ok(isRight(p, 13));            // any octave
  assert.ok(!isRight(p, 2));
});

test("the score: accuracy over everything, typical time over right answers", () => {
  const s = createScore();
  assert.equal(scoreText(s), "");
  s.add(true, 1000);
  s.add(true, 4000);
  s.add(false, 500);
  s.add(true, SLOW_MS + 1);             // right, but too slow to time
  assert.equal(s.answers, 4);
  assert.equal(s.accuracy, 0.75);
  assert.ok(Math.abs(s.typicalMs - 2000) < 1e-9);   // geometric mean of 1s and 4s
  assert.equal(scoreText(s), "75% · 2.0s · 4");
  const misses = createScore();
  misses.add(false, 800);
  assert.equal(scoreText(misses), "0% · 1");
});

test("note names in prompts follow the preference", () => {
  assert.equal(noteName(10, "both"), "A♯/B♭");
});
