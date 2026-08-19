/**
 * Copies the Sveltia CMS bundle out of node_modules into public/admin/.
 *
 * Vendored rather than loaded from a CDN: this script handles a GitHub token
 * with write access to the repository, so it should not be fetched from a
 * third party at runtime. Runs automatically via `prebuild`, and the copy is
 * gitignored so the bundle never bloats the repo.
 */
import { copyFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';

/* The package does not export ./package.json, so resolve by path. */
const src = path.resolve('node_modules/@sveltia/cms/dist/sveltia-cms.js');
try {
  await access(src);
} catch {
  console.error(`Cannot find ${src} — run \`npm install\` first.`);
  process.exit(1);
}
const destDir = path.resolve('public/admin');
const dest = path.join(destDir, 'sveltia-cms.js');

await mkdir(destDir, { recursive: true });
await copyFile(src, dest);
console.log(`admin bundle synced → ${path.relative(process.cwd(), dest)}`);
