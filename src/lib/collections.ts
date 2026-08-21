import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { EMAIL, GITHUB, LINKEDIN, LOCATION } from '../consts';

/** Draft entries are excluded from production builds, kept in dev. */
const visible = <T extends { data: { status: 'draft' | 'published' } }>(e: T): boolean =>
  !import.meta.env.PROD || e.data.status === 'published';

/** Books in reading order. */
export async function getBooks(): Promise<CollectionEntry<'books'>[]> {
  const all = await getCollection('books');
  return all.sort((a, b) => a.data.order - b.data.order);
}

/**
 * Book numerals come from position, not from the `order` value, so adding or
 * renumbering a book can never leave a gap in the sequence.
 */
export async function getBookIndex(): Promise<Map<string, { n: number; entry: CollectionEntry<'books'> }>> {
  const books = await getBooks();
  return new Map(books.map((entry, i) => [entry.id, { n: i + 1, entry }]));
}

export async function getPropositions(): Promise<CollectionEntry<'elementa'>[]> {
  const all = await getCollection('elementa');
  const index = await getBookIndex();
  const rank = (e: CollectionEntry<'elementa'>) => index.get(e.data.book.id)?.n ?? 999;
  return all
    .filter(visible)
    .sort((a, b) => rank(a) - rank(b) || a.data.proposition - b.data.proposition);
}

export async function getMarginalia(): Promise<CollectionEntry<'marginalia'>[]> {
  const all = await getCollection('marginalia');
  return all.filter(visible).sort((a, b) => b.data.entry - a.data.entry);
}

/** The interleaved artwork, in plate order. */
export async function getTabulae(): Promise<CollectionEntry<'art'>[]> {
  const all = await getCollection('art');
  return all.filter(visible).sort((a, b) => a.data.order - b.data.order);
}

/**
 * The positions a plate can occupy on the home page, in the order they appear.
 * Position 1 is the frontispiece, beside the name; the rest follow a chapter
 * each, down the scroll.
 */
export const PLATE_SLOTS = [
  'frontispiece', 'prologue', 'axioms', 'instrumentarium', 'compendium',
  'instrumenta', 'elementa', 'marginalia', 'chronicle', 'appendix',
  'correspondence',
] as const;

export type PlateSlot = (typeof PLATE_SLOTS)[number];

/**
 * Lays the plates onto the home page.
 *
 * `onHome` decides whether a plate appears at all; `homePosition` decides the
 * order. The plates are sorted by that number and dealt into the positions in
 * turn, so the numbers only have to be in the right sequence — they need not
 * be consecutive, and a gap or a duplicate costs nothing. If there are more
 * plates than positions, the surplus stacks in the last one rather than
 * disappearing.
 */
export async function getHomePlates(): Promise<{
  numeral: Map<string, number>;
  front: CollectionEntry<'art'> | undefined;
  bySlot: Map<PlateSlot, CollectionEntry<'art'>[]>;
}> {
  const all = await getTabulae();
  const numeral = new Map(all.map((t, i) => [t.id, i + 1]));

  const shown = all
    .filter((t) => t.data.onHome)
    .sort(
      (a, b) =>
        a.data.homePosition - b.data.homePosition ||
        a.data.order - b.data.order
    );

  const bySlot = new Map<PlateSlot, CollectionEntry<'art'>[]>(
    PLATE_SLOTS.map((s) => [s, []])
  );

  shown.forEach((entry, i) => {
    const slot = PLATE_SLOTS[Math.min(i, PLATE_SLOTS.length - 1)]!;
    bySlot.get(slot)!.push(entry);
  });

  const front = bySlot.get('frontispiece')?.[0];
  return { numeral, front, bySlot };
}

/** Papers, newest first, with the published ones ahead of the drafts. */
export async function getPapers(): Promise<CollectionEntry<'papers'>[]> {
  const RANK = { published: 0, preprint: 1, 'under-review': 2, 'in-preparation': 3 };
  const all = await getCollection('papers');
  return all
    .filter(visible)
    .sort(
      (a, b) =>
        RANK[a.data.state] - RANK[b.data.state] ||
        b.data.year.localeCompare(a.data.year) ||
        a.data.title.localeCompare(b.data.title)
    );
}

export async function getEducation(): Promise<CollectionEntry<'education'>[]> {
  return (await getCollection('education')).sort((a, b) => a.data.order - b.data.order);
}

export async function getProjects(): Promise<CollectionEntry<'projects'>[]> {
  return (await getCollection('projects')).sort((a, b) => a.data.order - b.data.order);
}

/** Photographs, in display order. */
export async function getImages(): Promise<CollectionEntry<'images'>[]> {
  const all = await getCollection('images');
  return all.filter(visible).sort((a, b) => a.data.order - b.data.order);
}

/** The maxims, in order. */
export async function getAxioms(): Promise<CollectionEntry<'axioms'>[]> {
  const all = await getCollection('axioms');
  return all.sort((a, b) => a.data.order - b.data.order);
}

/**
 * Contact details. Editable in /admin under Site text, with the values in
 * consts.ts as a fallback so nothing breaks if the entry is removed.
 */
export async function getContact(): Promise<{
  email: string;
  github: string;
  linkedin: string;
  location: string;
}> {
  const e = await getEntry('site', 'contact');
  return {
    email: e?.data.email ?? EMAIL,
    github: e?.data.github ?? GITHUB,
    linkedin: e?.data.linkedin ?? LINKEDIN,
    location: e?.data.location ?? LOCATION,
  };
}
