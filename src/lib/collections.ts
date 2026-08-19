import { getCollection, type CollectionEntry } from 'astro:content';

/** Draft entries are excluded from production builds, kept in dev. */
const visible = <T extends { data: { status: 'draft' | 'published' } }>(e: T): boolean =>
  !import.meta.env.PROD || e.data.status === 'published';

export async function getPropositions(): Promise<CollectionEntry<'elementa'>[]> {
  const all = await getCollection('elementa');
  return all
    .filter(visible)
    .sort((a, b) =>
      a.data.book - b.data.book || a.data.proposition - b.data.proposition
    );
}

export async function getMarginalia(): Promise<CollectionEntry<'marginalia'>[]> {
  const all = await getCollection('marginalia');
  return all.filter(visible).sort((a, b) => b.data.entry - a.data.entry);
}
