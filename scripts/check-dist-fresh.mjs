/**
 * Refuses to deploy a stale build.
 *
 * `wrangler deploy` uploads whatever is sitting in ./dist. It does not build,
 * and it cannot tell that the directory predates the content it is supposed to
 * be serving — so running it directly after a `git pull` ships the *previous*
 * site, silently and successfully. That is exactly what happened once: a plate
 * added through /admin was pulled, deployed, and still did not appear, because
 * the deploy uploaded a dist built before the pull.
 *
 * `npm run deploy` builds first and is safe. This guard exists for every other
 * path to the same command.
 */
import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';

const WATCH = ['src', 'public', 'astro.config.mjs', 'package.json'];
const SKIP = new Set(['node_modules', '.git', 'dist', '.astro']);

async function newest(target) {
  const info = await stat(target).catch(() => null);
  if (!info) return 0;
  if (info.isFile()) return info.mtimeMs;
  let latest = info.mtimeMs;
  for (const name of await readdir(target)) {
    if (SKIP.has(name)) continue;
    latest = Math.max(latest, await newest(path.join(target, name)));
  }
  return latest;
}

const built = await stat('dist/index.html').catch(() => null);
if (!built) {
  console.error('✗ no dist/index.html — run `npm run build` before deploying.');
  process.exit(1);
}

const sources = Math.max(...(await Promise.all(WATCH.map(newest))));
if (sources > built.mtimeMs) {
  const behind = Math.round((sources - built.mtimeMs) / 1000);
  console.error(
    `✗ dist is ${behind}s older than the newest source file.\n` +
    `  Deploying it would ship the previous version of the site.\n` +
    `  Run \`npm run deploy\`, which builds first.`
  );
  process.exit(1);
}
console.log('✓ dist is newer than every source file');
