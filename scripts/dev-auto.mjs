/**
 * Dev server that restarts itself when content is added or removed.
 *
 * Why this exists: Astro's glob loader fixes its file list when the dev
 * server boots and never rescans. Editing an existing entry hot-reloads
 * normally, but a NEW entry stays invisible until a restart — which is
 * exactly what happens every time you add a review in /admin's local mode.
 *
 * So: watch the content directory, and when the set of files changes,
 * restart the server. Edits are left alone, because Astro already handles
 * those and a restart would only make them slower.
 *
 * This is a local-development convenience. In production the CMS commits to
 * GitHub and every deploy is a clean build, so none of it is needed there.
 */
import { spawn, execFileSync } from 'node:child_process';
import { watch, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const CONTENT_DIR = path.resolve('src/content');
const DEBOUNCE_MS = 250;
const passthrough = process.argv.slice(2);

/** Every content file currently on disk, as a sorted, comparable string. */
function snapshot(dir = CONTENT_DIR, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) snapshot(full, acc);
    else if (/\.(mdx?|json|ya?ml)$/i.test(name)) acc.push(full);
  }
  return acc.sort().join('\n');
}

let child = null;
let known = snapshot();
let restarting = false;
let timer = null;

/** Release Astro's lock, and stop a server whether it is ours or a daemon. */
function stopServer() {
  try {
    execFileSync('npx', ['astro', 'dev', 'stop'], { stdio: 'ignore', timeout: 20000 });
  } catch {
    /* nothing was running */
  }
  if (child && !child.killed) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

function start() {
  stopServer();
  child = spawn('npx', ['astro', 'dev', ...passthrough], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => {
    if (restarting) return;
    // Some environments run the dev server as a background daemon, in which
    // case the CLI returns 0 immediately. Keep watching rather than quitting.
    if (code === 0) return;
    process.exit(code ?? 0);
  });
}

function restart(reason) {
  if (restarting) return;
  restarting = true;
  console.log(`\n\x1b[33m▲\x1b[0m  ${reason} — restarting so the loader picks it up\n`);
  stopServer();
  child = null;
  setTimeout(() => {
    restarting = false;
    start();
  }, 400);
}

function onFsEvent() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    let next;
    try {
      next = snapshot();
    } catch {
      return; // mid-write; the next event will settle it
    }
    if (next === known) return; // a plain edit — Astro hot-reloads it already

    const before = new Set(known.split('\n').filter(Boolean));
    const after = new Set(next.split('\n').filter(Boolean));
    const added = [...after].filter((f) => !before.has(f));
    const removed = [...before].filter((f) => !after.has(f));
    known = next;

    const label = added.length
      ? `New content: ${added.map((f) => path.basename(f)).join(', ')}`
      : `Removed: ${removed.map((f) => path.basename(f)).join(', ')}`;
    restart(label);
  }, DEBOUNCE_MS);
}

watch(CONTENT_DIR, { recursive: true }, onFsEvent);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    restarting = true;
    stopServer();
    process.exit(0);
  });
}

console.log('\x1b[2m   watching src/content for new entries — no manual restart needed\x1b[0m');
start();
