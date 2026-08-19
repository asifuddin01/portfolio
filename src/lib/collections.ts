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
