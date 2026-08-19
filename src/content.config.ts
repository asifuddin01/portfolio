import { defineCollection } from 'astro:content';
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

const elementa = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/elementa' }),
  schema: z.object({
    book: z.number().min(1).max(4),
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
      onHome: z.boolean().default(true),
      status: z.enum(['draft', 'published']).default('published'),
    }),
});

export const collections = { works, elementa, marginalia, site, art };
