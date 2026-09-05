/**
 * Copies the emception C/C++ toolchain out of node_modules and into
 * public/emception, so clang runs from this origin like everything else.
 *
 * Two things happen on the way, and both are load-bearing.
 *
 * 1. Every `*.tar.br` is renamed to `*.tar.bin`. The packs are raw Brotli that the
 *    toolchain decompresses itself and hash-checks *before* decompressing. A
 *    static server that sees a `.br` extension advertises
 *    `Content-Encoding: br`, so the browser helpfully decompresses it in
 *    transit and the loader hashes the wrong bytes: it asks for 2.6 MB of
 *    compressed python and is handed 11.5 MB of tar, then fails with
 *    "Bundle hash mismatch". Renaming is the only fix that holds across both
 *    the dev server and the deployed Worker, because it stops any of them
 *    from guessing.
 *
 * 2. The manifest's bundle URLs are rewritten to match, and each one keeps a
 *    `#.br` fragment. The loader decides whether to Brotli-decompress a pack
 *    by testing `bundle.url.endsWith('.br')`, so renaming the file alone makes
 *    it skip decompression and try to read a compressed blob as a tar — the
 *    hash check still passes, because that runs on the compressed bytes, and
 *    the failure surfaces much later as "clang.wasm not found in IDB". A
 *    fragment is never sent to the server, so the request is still for a
 *    plain `.bin` while the loader sees a URL that ends in `.br`.
 *
 *    The URLs are baked as `/cdn/...`; the loader strips that prefix and
 *    rebases onto whatever directory the manifest was fetched from, which is
 *    what makes serving the payload from our own path work unpatched.
 *
 * Like public/pyodide this is a dependency's build output, so it is gitignored
 * and rebuilt by `prebuild` rather than committed.
 */
import { mkdir, copyFile, readFile, writeFile, stat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const SRC = 'node_modules/emception/cdn';
const DEST = 'public/emception';

const exists = async (p) => {
  try { await stat(p); return true; } catch { return false; }
};

if (!(await exists(SRC))) {
  console.error(
    `✗ ${SRC} is missing. Run \`npm install\` — /officina cannot compile C or ` +
    `C++ without it, and the page will say so rather than failing silently.`
  );
  process.exit(1);
}

// Rebuilt rather than merged into, so an upgrade cannot leave a stale pack
// beside a manifest that expects a different hash.
if (await exists(DEST)) await rm(DEST, { recursive: true });

let files = 0;
let bytes = 0;

/** Copy a directory tree, renaming Brotli packs as it goes. */
async function walk(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    if (entry.isDirectory()) {
      await walk(src, path.join(to, entry.name));
      continue;
    }
    // `brotli_wasm.wasm` is the decompressor, not a pack; only `.tar.br` moves.
    const name = entry.name.endsWith('.tar.br')
      ? `${entry.name.slice(0, -'.tar.br'.length)}.tar.bin`
      : entry.name;
    const dst = path.join(to, name);
    await copyFile(src, dst);
    bytes += (await stat(src)).size;
    files += 1;
  }
}
await walk(SRC, DEST);

// Point the manifest at the renamed packs.
const manifestPath = path.join(DEST, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
let rewritten = 0;
for (const bundle of Object.values(manifest.bundles ?? {})) {
  if (typeof bundle.url === 'string' && bundle.url.endsWith('.tar.br')) {
    bundle.url = `${bundle.url.slice(0, -'.tar.br'.length)}.tar.bin#.br`;
    rewritten += 1;
  }
}
if (!rewritten) {
  console.error(
    `✗ no bundle URLs ended in .tar.br. The payload's layout has changed; ` +
    `this ` +
    `script would ship a manifest pointing at files that are not there.`
  );
  process.exit(1);
}
await writeFile(manifestPath, JSON.stringify(manifest));

console.log(
  `✓ emception ${files} files, ${(bytes / 1048576).toFixed(0)} MB → ${DEST} ` +
  `(${rewritten} packs renamed so nothing serves them as Content-Encoding: br)`
);
