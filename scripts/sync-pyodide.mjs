/**
 * Copies the Pyodide runtime out of node_modules and into public/pyodide.
 *
 * Why this exists rather than a <script src="https://cdn…"> one-liner: the
 * audit forbids loading any subresource from another origin, and that rule is
 * the reason the site has no third-party requests at all. A CDN would be two
 * lines and would break the one guarantee the page makes about itself.
 *
 * Why it copies rather than being committed: these are 11.7 MB of build output
 * belonging to a dependency, and a dependency's build output does not belong in
 * a content repository. public/pyodide is gitignored and rebuilt by `prebuild`,
 * so CI produces it the same way a laptop does.
 *
 * Only the files the browser actually fetches are copied. The package also
 * ships TypeScript definitions, source maps and two demo HTML consoles, none of
 * which a visitor needs and all of which would be served if the folder were
 * copied wholesale.
 */
import { mkdir, copyFile, stat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const SRC = 'node_modules/pyodide';
const DEST = 'public/pyodide';

/**
 * The runtime, and nothing else.
 *
 * `pyodide.asm.wasm` is the interpreter, `python_stdlib.zip` the standard
 * library, `pyodide.asm.mjs` the Emscripten glue and `pyodide.mjs` the loader.
 * `pyodide-lock.json` is consulted by loadPackage; without it, importing any
 * bundled package fails with a message that does not mention the missing file.
 */
const NEEDED = [
  // The classic script, not the ESM build. A dynamic import() of a file in
  // public/ is refused by Vite — "this file is in /public and will be copied
  // as-is during build without going through the plugin transforms" — so the
  // page injects a <script> tag instead, and this is the file it points at.
  // It sets globalThis.loadPyodide and needs no bundler.
  'pyodide.js',
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];

const exists = async (p) => {
  try { await stat(p); return true; } catch { return false; }
};

if (!(await exists(SRC))) {
  console.error(
    `✗ ${SRC} is missing. Run \`npm install\` — the code workshop cannot run ` +
    `Python without it, and the page will say so rather than failing silently.`
  );
  process.exit(1);
}

// Rebuild the folder rather than merging into it, so a Pyodide upgrade cannot
// leave a stale asm.wasm beside a new loader that expects a different one.
if (await exists(DEST)) await rm(DEST, { recursive: true });
await mkdir(DEST, { recursive: true });

let bytes = 0;
const missing = [];
for (const name of NEEDED) {
  const from = path.join(SRC, name);
  if (!(await exists(from))) { missing.push(name); continue; }
  await copyFile(from, path.join(DEST, name));
  bytes += (await stat(from)).size;
}

if (missing.length) {
  console.error(
    `✗ pyodide is installed but missing ${missing.join(', ')}. The package ` +
    `layout has changed; update NEEDED in this script.`
  );
  process.exit(1);
}

const files = await readdir(DEST);
console.log(
  `✓ Pyodide ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB → ${DEST} ` +
  `(same-origin, so the self-hosting audit still passes)`
);
