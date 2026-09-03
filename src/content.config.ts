import { defineCollection, reference } from 'astro:content';
import { z } from 'zod';
import { glob, file } from 'astro/loaders';
import {
  MATH_TIERS, VARIANTS, APPARATUS_CODES, FIGURE_TYPES, ROMAN_RE,
} from './lib/elementa-spec';

/** Book numerals I–VIII, plus 0 for the Apparatus (spec §3.3). */
const BOOK_ID = new RegExp(`^${ROMAN_RE}$`);
const CHAPTER_ID = new RegExp(`^${ROMAN_RE}\\.\\d+$`);
const ITEM_ID = new RegExp(`^${ROMAN_RE}\\.(?:\\d+|BOOK)\\.[BX]\\d{2}$`);

/**
 * Clearing an optional field in /admin writes an empty string rather than
 * removing the key, and an empty string is not a valid URL. Without these,
 * the first time anyone blanked a paper link the build would fail.
 */
const optionalUrl = z
  .preprocess((v) => {
    if (typeof v !== 'string') return v ?? null;
    const raw = v.trim();
    if (raw === '') return null;
    // Somebody pasted a sentence with a link in it. Take the link.
    const found = raw.match(/https?:\/\/[^\s<>"')\]]+/);
    if (found) return found[0];
    // A bare domain, e.g. example.com/page — assume https.
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw)) return `https://${raw}`;
    return raw;
  }, z.union([z.url(), z.null()]))
  .optional()
  .transform((v) => v ?? null);

/**
 * Three states, not two (spec §12.2).
 *
 *   draft      hidden from the live site
 *   review     live, structurally complete, mathematics not yet to quota
 *   published  Definition of Done met — and the Math Mandate is enforced
 *
 * The middle state is what lets the corpus stay online while it is being
 * brought up to v2. Promoting a chapter to `published` is what switches its
 * quota guard on, so the promotion is the commitment, not the intention.
 */
const shipStatus = z.enum(['draft', 'review', 'published']);

const optionalText = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v : null));

const works = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/works' }),
  schema: z.object({
    plate: z.number(),                       // 1..4, drives "Plate I" etc.
    title: z.string(),
    fullTitle: z.string(),
    subtitle: z.string(),
    status: z.enum(['deposited', 'in-preparation', 'under-review', 'proposal-accepted']),
    disclosure: z.enum(['public', 'embargoed']),
    year: z.string(),
    supervisors: z.array(z.string()),
    coauthors: z.array(z.string()).default([]),
    datasets: z.array(z.string()).default([]),
    abstract: z.string(),                    // verbatim from the paper
    citation: optionalText,
    paperUrl: optionalUrl,
    repoUrl: optionalUrl,
    metrics: z.array(z.object({
      label: z.string(),
      value: z.string(),
      note: z.string().optional(),
    })).default([]),
  }).superRefine((data, ctx) => {
    // Three of the four plates hold unpublished results. Encoding the
    // embargo here means a leak fails `astro build` instead of relying on
    // anyone's memory. Do not soften this to a warning.
    if (data.disclosure === 'embargoed' && data.metrics.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message:
          `Plate ${data.plate} ("${data.title}") is embargoed and must not ` +
          `carry metrics. Either remove every row from Results, or change ` +
          `Disclosure to "public" if these numbers are genuinely publishable.`,
      });
    }
  }),
});

/**
 * The books of the Elementa. A collection rather than a fixed list so new
 * ones — causal inference, bioinformatics — can be added from /admin.
 */
const books = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/books' }),
  schema: z.object({
    /**
     * The permanent identifier (spec §3.1). Roman, and never re-derived from
     * `order` — reordering the shelf is a display decision, identity is not,
     * and every chapter, equation and problem ID in the corpus is built on
     * this letter.
     */
    id: z.string().regex(BOOK_ID),
    order: z.number(),
    title: z.string(),
    covers: z.string(),
    /** What the reader can do once the book is finished. */
    goal: z.string().optional(),
    /** Books that should be read first, by slug. */
    prerequisites: z.array(z.string()).default([]),
    /** Apparatus entries the book assumes, e.g. "0.MC.07" (spec §6). */
    mathPrerequisites: z.array(z.string()).default([]),
    /** How the chapters compose into one idea. Rendered before the closing. */
    synthesis: optionalText,
    /** What is still unsolved in this field. */
    frontier: optionalText,
    /**
     * §19 — the implementation exercise that follows the book, bound to the
     * problems whose hand-computed numbers it has to reproduce.
     */
    practical: z
      .object({
        implement: z.string(),
        verifiedAgainst: z.array(z.string()).default([]),
        note: optionalText,
        /**
         * Laboratory work: things to go and run. Kept apart from the problem
         * set on purpose — a worked problem is checked against arithmetic, a
         * laboratory exercise is checked against a machine, and pretending
         * the second is one of the nine variants (§5.3) would be a false label.
         */
        laboratory: z
          .array(z.object({ task: z.string(), note: optionalText }))
          .default([]),
      })
      .optional(),
    /** The plate for the closing page — the whole book on one drawing. */
    closingFigure: z.string().nullable().default(null),
    /**
     * The closing apparatus, rendered at /elementa/<book>/closing. Every part
     * is optional and an empty list simply omits its section, so a book can
     * grow a closing one piece at a time rather than needing all of it at once.
     */
    closing: z
      .object({
        equations: z
          .array(z.object({
            name: z.string(),
            formula: z.string(),
            note: optionalText,
          }))
          .default([]),
        vocabulary: z
          .array(z.object({ term: z.string(), definition: z.string() }))
          .default([]),
        /**
         * §6 — what the reader should now be able to reproduce unaided. The
         * proof of progress is not "I read Book I", it is "I can derive the
         * softmax Jacobian without looking".
         */
        derivations: z
          .array(z.object({ result: z.string(), from: optionalText }))
          .default([]),
        /** Stated wrongly, then corrected. Both halves are the point. */
        misconceptions: z
          .array(z.object({ wrong: z.string(), right: z.string() }))
          .default([]),
        papers: z
          .array(z.object({ title: z.string(), url: optionalUrl, note: optionalText }))
          .default([]),
        /** What the next books do with this one. */
        bridge: optionalText,
      })
      .optional(),
    status: shipStatus.default('published'),
  }),
});

/**
 * Chapters sit between a book and its propositions. A proposition names its
 * chapter and the book follows from that, so a proposition can never disagree
 * with its own book about where it lives.
 */
const chapters = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/chapters' }),
  schema: z.object({
    /** Permanent identifier, "I.5" (spec §3.1). Cited from any other book. */
    id: z.string().regex(CHAPTER_ID),
    book: reference('books'),
    order: z.number(),
    title: z.string(),
    summary: z.string(),
    /** The chapter's one-sentence thesis. A title is not a claim. */
    claim: z.string().optional(),
    /**
     * §5.1 — the declared mathematical density. This is a claim about the
     * chapter's content, and check-math-quota enforces the consequences of
     * the claim once the chapter is published. M3 is expensive on purpose.
     */
    mathTier: z.enum(MATH_TIERS).default('M1'),
    /** Required when a mechanism chapter is downgraded below M3 (§5.1). */
    tierRationale: optionalText,
    /** What the chapter covers, shown before any proposition is written. */
    topics: z.array(z.string()).default([]),

    // ── BASICS (§7.1) ──────────────────────────────────────────────────
    /**
     * Numbered, stipulative definitions. "A computational graph is a directed
     * acyclic graph whose nodes are operations" — not "graphs are a useful way
     * to think about networks".
     */
    definitions: z
      .array(z.object({
        n: z.number().int(),
        term: z.string(),
        statement: z.string(),
        /** Symbols this definition introduces, checked against the registry. */
        introduces: z.array(z.string()).default([]),
      }))
      .default([]),
    /** The three-to-six prior results assumed, as clickable IDs. */
    beforeYouStart: z.array(z.string()).default([]),

    // ── CONCEPT (§7.1) ─────────────────────────────────────────────────
    /** One figure a reader could redraw from memory. Type A or C. */
    conceptFigure: z.string().nullable().default(null),
    /**
     * Why the mechanism is necessary, stated before the mechanism. A mechanism
     * introduced before its problem is memorised, not understood.
     */
    problemStatement: optionalText,

    // ── THEORY (§7.1) ──────────────────────────────────────────────────
    /**
     * Named formal results — a theorem, criterion, bound or impossibility.
     * Each one carries what it does *not* promise, and that field is the
     * difference between teaching theory and quoting it.
     */
    formalResults: z
      .array(z.object({
        id: z.string(),
        name: z.string(),
        statement: z.string(),
        doesNotPromise: z.string(),
      }))
      .default([]),
    /** Assumptions, each paired with the problem that shows its removal. */
    assumptions: z
      .array(z.object({ statement: z.string(), testedBy: z.string() }))
      .default([]),

    // ── PLACEMENT (§6.3) ───────────────────────────────────────────────
    /**
     * One mechanism, one home (invariant I-9). A chapter declares the concepts
     * it derives and the concepts it merely uses. Two chapters claiming the
     * same concept in `owns` fails the build — which is what stops the same
     * idea being taught twice in two Books and drifting apart.
     */
    owns: z.array(z.string()).default([]),
    borrows: z.array(z.string()).default([]),

    // ── PRACTICE (§7.1) ────────────────────────────────────────────────
    /** A runnable implementation, ≤ 25 lines, reproducing a problem's numbers. */
    implementation: z.boolean().default(false),
    /** Concrete failures — an input and a number, not "can struggle with". */
    failureModes: z.array(z.string()).default([]),
    /** Authors, year, venue. A claim about a paper carries all three (I-8). */
    references: z
      .array(z.object({
        authors: z.string(),
        year: z.number().int(),
        venue: z.string(),
        title: z.string(),
        url: optionalUrl,
      }))
      .default([]),

    /** Symbols used here, checked against the notation registry (§5.6). */
    notation: z.array(z.string()).default([]),
    /** Book 0 anchors the chapter leans on, e.g. "0.MC.07" (§16). */
    apparatus: z.array(z.string()).default([]),
    /**
     * §5.7 — every numbered equation, with a gloss naming what it *says*.
     * These become the book's key-equation table without being retyped.
     */
    keyEquations: z
      .array(z.object({
        id: z.string(),
        formula: z.string(),
        gloss: z.string().min(10),
      }))
      .default([]),
    status: shipStatus.default('review'),
  }).superRefine((data, ctx) => {
    // §5.1: a mechanism chapter dropped below M3 owes the reader a reason.
    if ((data.mathTier === 'M1' || data.mathTier === 'M2') &&
        data.keyEquations.length > 6 && !data.tierRationale) {
      ctx.addIssue({
        code: 'custom',
        message:
          `Chapter ${data.id} declares ${data.keyEquations.length} key equations ` +
          `at tier ${data.mathTier}. Either write a tierRationale saying why the ` +
          `mathematics is not load-bearing, or promote it to M3.`,
      });
    }
    /**
     * §7.1 — scope is not fine print. A theorem whose limits are not stated
     * has been quoted rather than taught, so the field is required whenever
     * a formal result exists at all.
     */
    for (const r of data.formalResults) {
      if (r.doesNotPromise.trim().length < 20) {
        ctx.addIssue({
          code: 'custom',
          message:
            `${data.id}/${r.id} ("${r.name}") has no WHAT THIS DOES NOT PROMISE ` +
            `block. Every named result carries the boundary of its guarantee.`,
        });
      }
      if (!r.id.startsWith(`${data.id}.`)) {
        ctx.addIssue({
          code: 'custom',
          message: `Formal result "${r.id}" is declared by chapter ${data.id} but numbered elsewhere.`,
        });
      }
    }

    // An assumption nobody tests is a disclaimer, not an assumption.
    for (const a of data.assumptions) {
      if (!a.testedBy.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: `${data.id}: assumption "${a.statement.slice(0, 48)}…" names no problem that shows what its removal costs.`,
        });
      }
    }

    // Every equation ID must belong to the chapter that declares it.
    for (const eq of data.keyEquations) {
      if (!eq.id.startsWith(`${data.id}.`)) {
        ctx.addIssue({
          code: 'custom',
          message: `Equation "${eq.id}" is declared by chapter ${data.id} but numbered elsewhere. Equations are numbered per chapter (§3.1).`,
        });
      }
    }
  }),
});

/**
 * Worked problems and exercises — the spine of v2 (spec §5). A problem is a
 * document with a fixed anatomy, not free prose, and the quota guard counts
 * these by chapter, by variant and by difficulty.
 */
const problems = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/problems' }),
  schema: z.object({
    /** "I.5.B03" for a problem, "I.5.X07" for an exercise (§3.1). */
    id: z.string().regex(ITEM_ID),
    kind: z.enum(['problem', 'exercise']),
    /** "I.5", or "I.BOOK" for a book-level item. */
    chapter: z.string(),
    scope: z.enum(['chapter', 'book', 'cross-book']).default('chapter'),
    variant: z.enum(VARIANTS),
    /** 1 mechanical · 2 composite · 3 research-adjacent (§5.4). */
    difficulty: z.number().int().min(1).max(3),
    title: z.string(),
    /** Proposition IDs the item draws on. */
    depends: z.array(z.string()).default([]),
    /** Chapter IDs in EARLIER books, for cross-book items. */
    reachesBack: z.array(z.string()).default([]),
    /** Rounding convention, stated once per solution (R-6). */
    rounding: optionalText,
    /**
     * §12.2 — no answer-less items ship. A hidden solution is a solution; a
     * missing one is an abandonment.
     */
    hasSolution: z.boolean().default(false),
    /** I-4: the reproduction snippet ran in CI and printed these digits. */
    verified: z.boolean().default(false),
    /** Path to the snippet under scripts/snippets, relative to that folder. */
    snippet: optionalText,
    status: shipStatus.default('draft'),
  }).superRefine((p, ctx) => {
    const shipped = p.status !== 'draft';

    if (shipped && !p.hasSolution) {
      ctx.addIssue({
        code: 'custom',
        message: `${p.id}: shipped with no solution. Elementa has no answer-less items (§5.5).`,
      });
    }

    // A problem that prints numbers must be machine-checkable (I-4).
    const numericish = ['numeric', 'complexity', 'probability', 'gradient'];
    if (shipped && numericish.includes(p.variant) && !p.verified) {
      ctx.addIssue({
        code: 'custom',
        message:
          `${p.id}: variant "${p.variant}" prints numbers, so it MUST carry a ` +
          `reproduction snippet and be marked verified: true (invariant I-4).`,
      });
    }
    if (p.verified && !p.snippet) {
      ctx.addIssue({
        code: 'custom',
        message: `${p.id}: marked verified but names no snippet. Nothing was run.`,
      });
    }
    if (p.scope === 'cross-book' && p.reachesBack.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: `${p.id}: scope "cross-book" but reachesBack is empty.`,
      });
    }
    // The ID's letter and the kind have to agree, or the quota counts wrongly.
    const letter = p.id.split('.').pop()![0];
    if ((p.kind === 'problem') !== (letter === 'B')) {
      ctx.addIssue({
        code: 'custom',
        message: `${p.id}: kind "${p.kind}" disagrees with the ID. Problems are B, exercises are X (§3.1).`,
      });
    }
    if (!p.id.startsWith(`${p.chapter}.`)) {
      ctx.addIssue({
        code: 'custom',
        message: `${p.id}: filed under chapter "${p.chapter}", which its ID does not name.`,
      });
    }
  }),
});

/**
 * Book 0 — the Apparatus (§16). A reference volume: Books I–VII link into it,
 * it links nowhere forward. An entry that only one chapter needs does not
 * belong here; it belongs in that chapter.
 */
const apparatus = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/apparatus' }),
  schema: z.object({
    /** "0.MC.07". */
    id: z.string().regex(/^0\.[A-Z]{2}\.\d{2}$/),
    part: z.enum(APPARATUS_CODES as unknown as [string, ...string[]]),
    order: z.number(),
    title: z.string(),
    /** The result itself, stated once. */
    statement: z.string(),
    /** Why the shapes conform. The line most readers actually came for. */
    shapeCheck: optionalText,
    /** One three-line instantiation. Never longer. */
    workedLine: optionalText,
    status: shipStatus.default('review'),
  }).superRefine((e, ctx) => {
    if (!e.id.startsWith(`0.${e.part}.`)) {
      ctx.addIssue({
        code: 'custom',
        message: `${e.id}: filed under part "${e.part}", which its ID does not name.`,
      });
    }
  }),
});

/**
 * §5.6 — the global symbol registry. Inconsistent notation is the single
 * largest source of confusion in machine-learning writing, so d_k means the
 * same thing in Book I and Book VI, and the build says so.
 */
const notation = defineCollection({
  loader: file('./src/content/notation.yaml'),
  schema: z.object({
    id: z.string(),
    symbol: z.string(),
    meaning: z.string(),
    /** Scalar, vector, matrix, tensor, set, operator (the §5.6 conventions). */
    kind: z.enum(['scalar', 'vector', 'matrix', 'tensor', 'set', 'operator', 'random']),
    /** Chapter ID that introduces it. Nothing may use it earlier. */
    introducedIn: z.string(),
    /** Apparatus anchor where it is defined properly. */
    apparatus: optionalText,
  }),
});

const elementa = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/elementa' }),
  schema: z.object({
    // References, so a proposition pointing at a chapter or a prerequisite
    // that does not exist fails the build rather than rendering a dead link.
    chapter: reference('chapters'),
    proposition: z.number(),
    statement: z.string(),                   // the claim, asserted
    /** One or two sentences stating the claim plainly. */
    claim: z.string().optional(),
    given: z.array(reference('elementa')).default([]),
    /** Primary papers and references behind the proposition. */
    sources: z
      .array(z.object({ title: z.string(), url: optionalUrl }))
      .default([]),
    figure: z.string().nullable().default(null), // figure component name
    /** §9 — which of the eight kinds of drawing this is. */
    figureType: z.enum(FIGURE_TYPES).optional(),
    /**
     * §4 — where the proposition sits. Intuition holds a true simplification,
     * mechanics builds the thing, research is what happens past the textbook.
     */
    level: z.enum(['intuition', 'mechanics', 'research']).default('mechanics'),
    /** Symbols this proposition uses, checked against the registry (§5.6). */
    notation: z.array(z.string()).default([]),
    /** Book 0 anchors this proposition leans on. */
    apparatus: z.array(z.string()).default([]),
    status: shipStatus,
    updated: z.date(),
  }),
});

/**
 * The commonplace book: reviews and notes. Kept deliberately flat — no
 * tags, no categories, no pagination, no search.
 */
const marginalia = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/marginalia' }),
  schema: z.object({
    entry: z.number(),                       // running folio number
    kind: z.enum(['book', 'paper', 'model', 'essay', 'note']),
    title: z.string(),
    subject: z.string(),                     // what is under review
    summary: z.string(),                     // one line, shown in the index
    status: z.enum(['draft', 'published']),
    updated: z.date(),
    source: optionalUrl,
    sourceLabel: z.string().optional(),
    /**
     * A drawing for the entry, from the same registry the Elementa uses. A
     * review of a model is mostly an argument about how the thing is put
     * together, and those arguments are far shorter as a picture.
     */
    figure: z.string().nullable().default(null),
    /** Papers, weights, code. Rendered as a list under the entry. */
    links: z
      .array(z.object({ title: z.string(), url: optionalUrl }))
      .default([]),
  }),
});

/**
 * Lectiones — the reading course. Marginalia II.
 *
 * Marginalia I is what I thought of something after reading it. This is the
 * other half: what somebody else should read, in what order, and what to take
 * from each one. It is published in parts, three to five papers each, because
 * a reading list of sixty papers is a thing people bookmark and never open.
 *
 * A paper appears in exactly one part. The temptation is to repeat the
 * important ones — Attention Is All You Need belongs to the Transformer, to
 * efficient inference and to modern architecture all at once — but a list that
 * repeats itself reads as padding, and the reader cannot tell whether they
 * have already done the work. Later parts point back instead.
 */
const lectiones = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/lectiones' }),
  schema: z.object({
    /** Part number. Sets the URL, the numeral, and the reading order. */
    part: z.number().int().min(1),
    title: z.string(),
    /** One line under the title, saying what the part is for. */
    gloss: z.string(),
    /** One line in the index. */
    summary: z.string(),
    status: z.enum(['draft', 'published']).default('draft'),
    updated: z.date(),
    /**
     * Capped at five deliberately. The cap is the whole design of the series:
     * a part is meant to be a week of reading, not a syllabus.
     */
    readings: z
      .array(
        z.object({
          /** What it is called in conversation — "AlexNet", "RoPE". */
          alias: z.string(),
          title: z.string(),
          authors: z.string(),
          year: z.string(),
          venue: z.string().optional(),
          url: optionalUrl,
          /** What the paper actually claims, in one sentence. */
          claim: z.string(),
          /** Why it is on the list rather than merely famous. */
          why: z.string(),
          /** What to read closely and what to skim. Optional. */
          readFor: z.string().default(''),
        })
      )
      .min(1)
      .max(5),
  }),
});

/**
 * Bibliotheca — Marginalia III. The books behind the course.
 *
 * A separate collection from `lectiones` rather than a field on it, because
 * they answer different questions and mixing them would spoil both. A part of
 * the Lectiones is a week of *papers*, capped at five, read in an order that
 * matters. A book is not read that way and does not belong to one week: the
 * same textbook sits under six parts at once, and putting it inside any of
 * them would be a lie about how it gets used.
 *
 * Not to be confused with `books`, which is the Elementa's own volumes. This
 * one is other people's.
 */
const bibliotheca = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/bibliotheca' }),
  schema: z.object({
    /** Position on its shelf. Ties are broken by title, so it need not be dense. */
    order: z.number().int().min(1).default(1),
    title: z.string(),
    /** Written out as on the cover, so a reader can search for the thing. */
    authors: z.string(),
    year: z.string().default(''),
    /**
     * Which shelf it stands on. An enum rather than free text: the page groups
     * by this, and two spellings of "causality" would silently become two
     * shelves with one book each.
     */
    shelf: z.enum(['foundations', 'deep-learning', 'causality', 'decisions']),
    /** Two lines. What the book is, and why it is on the shelf. */
    note: z.string(),
    /** Where to read it. */
    url: optionalUrl,
    status: z.enum(['draft', 'published']).default('published'),
  }),
});

/**
 * Editable page prose. These exist as content rather than as JSX so they can
 * be changed from /admin without touching the codebase.
 */
const site = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/site' }),
  schema: z.object({
    title: z.string(),
    dropCap: z.boolean().default(false),
    // Frontispiece-only fields.
    role: z.string().optional(),
    epigraph: z.string().optional(),
    attribution: z.string().optional(),
    location: z.string().optional(),
    /**
     * The landing page's own copy. `role` is the long scholarly line the Summa
     * uses; `tagline` is the short one a visitor reads in two seconds, and it
     * leads with the engineering because that is what the page is for.
     */
    tagline: z.string().optional(),
    /** What is being worked on now, and when that was last true. */
    now: z.string().optional(),
    nowLabel: z.string().optional(),
    /**
     * The things actually running, one line each. A list rather than a longer
     * `now` paragraph: four projects in one block of display type reads as a
     * wall, and the count is itself the point — it is the difference between
     * "working on something" and "running four things at once".
     */
    nowItems: z
      .array(z.object({
        label: z.string(),
        detail: z.string(),
        href: z.string().optional(),
      }))
      .default([]),
    /**
     * The evidence strip. Hand-picked rather than derived: the point is the
     * three or four facts worth a stranger's first ten seconds, and no query
     * knows which those are.
     */
    highlights: z
      .array(z.object({
        value: z.string(),
        label: z.string(),
        href: z.string().optional(),
      }))
      .default([]),
    // Instrumentarium closing line.
    notYet: z.string().optional(),
    // Chronicle.
    coursework: z.string().optional(),
    // Contact block. The single source for the address, the colophon links
    // and the generated CV.
    email: z.string().optional(),
    github: optionalUrl,
    linkedin: optionalUrl,
    // Elementa ledes.
    kicker: z.string().optional(),
    lede: z.string().optional(),
    homeIntro: z.string().optional(),
    // CV singleton.
    summary: z.string().optional(),
    languages: z.string().optional(),
    /** Reading and research interests, one paragraph. Shown under Additional. */
    interests: z.string().optional(),
  }),
});

/**
 * The interleaved artwork. Called tabulae rather than plates so the numbering
 * does not collide with the four research plates in `works`.
 *
 * Images live in src/assets/plates and are declared with image(), so Astro
 * optimises whatever gets uploaded through /admin.
 */
const art = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/art' }),
  schema: ({ image }) =>
    z.object({
      // Sort key only. The Roman numeral shown on the page comes from the
      // entry's position in the sorted list, so gaps never appear as
      // missing plates and you can renumber freely.
      order: z.number(),
      title: z.string(),
      artist: z.string(),
      date: z.string(),
      image: image(),
      alt: z.string().optional(),
      gloss: z.string(),
      credit: z.string().default('Art Institute of Chicago \u00b7 CC0'),
      source: optionalUrl,
      // Line art prints onto the page with a blend mode; a photographed
      // object cannot, and gets a duotone instead.
      treatment: z.enum(['intaglio', 'photograph']).default('intaglio'),
      side: z.enum(['left', 'right']).default('right'),
      /**
       * Where the plate sits on the home page: 1 appears first, beside the
       * name, then 2, 3 and so on down the scroll. Only consulted when
       * onHome is true. Gaps and duplicates are harmless — the plates are
       * sorted by this and laid into the available positions in turn.
       */
      homePosition: z.number().default(99),
      onHome: z.boolean().default(true),
      status: z.enum(['draft', 'published']).default('published'),
    }),
});

/** The instrument plate: skill groups, each a numbered figure. */
const instrumentarium = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/instrumentarium' }),
  schema: z.object({
    order: z.number(),
    title: z.string(),
    note: z.string(),
    items: z.string(),
  }),
});

/**
 * Referees.
 *
 * A collection rather than a field on the CV entry, because the proof sheet
 * gives every *item* its own include switch — so one referee can be left off a
 * particular copy of the CV without editing anything, which is the whole
 * reason for asking. A paragraph would have been one switch for all of them.
 *
 * No phone numbers. The generated PDF is served from a public URL, and a
 * referee's number on a public page is a different exposure from one on a
 * document handed to a person — and it is not the author's to publish.
 */
const referees = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/referees' }),
  schema: z.object({
    order: z.number().int().min(1).default(1),
    name: z.string(),
    role: z.string().optional(),
    affiliation: z.string().optional(),
    email: z.string().optional(),
    note: z.string().optional(),
  }),
});

/** Architectures and losses written from scratch. */
const instrumenta = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/instrumenta' }),
  schema: z.object({
    order: z.number(),
    name: z.string(),
    problem: z.string(),
    decision: z.string(),
    rejections: z.array(z.string()).default([]),
  }),
});

/**
 * Published papers and manuscripts. Separate from `works`: a plate is a
 * research project with a chapter behind it, a paper is a citable artefact
 * with a link.
 */
const papers = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/papers' }),
  schema: z.object({
    title: z.string(),
    authors: z.array(z.string()).default([]),
    venue: z.string().optional(),
    year: z.string(),
    state: z.enum(['published', 'preprint', 'under-review', 'in-preparation']),
    url: optionalUrl,
    doi: z.string().optional(),
    summary: z.string(),
    status: z.enum(['draft', 'published']).default('published'),
  }),
});

/**
 * Scoping reviews in progress.
 *
 * Kept apart from `papers` because a protocol is not a manuscript and saying
 * otherwise on a page headed "the record" would overstate it. What a review at
 * this stage has to show is its method — the framework it reports under, the
 * registry it will be filed with, the instrument it scores on — and none of
 * that fits the `papers` schema without being flattened into prose.
 *
 * Every field here is a fact with a short answer. That is deliberate: a review
 * in protocol stage is interesting for what it commits to, and a paragraph
 * about it would be longer than the commitments.
 */
const reviews = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/reviews' }),
  schema: z.object({
    order: z.number().int().min(1).default(1),
    title: z.string(),
    /** The field, in a few words. Read as a label, not a sentence. */
    domain: z.string(),
    /** One line: what the review maps. */
    question: z.string(),
    /** The reporting guideline. PRISMA-ScR for a scoping review. */
    framework: z.string(),
    /** Where it will be registered. */
    registry: z.string().default(''),
    /**
     * Honest about where it actually is. `protocol` and `registered` are
     * different claims and the site must not blur them — nothing is registered
     * until it is.
     */
    stage: z.enum(['protocol', 'registered', 'screening', 'charting', 'drafting']),
    /** The scoring instrument, if the review has one of its own. */
    instrument: optionalText,
    /** One line of scale — records piloted, databases searched. */
    scale: optionalText,
    /** The project it supports. */
    related: z.string().optional(),
    relatedLabel: z.string().optional(),
    status: z.enum(['draft', 'published']).default('published'),
  }),
});

/**
 * The library — papers added through /admin and indexed by ResearchLens.
 *
 * The PDF itself is committed to the repository and served from this origin,
 * and the manifest at /library.json points at it. The retrieval system fetches
 * that manifest, downloads what it has not seen, and parses it — the same path
 * a reader's own upload already takes, which is why this needed a manifest
 * rather than a new ingestion pipeline.
 *
 * A note on what this does and does not do: adding a paper makes it findable
 * and quotable, with every claim still bound to a passage. It does not train
 * anything. That is the property worth having — a paper added now is
 * answerable now, and nothing it says can reach a reader without a citation
 * pointing at the page it came from.
 */
const library = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/library' }),
  schema: z.object({
    order: z.number().int().min(1).default(1),
    title: z.string(),
    authors: z.string().default(''),
    year: z.string().default(''),
    /**
     * Path to the committed PDF, written by the editor's file picker. A
     * repository is a poor home for large binaries, so this is for papers
     * worth carrying rather than for a whole reading pile.
     */
    pdf: z.string(),
    /** One line on why it is in the library. Optional. */
    note: optionalText,
    status: z.enum(['draft', 'published']).default('published'),
  }),
});

/** Education, read by both the vitae page and the generated CV. */
const education = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/education' }),
  schema: z.object({
    order: z.number(),
    degree: z.string(),
    institution: z.string(),
    location: z.string(),
    period: z.string(),
    detail: z.string().default(''),
    /**
     * Grades. Kept apart from `detail` because they appear on the CV and the
     * vitae page but not in the Chronicle on the home page — a timeline reads
     * better without them, and they belong where someone is assessing you.
     */
    result: z.string().optional(),
  }),
});

/** Engineering work, shown in the Appendix and on the CV. */
const projects = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/projects' }),
  schema: z.object({
    order: z.number(),
    title: z.string(),
    summary: z.string(),
    /** Kept short on the CV, fuller in the Appendix. */
    cvSummary: z.string().optional(),
    /**
     * Where the project can be opened or read. A project with somewhere to go
     * gets a button in the Appendix; one without stays a paragraph, which is
     * the right treatment for work that has no public surface.
     */
    link: z.string().optional(),
    linkLabel: z.string().optional(),
    /**
     * The source, separately from `link`.
     *
     * Two different promises, and conflating them cost the site the more
     * useful one: `link` is somewhere to *use* the thing, and for LocalScholar
     * — which has no hosted demo — that field held a GitHub URL, so the only
     * project pointing at code did it through the field meaning "open this".
     * A reader who has just read how a thing works wants to read how it is
     * written, and that was a dead end on three of five projects.
     */
    repo: z.string().url().optional(),
    /**
     * Whether this belongs in "Systems that run" on the frontispiece.
     *
     * A flag rather than the regular expression over ids that used to select
     * them, which read `/researchlens|localscholar/i` and silently answered no
     * for anything added afterwards — including the third one, which is how
     * this got noticed. A project that should be there now says so, and says
     * it where the other facts about it live.
     */
    system: z.boolean().default(false),
  }),
});

/**
 * Photographs. Separate from `art`, which is the interleaved plate material
 * with its own treatments and placements — these are simply pictures, shown
 * as they are, with a caption and an optional note.
 */
const images = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/images' }),
  schema: ({ image }) =>
    z.object({
      order: z.number().default(1),
      image: image(),
      caption: z.string(),
      about: z.string().optional(),
      alt: z.string().optional(),
      credit: z.string().optional(),
      status: z.enum(['draft', 'published']).default('published'),
    }),
});

/** The five maxims. Each carries the project it came from. */
const axioms = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/axioms' }),
  schema: z.object({
    order: z.number(),
    text: z.string(),
    cite: z.string(),
  }),
});

export const collections = {
  works, elementa, marginalia, lectiones, bibliotheca, reviews, library, site, art, books, instrumentarium,
  referees,
  instrumenta, papers, education, projects, images, axioms, chapters,
  problems, apparatus, notation,
};
