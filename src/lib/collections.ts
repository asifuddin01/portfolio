import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { EMAIL, GITHUB, LINKEDIN, LOCATION } from '../consts';

/** Draft entries are excluded from production builds, kept in dev. */
const visible = <T extends { data: { status: 'draft' | 'published' } }>(e: T): boolean =>
  !import.meta.env.PROD || e.data.status === 'published';

/** Books in reading order. */
export async function getBooks(): Promise<CollectionEntry<'books'>[]> {
  const all = await getCollection('books');
  return all.filter(visible).sort((a, b) => a.data.order - b.data.order);
}

/** Chapters, in book order then chapter order. */
export async function getChapters(): Promise<CollectionEntry<'chapters'>[]> {
  const [chapters, books] = await Promise.all([getCollection('chapters'), getBooks()]);
  const rank = new Map(books.map((b, i) => [b.id, i]));
  return chapters
    .filter(visible)
    .sort(
      (a, b) =>
        (rank.get(a.data.book.id) ?? 999) - (rank.get(b.data.book.id) ?? 999) ||
        a.data.order - b.data.order
    );
}

/**
 * Every proposition in reading order: by book, then chapter, then its number
 * within that chapter. This is the sequence the previous/next links follow and
 * the order the progress count is measured against.
 */
export async function getPropositions(): Promise<CollectionEntry<'elementa'>[]> {
  const [props, chapters] = await Promise.all([
    getCollection('elementa'),
    getChapters(),
  ]);
  const rank = new Map(chapters.map((c, i) => [c.id, i]));
  return props
    .filter(visible)
    .sort(
      (a, b) =>
        (rank.get(a.data.chapter.id) ?? 999) - (rank.get(b.data.chapter.id) ?? 999) ||
        a.data.proposition - b.data.proposition
    );
}

export interface ElementaChapter {
  chapter: CollectionEntry<'chapters'>;
  propositions: CollectionEntry<'elementa'>[];
  n: number;
}

export interface ElementaBook {
  book: CollectionEntry<'books'>;
  chapters: ElementaChapter[];
  propositions: CollectionEntry<'elementa'>[];
  n: number;
}

/** Books, their chapters and the propositions inside them, in reading order. */
export async function getElementaTree(): Promise<ElementaBook[]> {
  const [books, chapters, props] = await Promise.all([
    getBooks(),
    getChapters(),
    getPropositions(),
  ]);
  return books.map((book, bi) => {
    const own = chapters.filter((c) => c.data.book.id === book.id);
    const tree = own.map((chapter, ci) => ({
      chapter,
      n: ci + 1,
      propositions: props.filter((p) => p.data.chapter.id === chapter.id),
    }));
    return {
      book,
      n: bi + 1,
      chapters: tree,
      propositions: tree.flatMap((c) => c.propositions),
    };
  });
}

export interface PropositionContext {
  entry: CollectionEntry<'elementa'>;
  book: CollectionEntry<'books'>;
  chapter: CollectionEntry<'chapters'>;
  bookN: number;
  chapterN: number;
  /** Position in the whole corpus, for "proposition 4 of 24". */
  index: number;
  total: number;
  previous: CollectionEntry<'elementa'> | null;
  next: CollectionEntry<'elementa'> | null;
  given: CollectionEntry<'elementa'>[];
  /** Propositions that name this one as a prerequisite. */
  usedBy: CollectionEntry<'elementa'>[];
}

/**
 * Everything a proposition page needs to place itself: where it sits, what it
 * depends on, and what depends on it. The reverse index is derived rather than
 * declared, so a dependency can never be recorded on one side only.
 */
export async function getPropositionContexts(): Promise<PropositionContext[]> {
  const [tree, props] = await Promise.all([getElementaTree(), getPropositions()]);

  const chapterOf = new Map<string, { chapter: CollectionEntry<'chapters'>; chapterN: number; book: CollectionEntry<'books'>; bookN: number }>();
  for (const b of tree) {
    for (const c of b.chapters) {
      chapterOf.set(c.chapter.id, {
        chapter: c.chapter,
        chapterN: c.n,
        book: b.book,
        bookN: b.n,
      });
    }
  }

  const byId = new Map(props.map((p) => [p.id, p]));
  const usedBy = new Map<string, CollectionEntry<'elementa'>[]>();
  for (const p of props) {
    for (const g of p.data.given) {
      if (!usedBy.has(g.id)) usedBy.set(g.id, []);
      usedBy.get(g.id)!.push(p);
    }
  }

  return props.map((entry, i) => {
    const place = chapterOf.get(entry.data.chapter.id)!;
    return {
      entry,
      ...place,
      index: i + 1,
      total: props.length,
      previous: props[i - 1] ?? null,
      next: props[i + 1] ?? null,
      given: entry.data.given
        .map((g) => byId.get(g.id))
        .filter((g): g is CollectionEntry<'elementa'> => Boolean(g)),
      usedBy: usedBy.get(entry.id) ?? [],
    };
  });
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
