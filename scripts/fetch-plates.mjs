/**
 * Pulls a curated set of public-domain philosophical engravings and sculpture
 * from the Art Institute of Chicago's open-access API (CC0, no key required)
 * into src/assets/plates/, and writes a manifest with full attribution.
 *
 * Run: node scripts/fetch-plates.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = path.resolve('src/assets/plates');
const MANIFEST = path.resolve('src/lib/plates.json');
const API = 'https://api.artic.edu/api/v1/artworks/search';
const FIELDS =
  'id,title,artist_title,date_display,image_id,is_public_domain,classification_title,medium_display,credit_line';

/** Each entry names what we want and how to recognise it in the results. */
const WANTED = [
  { slug: 'melencolia',   q: 'Melencolia I Dürer',                        artist: /dürer/i,    match: /melencolia/i,          note: 'Thought at rest, surrounded by instruments it will not use.' },
  { slug: 'saint-jerome', q: 'St. Jerome in His Study Dürer 1514',        artist: /dürer/i,    match: /jerome/i,              note: 'The scholar’s room, drawn as a machine for concentration.' },
  { slug: 'knight-death', q: 'Knight Death and the Devil Dürer',          artist: /dürer/i,    match: /knight/i,              note: 'Proceeding anyway, which is most of method.' },
  { slug: 'sleep-reason', q: 'The Sleep of Reason Produces Monsters Goya', artist: /goya/i,    match: /sleep of reason|sueño/i, note: 'Goya’s caption is a warning about what reason leaves behind when it stops.' },
  { slug: 'carceri',      q: 'Carceri Imaginary Prisons Piranesi',        artist: /piranesi/i, match: /prison|carceri/i,      note: 'Architecture as an argument that never terminates.' },
  { slug: 'scholar',      q: 'Rembrandt Self-Portrait Etching at a Window', artist: /rembrandt van rijn/i, match: /self-portrait etching/i, note: 'Light arriving in a room where someone is working.' },
  { slug: 'anatomy',      q: 'A Sheet of Anatomical Studies Rubens',      artist: /rubens/i,   match: /anatom/i,              note: 'The body, sectioned and numbered — the ancestor of every figure on this site.' },
  { slug: 'bust',         q: 'Roman marble portrait bust',                artist: null,        match: /bust|portrait head/i,  note: 'A face kept for two thousand years because of what was said behind it.' },
  { slug: 'meditation',   q: 'Buddha Shakyamuni Seated in Meditation Dhyanamudra Chola', artist: null, match: /meditation/i,  note: 'A different tradition, arriving at stillness by a different road.' },
];

async function search(q) {
  const url = `${API}?q=${encodeURIComponent(q)}&fields=${FIELDS}&limit=12`;
  const res = await fetch(url, {
    headers: { 'AIC-User-Agent': 'mdasifuddin-portfolio (md.asif.uddin@g.bracu.ac.bd)' },
  });
  if (!res.ok) throw new Error(`search failed ${res.status} for ${q}`);
  const json = await res.json();
  return json.data ?? [];
}

/* AIC asks API consumers to identify themselves; the image CDN enforces it. */
const HEADERS = {
  'AIC-User-Agent': 'mdasifuddin-portfolio (md.asif.uddin@g.bracu.ac.bd)',
  'User-Agent': 'mdasifuddin-portfolio/1.0 (+https://github.com/asifuddin01)',
  'Accept': 'image/jpeg,image/*;q=0.8,*/*;q=0.5',
};

async function download(imageId, dest) {
  const url = `https://www.artic.edu/iiif/2/${imageId}/full/1400,/0/default.jpg`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`image failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

const manifest = [];
await mkdir(OUT_DIR, { recursive: true });

for (const want of WANTED) {
  try {
    const results = await search(want.q);
    const ok = (r) => r.is_public_domain && r.image_id;
    const byArtist = (r) => !want.artist || want.artist.test(r.artist_title ?? '');
    const hit =
      results.find((r) => ok(r) && byArtist(r) && want.match.test(r.title ?? '')) ??
      results.find((r) => ok(r) && want.match.test(r.title ?? '')) ??
      results.find((r) => ok(r) && byArtist(r)) ??
      results.find(ok);

    if (!hit) {
      console.log(`  ✗ ${want.slug}: no public-domain match`);
      continue;
    }

    const file = `${want.slug}.jpg`;
    const bytes = await download(hit.image_id, path.join(OUT_DIR, file));

    manifest.push({
      slug: want.slug,
      file,
      title: hit.title,
      artist: hit.artist_title ?? 'Unknown',
      date: hit.date_display ?? '',
      medium: hit.medium_display ?? hit.classification_title ?? '',
      credit: hit.credit_line ?? '',
      sourceId: hit.id,
      sourceUrl: `https://www.artic.edu/artworks/${hit.id}`,
      licence: 'CC0 — public domain',
      note: want.note,
    });
    console.log(`  ✓ ${want.slug}: ${hit.title} — ${hit.artist_title} (${(bytes / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.log(`  ✗ ${want.slug}: ${err.message}`);
  }
}

await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nWrote ${manifest.length} plates to ${MANIFEST}`);
