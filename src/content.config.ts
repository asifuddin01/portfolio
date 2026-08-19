import { defineCollection } from 'astro:content';
import { z } from 'zod';
import { glob } from 'astro/loaders';

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
    citation: z.string().nullable().default(null),
    paperUrl: z.url().nullable().default(null),
    repoUrl: z.url().nullable().default(null),
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
        message: `Plate ${data.plate} is embargoed and must not carry metrics.`,
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
    source: z.url().nullable().default(null),
  }),
});

export const collections = { works, elementa, marginalia };
