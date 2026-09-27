import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidates, makePrompt, promptText, isRight, createScore, scoreText, DRILL_KINDS, SLOW_MS,
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
        assert.equal(t.pc, p.pc, kind);
        if (kind === "name") assert.ok(isRight(p, t.midi));
        else assert.ok(isRight(p, t), `${kind} target should be right`);
      }
    }
  }
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
