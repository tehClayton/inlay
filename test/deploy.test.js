/* The service worker is cache-first, so a file the app loads but sw.js does
   not list works online and fails only offline, on an installed app, where it
   is least likely to be noticed and hardest to diagnose. These tests read the
   deployed files as text and check the list is complete. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = f => readFileSync(join(ROOT, f), "utf8");

const sw = read("sw.js");
const ASSETS = (() => {
  const body = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
  assert.ok(body, "sw.js declares const ASSETS = [...]");
  return [...body[1].matchAll(/"\.\/([^"]*)"/g)].map(m => m[1]).filter(Boolean);
})();

/* Relative files a page or module pulls in: src/href attributes and ES module
   imports. External links, fragments and mailto are not ours to cache. */
function localRefs(text){
  const refs = [
    ...[...text.matchAll(/\b(?:src|href)="([^"]+)"/g)].map(m => m[1]),
    ...[...text.matchAll(/\bfrom\s+"([^"]+)"/g)].map(m => m[1]),
    ...[...text.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)].map(m => m[1]),
  ];
  return refs
    .filter(r => !/^(?:[a-z]+:|#|\/\/)/i.test(r))
    .map(r => r.replace(/^\.\//, ""));
}

test("VERSION is a v-number", () => {
  assert.match(sw, /const VERSION = "v\d+";/);
});

test("every cached asset exists", () => {
  for (const f of ASSETS) assert.ok(existsSync(join(ROOT, f)), `${f} is in ASSETS but missing`);
});

test("every file a page or module loads is cached", () => {
  const pages = ASSETS.filter(f => /\.(html|js)$/.test(f));
  for (const page of pages){
    for (const ref of localRefs(read(page))){
      assert.ok(ASSETS.includes(ref), `${page} loads ${ref}, which sw.js does not cache`);
    }
  }
});

test("the manifest's icons are cached", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  for (const icon of manifest.icons){
    const f = icon.src.replace(/^\.\//, "");
    assert.ok(ASSETS.includes(f), `manifest icon ${f} is not cached`);
  }
});

test("every cached module parses", async () => {
  for (const f of ASSETS.filter(f => f.endsWith(".js"))){
    await import(join(ROOT, f));
  }
});
