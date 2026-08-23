/**
 * A tiny frontmatter reader shared by the five guards.
 *
 * The guards read the content directory rather than `astro:content` so they
 * run standalone from an npm script and from the build hook alike, and so a
 * schema error and a structural error are reported separately rather than the
 * first hiding the second.
 *
 * It is not a general YAML parser. It handles exactly the shapes Elementa
 * frontmatter uses — scalars, string lists, and lists of one-level maps — and
 * anything else it leaves alone, because a guard that silently mis-parses is
 * worse than no guard.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const unquote = (v) => {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
};

export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { data: {}, body: text };
  const body = text.slice(m[0].length);
  const lines = m[1].split(/\r?\n/);
  const data = {};
  let key = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const top = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (top) {
      key = top[1];
      const value = top[2].trim();
      if (value === '' ) data[key] = [];
      else if (value === '[]') data[key] = [];
      else if (value === 'true' || value === 'false') data[key] = value === 'true';
      else if (/^-?\d+(\.\d+)?$/.test(value)) data[key] = Number(value);
      else data[key] = unquote(value);
      continue;
    }

    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) {
      if (!Array.isArray(data[key])) data[key] = [];
      const v = item[1].trim();
      const pair = v.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      data[key].push(pair ? { [pair[1]]: unquote(pair[2]) } : unquote(v));
      continue;
    }

    // A nested key under the current list's last map, or under a map value.
    const nested = line.match(/^\s+([A-Za-z_][\w-]*):\s*(.*)$/);
    if (nested && key && Array.isArray(data[key]) && data[key].length) {
      const last = data[key][data[key].length - 1];
      if (last && typeof last === 'object') last[nested[1]] = unquote(nested[2]);
    }
  }
  return { data, body };
}

export async function readCollection(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.filter((n) => n.endsWith('.mdx') || n.endsWith('.md'))) {
    const file = path.join(dir, name);
    const text = await readFile(file, 'utf8');
    const { data, body } = parseFrontmatter(text);
    out.push({ id: name.replace(/\.mdx?$/, ''), file, data, body, text });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
