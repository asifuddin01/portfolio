#!/usr/bin/env node
/**
 * Send files or links to the private archive at asifuddin.com/artifacts/private.
 *
 *   npm run artifact -- "HCGT-PG" blueprint.html figure.svg notes.md
 *   npm run artifact -- "HCGT-PG" https://claude.ai/artifact/…  --title "Blueprint (Claude)"
 *   npm run artifact -- "CiteProof" report.pdf --note "first agreement figure"
 *
 * The first argument is the research the artifacts belong to; a new name
 * starts a new shelf. Everything after it is a file path or an http(s) link.
 * --title applies when a single item is sent; --note applies to all of them.
 *
 * This goes through the inbox, which is outside Cloudflare Access because a
 * script cannot sign in with an email code. It uses the add-only key, read
 * from ARTIFACTS_INBOX_KEY or ~/.config/asifuddin-artifacts/key, and can do
 * nothing else: it cannot list, open, change or delete what is already there.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const ENDPOINT = process.env.ARTIFACTS_ENDPOINT ?? 'https://asifuddin.com/api/artifacts/inbox';
const KEY_FILE = path.join(homedir(), '.config', 'asifuddin-artifacts', 'key');
const MAX_BYTES = 25 * 1024 * 1024;

function usage(msg) {
  if (msg) console.error(`✗ ${msg}\n`);
  console.error('usage: npm run artifact -- "<research>" <file-or-link>... [--title "…"] [--note "…"]');
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = {};
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--title' || args[i] === '--note') flags[args[i].slice(2)] = args[++i];
  else rest.push(args[i]);
}
const [research, ...targets] = rest;
if (!research || targets.length === 0) usage();

let key = process.env.ARTIFACTS_INBOX_KEY?.trim();
if (!key) {
  try {
    key = (await readFile(KEY_FILE, 'utf8')).trim();
  } catch {
    usage(`no inbox key: set ARTIFACTS_INBOX_KEY or put it in ${KEY_FILE}`);
  }
}

const single = targets.length === 1;
let failures = 0;

for (const target of targets) {
  const isLink = /^https?:\/\//i.test(target);
  let init;
  if (isLink) {
    init = {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ research, url: target, title: single ? flags.title : undefined, note: flags.note }),
    };
  } else {
    let bytes;
    try {
      bytes = await readFile(target);
    } catch (err) {
      console.error(`✗ ${target}: ${err.code === 'ENOENT' ? 'no such file' : err.message}`);
      failures++;
      continue;
    }
    if (bytes.length > MAX_BYTES) {
      console.error(`✗ ${target}: ${(bytes.length / 1048576).toFixed(1)} MB is over the 25 MB limit`);
      failures++;
      continue;
    }
    const form = new FormData();
    form.set('file', new File([bytes], path.basename(target)));
    form.set('research', research);
    if (single && flags.title) form.set('title', flags.title);
    if (flags.note) form.set('note', flags.note);
    init = { body: form };
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${key}` },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 201) {
    console.error(`✗ ${target}: ${body.message ?? `HTTP ${res.status}`}`);
    failures++;
    continue;
  }
  console.log(`✓ ${body.research} · ${body.title}`);
  console.log(`  https://asifuddin.com/artifacts/private#${body.id}`);
}

process.exit(failures ? 1 : 0);
