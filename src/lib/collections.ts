import { getCollection, type CollectionEntry } from 'astro:content';

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

/** The chapters a plate can sit after, in page order. */
export const PLATE_SLOTS = [
  'prologue', 'axioms', 'instrumentarium', 'compendium', 'instrumenta',
  'elementa', 'marginalia', 'chronicle', 'appendix', 'correspondence',
] as const;

export type PlateSlot = (typeof PLATE_SLOTS)[number];

/**
 * Works out where the plates go on the home scroll.
 *
 * `onHome` is the only thing that decides WHETHER a plate appears. Placement
 * decides only WHERE, and a plate without one takes the next free position
 * rather than silently vanishing — the earlier version required both to
 * agree, so switching a plate on left it nowhere to go.
 *
 * Shared by the page and the frontispiece so the two cannot disagree about
 * which plate is the hero.
 */
export async function getHomePlates(): Promise<{
  numeral: Map<string, number>;
  front: CollectionEntry<'art'> | undefined;
  bySlot: Map<PlateSlot, CollectionEntry<'art'>[]>;
}> {
  const all = await getTabulae();
  const numeral = new Map(all.map((t, i) => [t.id, i + 1]));
  const shown = all.filter((t) => t.data.onHome);

  const front = shown.find((t) => t.data.placement === 'frontispiece') ?? shown[0];
  const rest = shown.filter((t) => t.id !== front?.id);

  const bySlot = new Map<PlateSlot, CollectionEntry<'art'>[]>(
    PLATE_SLOTS.map((s) => [s, []])
  );

  const claimed = new Set<PlateSlot>();
  const queue: CollectionEntry<'art'>[] = [];

  for (const t of rest) {
    const p = t.data.placement as PlateSlot;
    if (PLATE_SLOTS.includes(p) && !claimed.has(p)) {
      bySlot.get(p)!.push(t);
      claimed.add(p);
    } else {
      queue.push(t);
    }
  }

  // Anything left over fills the gaps; once the slots are full, extras stack
  // in the last one rather than disappearing.
  for (const t of queue) {
    const free = PLATE_SLOTS.find((s) => !claimed.has(s));
    const target = free ?? PLATE_SLOTS[PLATE_SLOTS.length - 1]!;
    bySlot.get(target)!.push(t);
    if (free) claimed.add(free);
  }

  return { numeral, front, bySlot };
}
