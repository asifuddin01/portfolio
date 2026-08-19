import { defineCollection, reference } from 'astro:content';
import { z } from 'zod';
import { glob } from 'astro/loaders';

/**
 * Clearing an optional field in /admin writes an empty string rather than
 * removing the key, and an empty string is not a valid URL. Without these,
 * the first time anyone blanked a paper link the build would fail.
 */
const optionalUrl = z
  .union([z.url(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

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
    status: z.enum(['deposited', 'in-preparation', 'proposal-accepted']),
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
    order: z.number(),
    title: z.string(),
    covers: z.string(),
  }),
});

const elementa = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/elementa' }),
  schema: z.object({
    // A reference, so a proposition pointing at a book that does not exist
    // fails the build instead of rendering a blank heading.
    book: reference('books'),
    proposition: z.number(),
    statement: z.string(),                   // the claim, asserted
    given: z.array(z.string()).default([]),  // slugs of prerequisite props
    figure: z.string().nullable().default(null), // figure component name
    status: z.enum(['draft', 'published']),
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
    kind: z.enum(['book', 'model', 'essay', 'note']),
    title: z.string(),
    subject: z.string(),                     // what is under review
    summary: z.string(),                     // one line, shown in the index
    status: z.enum(['draft', 'published']),
    updated: z.date(),
    source: optionalUrl,
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
    // Instrumentarium closing line.
    notYet: z.string().optional(),
    // CV singleton.
    summary: z.string().optional(),
    languages: z.string().optional(),
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
       * Which chapter the plate follows on the home scroll. `frontispiece`
       * puts it beside the name; `none` keeps it in the gallery only. Two
       * plates claiming the same slot is harmless — the first one wins.
       */
      placement: z
        .enum([
          'frontispiece', 'prologue', 'axioms', 'instrumentarium',
          'compendium', 'instrumenta', 'elementa', 'marginalia',
          'chronicle', 'appendix', 'correspondence', 'none',
        ])
        .default('none'),
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

export const collections = {
  works, elementa, marginalia, site, art, books, instrumentarium, instrumenta,
  papers, education, projects, images,
};
