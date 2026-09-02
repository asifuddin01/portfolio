import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { EMAIL, GITHUB, LINKEDIN, LOCATION } from '../consts';
import {
  APPARATUS_PARTS, TIER_RULES, COVERAGE_RULES, STRANDS,
  propositionId, type MathTier, type Strand,
} from './elementa-spec';

/**
 * Draft entries are excluded from production builds, kept in dev.
 *
 * `review` ships. It marks a page that is written and structurally complete
 * but has not yet met the Math Mandate (spec §5.2) — which is the state most
 * of the corpus is in while it is brought up to v2. Promoting to `published`
 * is what switches the quota guard on for that page.
 */
const visible = <T extends { data: { status: 'draft' | 'review' | 'published' } }>(
  e: T
): boolean => !import.meta.env.PROD || e.data.status !== 'draft';

/** Book 0 is a reference volume, not a book in the reading order (§16). */
export const APPARATUS_BOOK = 'apparatus';

/** Books in reading order. Book 0 is not one of them. */
export async function getBooks(): Promise<CollectionEntry<'books'>[]> {
  const all = await getCollection('books');
  return all
    .filter(visible)
    .filter((b) => b.data.id !== '0')
    .sort((a, b) => a.data.order - b.data.order);
}

/** Book 0 itself, when a page needs its prose. */
export async function getApparatusBook() {
  return getEntry('books', APPARATUS_BOOK);
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
  /** Position in the book, for ordering. */
  n: number;
  /** The permanent identifier, "I.5". Displayed, cited, never recomputed. */
  id: string;
  /** The chapter's own slug segment, "attention". */
  slug: string;
  tier: MathTier;
}

export interface ElementaBook {
  book: CollectionEntry<'books'>;
  chapters: ElementaChapter[];
  propositions: CollectionEntry<'elementa'>[];
  n: number;
  /** The Roman numeral from the book's own id — not from its position. */
  numeral: string;
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
      id: chapter.data.id,
      slug: chapter.id.split('--')[1]!,
      tier: chapter.data.mathTier,
      propositions: props.filter((p) => p.data.chapter.id === chapter.id),
    }));
    return {
      book,
      n: bi + 1,
      numeral: book.data.id,
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
  /** "I.5.P04" — the citable identifier (§3.1). */
  id: string;
  /** Position in the whole corpus, for "proposition 4 of 24". */
  index: number;
  total: number;
  previous: CollectionEntry<'elementa'> | null;
  next: CollectionEntry<'elementa'> | null;
  given: CollectionEntry<'elementa'>[];
  /** Propositions that name this one as a prerequisite. */
  usedBy: CollectionEntry<'elementa'>[];
  /** Problems and exercises that draw on it (§17). Derived, never declared. */
  problems: CollectionEntry<'problems'>[];
}

/**
 * Everything a proposition page needs to place itself: where it sits, what it
 * depends on, and what depends on it. The reverse index is derived rather than
 * declared, so a dependency can never be recorded on one side only.
 */
export async function getPropositionContexts(): Promise<PropositionContext[]> {
  const [tree, props, items] = await Promise.all([
    getElementaTree(),
    getPropositions(),
    getProblems(),
  ]);

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
    const id = propositionId(place.chapter.data.id, entry.data.proposition);
    return {
      entry,
      ...place,
      id,
      index: i + 1,
      total: props.length,
      previous: props[i - 1] ?? null,
      next: props[i + 1] ?? null,
      given: entry.data.given
        .map((g) => byId.get(g.id))
        .filter((g): g is CollectionEntry<'elementa'> => Boolean(g)),
      usedBy: usedBy.get(entry.id) ?? [],
      problems: items.filter((it) => it.data.depends.includes(id)),
    };
  });
}

// ── The mathematical spine ─────────────────────────────────────────────────

/** Problems and exercises, in ID order within a chapter. */
export async function getProblems(): Promise<CollectionEntry<'problems'>[]> {
  const all = await getCollection('problems');
  return all.filter(visible).sort((a, b) => a.data.id.localeCompare(b.data.id));
}

export interface ChapterMath {
  problems: CollectionEntry<'problems'>[];
  exercises: CollectionEntry<'problems'>[];
  variants: Set<string>;
  tier: MathTier;
  rule: (typeof TIER_RULES)[MathTier];
  /** How far the chapter is from its quota. Zero means the mandate is met. */
  owed: { problems: number; variants: number; exercises: number };
  meetsQuota: boolean;
}

/**
 * What a chapter owes the Math Mandate, and what it has paid (§5.2).
 *
 * The same arithmetic the build guard runs, so a page can show the debt in
 * the terms the guard will one day fail on. Nothing here is maintained by
 * hand: promote a chapter to `published` and the guard starts enforcing
 * exactly the numbers this returns.
 */
export function chapterMath(
  tier: MathTier,
  items: CollectionEntry<'problems'>[]
): ChapterMath {
  const problems = items.filter((i) => i.data.kind === 'problem');
  const exercises = items.filter((i) => i.data.kind === 'exercise');
  const variants = new Set(problems.map((p) => p.data.variant));
  const rule = TIER_RULES[tier];
  const owed = {
    problems: Math.max(0, rule.minProblems - problems.length),
    variants: Math.max(0, rule.minVariants - variants.size),
    exercises: Math.max(0, rule.minExercises - exercises.length),
  };
  return {
    problems, exercises, variants, tier, rule, owed,
    meetsQuota: owed.problems === 0 && owed.variants === 0 && owed.exercises === 0,
  };
}

export interface StrandState {
  key: Strand;
  latin: string;
  asks: string;
  have: number;
  need: number;
  met: boolean;
}

/**
 * §7.2 — how far each of the five strands has been paid.
 *
 * The same arithmetic `check-coverage` runs, so a page can show the debt in
 * the terms the guard will one day fail on. Mathematics is one strand of five:
 * a chapter cannot buy its way out of teaching with problems, and it cannot
 * buy its way out of problems with teaching.
 */
export function chapterCoverage(
  chapter: CollectionEntry<'chapters'>,
  items: CollectionEntry<'problems'>[]
): StrandState[] {
  const d = chapter.data;
  const rule = COVERAGE_RULES[d.mathTier];
  const mathRule = TIER_RULES[d.mathTier];
  const maths = chapterMath(d.mathTier, items);

  const pairs: Record<Strand, { have: number; need: number }> = {
    basics: {
      have: d.definitions.length + d.beforeYouStart.length,
      need: rule.definitions + rule.beforeYouStart,
    },
    concept: {
      have: (d.conceptFigure ? 1 : 0) + (d.problemStatement ? 1 : 0),
      need: 2,
    },
    theory: {
      have: d.formalResults.length + d.assumptions.length,
      need: rule.formalResults + rule.assumptions,
    },
    mathematics: {
      have: maths.problems.length + maths.exercises.length,
      need: mathRule.minProblems + mathRule.minExercises,
    },
    practice: {
      have: (d.implementation ? 1 : 0) + d.failureModes.length + d.references.length,
      need: (rule.implementation ? 1 : 0) + rule.failureModes + rule.references,
    },
  };

  return STRANDS.map((s) => {
    const { have, need } = pairs[s.key];
    return { ...s, have, need, met: have >= need };
  });
}

/** Everything filed under one chapter ID, e.g. "I.5" or "I.BOOK". */
export async function getChapterProblems(chapterId: string) {
  return (await getProblems()).filter((p) => p.data.chapter === chapterId);
}

// ── Book 0 · Apparatus ─────────────────────────────────────────────────────

export interface ApparatusPart {
  code: string;
  slug: string;
  title: string;
  covers: string;
  entries: CollectionEntry<'apparatus'>[];
}

/**
 * The Apparatus, grouped into its seven parts.
 *
 * The "Used by" line on each entry is generated from the chapters and
 * propositions that cite it, never written by hand — hand-maintained
 * back-links rot within a month (§17).
 */
export async function getApparatus(): Promise<ApparatusPart[]> {
  const all = (await getCollection('apparatus')).filter(visible);
  return APPARATUS_PARTS.map((part) => ({
    ...part,
    entries: all
      .filter((e) => e.data.part === part.code)
      .sort((a, b) => a.data.order - b.data.order),
  }));
}

/** Which chapters and propositions cite each Apparatus entry. */
export async function getApparatusUsage(): Promise<Map<string, string[]>> {
  const [chapters, contexts] = await Promise.all([
    getChapters(),
    getPropositionContexts(),
  ]);
  const use = new Map<string, string[]>();
  const add = (ref: string, by: string) => {
    if (!use.has(ref)) use.set(ref, []);
    if (!use.get(ref)!.includes(by)) use.get(ref)!.push(by);
  };
  for (const c of chapters) for (const a of c.data.apparatus) add(a, c.data.id);
  for (const ctx of contexts) for (const a of ctx.entry.data.apparatus) add(a, ctx.id);
  return use;
}

/** The notation registry (§5.6), in the order the file declares it. */
export async function getNotation(): Promise<CollectionEntry<'notation'>[]> {
  return getCollection('notation');
}

export async function getMarginalia(): Promise<CollectionEntry<'marginalia'>[]> {
  const all = await getCollection('marginalia');
  return all.filter(visible).sort((a, b) => b.data.entry - a.data.entry);
}

/**
 * The reading course, in part order. Marginalia II.
 *
 * Ascending, unlike the ledger in Marginalia I: a commonplace book is read
 * newest-first, a course is read from the beginning.
 */
export async function getLectiones(): Promise<CollectionEntry<'lectiones'>[]> {
  const all = await getCollection('lectiones');
  return all.filter(visible).sort((a, b) => a.data.part - b.data.part);
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
/**
 * The shelves of the Bibliotheca, in reading order rather than alphabetical:
 * a reader working through them wants the statistics before the deep learning
 * and the primer before Pearl. The order here is the order on the page.
 */
export const SHELVES = [
  { id: 'foundations', label: 'Foundations', gloss: 'statistics and learning theory' },
  { id: 'deep-learning', label: 'Deep learning', gloss: 'the mechanisms, and how to build them' },
  { id: 'causality', label: 'Causality', gloss: 'the ladder, and what climbs it' },
  { id: 'decisions', label: 'Decisions', gloss: 'optimisation, control and agents' },
] as const;

export type Shelf = (typeof SHELVES)[number]['id'];

/** Books, grouped by shelf. Empty shelves are dropped rather than shown bare. */
export async function getBibliotheca(): Promise<
  { shelf: (typeof SHELVES)[number]; books: CollectionEntry<'bibliotheca'>[] }[]
> {
  const all = (await getCollection('bibliotheca')).filter(visible);
  return SHELVES
    .map((shelf) => ({
      shelf,
      books: all
        .filter((b) => b.data.shelf === shelf.id)
        .sort(
          (a, b) =>
            a.data.order - b.data.order || a.data.title.localeCompare(b.data.title)
        ),
    }))
    .filter((g) => g.books.length > 0);
}

/** How many books are on the shelves. Used for the count on /marginalia. */
export async function countBooks(): Promise<number> {
  return (await getCollection('bibliotheca')).filter(visible).length;
}

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

/** Scoping reviews in progress, in reading order. */
export async function getReviews(): Promise<CollectionEntry<'reviews'>[]> {
  const all = await getCollection('reviews');
  return all.filter(visible).sort((a, b) => a.data.order - b.data.order);
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
