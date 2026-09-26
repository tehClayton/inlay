/* The service worker is cache-first, so a file the app loads but sw.js does
   not list works online and fails only offline, on an installed app, where it
   is least likely to be noticed and hardest to diagnose. These tests read the
   deployed files as text and check the list is complete. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

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

/* Catches a module added at the root before any page imports it, which the
   check above cannot see. sw.js is the worker itself, not an asset. */
test("every app module at the root is cached", () => {
  const modules = readdirSync(ROOT).filter(f => f.endsWith(".js") && f !== "sw.js");
  for (const f of modules) assert.ok(ASSETS.includes(f), `${f} is not in sw.js ASSETS`);
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

/* A page's own logic lives in an inline module script, which nothing else
   parses before a browser does. Each one is written out with its relative
   imports made absolute and loaded here. It then fails at run time, reaching
   for `document`, and that is fine: only a SyntaxError means the code itself
   is broken. */
test("every page's inline module script parses", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inlay-"));
  try {
    for (const page of ASSETS.filter(f => f.endsWith(".html"))){
      const scripts = [...read(page).matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
      for (const [i, [, code]] of scripts.entries()){
        const file = join(dir, `${page}.${i}.mjs`);
        writeFileSync(file, code.replace(/from\s+"\.\/([^"]+)"/g,
          (_, f) => `from "${pathToFileURL(join(ROOT, f)).href}"`));
        await import(pathToFileURL(file).href).catch(e => {
          if (e instanceof SyntaxError) throw new Error(`${page} inline script ${i}: ${e.message}`);
        });
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
