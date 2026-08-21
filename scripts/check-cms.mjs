/**
 * Validates public/admin/config.yml.
 *
 * A broken config means /admin refuses to load at all, and nothing else in
 * the pipeline notices: the site still builds, the audit still passes, the
 * types still check. This is the only thing standing between a stray quote
 * and an editor that will not open.
 */
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const problems = [];
const raw = await readFile('public/admin/config.yml', 'utf8');

let config;
try {
  config = YAML.parse(raw);
} catch (err) {
  console.error(`✗ config.yml is not valid YAML\n  ${err.message}`);
  process.exit(1);
}

for (const key of ['backend', 'media_folder', 'collections']) {
  if (!config[key]) problems.push(`missing top-level "${key}"`);
}

// The editor's site_url is a second copy of the domain and drifted silently
// when the real one changed. Keep it tied to consts.ts.
const SITE = (await readFile('src/consts.ts', 'utf8')).match(/SITE = '([^']*)'/)?.[1];
for (const key of ['site_url', 'display_url']) {
  if (config[key] && SITE && config[key].replace(/\/$/, '') !== SITE.replace(/\/$/, '')) {
    problems.push(`${key} is "${config[key]}" but SITE in consts.ts is "${SITE}"`);
  }
}

const exists = async (p) => {
  try { await access(p); return true; } catch { return false; }
};

for (const c of config.collections ?? []) {
  const where = `collection "${c.name}"`;

  if (c.folder && !(await exists(c.folder))) {
    problems.push(`${where}: folder "${c.folder}" does not exist`);
  }
  for (const f of c.files ?? []) {
    if (f.file && !(await exists(f.file))) {
      problems.push(`${where}, file "${f.name}": "${f.file}" does not exist`);
    }
  }

  // A relation pointing at a collection that is not configured silently
  // renders an empty picker.
  const names = new Set((config.collections ?? []).map((x) => x.name));
  const walk = (fields, trail) => {
    for (const f of fields ?? []) {
      if (f.widget === 'relation' && f.collection && !names.has(f.collection)) {
        problems.push(`${where}, field "${trail}${f.name}": relation targets unknown collection "${f.collection}"`);
      }
      if (f.fields) walk(f.fields, `${trail}${f.name}.`);
      if (f.field) walk([f.field], `${trail}${f.name}.`);
    }
  };
  walk(c.fields, '');
  for (const f of c.files ?? []) walk(f.fields, `${f.name}.`);

  // A collection media folder is resolved relative to the collection folder.
  if (c.media_folder && c.folder && c.media_folder.startsWith('..')) {
    const resolved = path.normalize(path.join(c.folder, c.media_folder));
    if (!(await exists(resolved))) {
      problems.push(`${where}: media_folder resolves to "${resolved}", which does not exist`);
    }
  }
}

/**
 * Field drift. The editor writes exactly the fields configured here, so a
 * schema key with no matching field means anything created from /admin fails
 * the build — which is how the proposition editor came to write `book:` after
 * the content schema had moved to `chapter:`. Comparing the config against the
 * frontmatter of files already on disk catches it without duplicating the Zod
 * schemas in a second place.
 */
const { readdir } = await import('node:fs/promises');
for (const c of config.collections ?? []) {
  if (!c.folder || !(await exists(c.folder))) continue;
  const configured = new Set((c.fields ?? []).map((f) => f.name));
  let files;
  try {
    files = (await readdir(c.folder, { recursive: true })).filter((f) => /\.mdx?$/.test(f));
  } catch { continue; }

  const seen = new Map();                 // key → the first file that used it
  for (const rel of files.slice(0, 200)) {
    const text = await readFile(path.join(c.folder, rel), 'utf8');
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) continue;
    for (const line of fm[1].split(/\r?\n/)) {
      const key = line.match(/^([A-Za-z_][\w-]*):/)?.[1];
      if (key && !seen.has(key)) seen.set(key, rel);
    }
  }
  for (const [key, rel] of seen) {
    if (!configured.has(key)) {
      problems.push(
        `collection "${c.name}": ${rel} has frontmatter "${key}" but the editor has no such field — ` +
        `anything created from /admin will be missing it`
      );
    }
  }
}

/**
 * The figure picker is a hand-written list of names that has to match the
 * registry, or /admin offers a figure that does not render.
 */
const registry = (await readFile('src/lib/figures.ts', 'utf8'))
  .match(/^  (Fig\w+): \{$/gm)
  ?.map((m) => m.trim().replace(/: \{$/, '')) ?? [];
for (const c of config.collections ?? []) {
  for (const f of c.fields ?? []) {
    if (f.name !== 'figure' && f.name !== 'closingFigure') continue;
    for (const opt of f.options ?? []) {
      if (!registry.includes(opt)) {
        problems.push(`collection "${c.name}", field "${f.name}": "${opt}" is not in src/lib/figures.ts`);
      }
    }
    for (const name of registry) {
      if (!(f.options ?? []).includes(name)) {
        problems.push(`collection "${c.name}", field "${f.name}": "${name}" is registered but not offered in /admin`);
      }
    }
  }
}

if (problems.length) {
  console.error('✗ CMS configuration problems:');
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log(
  `✓ CMS config valid — ${config.collections.length} collections; folders, relations, ` +
  `fields and ${registry.length} figures all resolve`
);
