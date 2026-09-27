import { test } from "node:test";
import assert from "node:assert/strict";
import { where } from "../practice.js";
import { newInstrument } from "../instrument.js";
import { parsePitch } from "../theory.js";

test("positions in words: string number as players count, and open", () => {
  const g = newInstrument();
  assert.equal(where(g, { string: 0, fret: 3 }), "string 6, fret 3");
  assert.equal(where(g, { string: 5, fret: 0 }), "string 1, open");
  // A banjo's short string is open at its own nut, fret 5.
  const banjo = newInstrument({ strings: [{ open: parsePitch("G4"), start: 5 }, { open: parsePitch("D3"), start: 0 }] });
  assert.equal(where(banjo, { string: 0, fret: 5 }), "string 2, open");
  assert.equal(where(banjo, { string: 0, fret: 7 }), "string 2, fret 7");
});
