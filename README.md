# The Codex — personal research portfolio

A printed scientific treatise, rendered as a website. Numbered plates, figure
captions, marginal annotations and a colophon, because that is the native
publishing register of medical imaging.

Built with **Astro 7**, MDX, Tailwind 4 and TypeScript (strict). Zero client-side
framework; every interactive piece is a small vanilla script.

```bash
npm install
npm run dev        # http://localhost:4321
npm run verify     # build + a11y audit + contrast check + typecheck
```

## Routes

| Route | What it is |
|---|---|
| `/` | The scroll — eleven numbered chapters, condensed |
| `/works/[slug]` | One research plate, full chapter (4 entries) |
| `/elementa` | Index of the teaching corpus |
| `/elementa/[slug]` | One proposition |
| `/elementa/figures` | The reusable figure library, with copy-SVG |
| `/marginalia` | The commonplace book — reviews and notes |
| `/marginalia/[slug]` | One entry |
| `/vitae` | Printable CV (`@media print` styles included) |

## The disclosure guard — read this before editing a plate

Three of the four plates hold unpublished results. `src/content.config.ts`
carries a `superRefine` that **fails the build** if a plate marked
`disclosure: embargoed` also carries `metrics`.

This is deliberate. It puts the embargo in the data rather than in anyone's
memory. Do not soften it to a warning, and do not remove it. To confirm it still
works, add a metric to any embargoed plate and run `npm run build` — the build
must fail with `Plate N is embargoed and must not carry metrics.`

## Adding content

**A marginalia entry** (book review, model review, essay, note) — create
`src/content/marginalia/<slug>.mdx`:

```yaml
---
entry: 4                      # running number; highest shows first
kind: book                    # book | model | essay | note
title: The ladder is the argument
subject: Judea Pearl — The Book of Why
summary: One line, shown in the index.
status: published             # `draft` is hidden from production builds
updated: 2026-08-20
source: null                  # or a URL
---
```

**A proposition** — create `src/content/elementa/book-<n>-prop-<m>.mdx`. Every
proposition needs a figure; register the component in `src/lib/figures.ts` and
name it in the `figure` frontmatter field. If the figure cannot be drawn, the
proposition is not ready to be written.

**A figure** — add an `.astro` component under `src/components/figures/` using
palette tokens only (never a hardcoded black or white, so it reads in both
themes), then register it in `src/lib/figures.ts` to give it a permalink.

## Design system

All colour, type scale and rhythm live in `src/styles/tokens.css`. **No hex
codes anywhere else in the codebase.** Modes switch on `data-theme="nocturne"`.

Three contrast corrections were required to clear the quality floor, and are
documented in the header of `tokens.css`: `--fundus` was darkened in Vellum, and
`--brass-text` / `--oxblood-text` exist as text-safe partners to `--brass` and
`--oxblood` (which stay verbatim for rules, borders and marks). Run
`npm run contrast` after touching any colour.

## Motion

Everything that moves lives in `src/styles/motion.css`, driven by
`src/scripts/motion.ts`. Two rules matter:

1. **Every hiding rule is scoped to `html.js`**, a class set by the inline head
   script. With no JS the page renders fully visible instead of blank.
2. **Above-the-fold content uses `data-intro`**, a pure-CSS animation. It must
   never wait on the IntersectionObserver — doing so held the hero at
   `opacity: 0` until the module booted and cost ~2.6s of Largest Contentful
   Paint.

Everything is inside `@media (prefers-reduced-motion: no-preference)`.

## Artwork

Nine public-domain works (CC0) from the Art Institute of Chicago, in
`src/assets/plates/`, with attribution in `src/lib/plates.json`. Engravings are
printed onto the page with a blend mode (`intaglio`); photographed objects get a
duotone instead. Re-fetch with `npm run plates`.

## Scripts

| Command | Does |
|---|---|
| `npm run verify` | build → audit → contrast → typecheck |
| `npm run audit` | heading order, alt text, landmarks, self-hosting |
| `npm run contrast` | WCAG ratios for every token pair, both themes |
| `npm run plates` | re-download the artwork |
| `npm run og` | regenerate `public/og.png` |

## Still to supply

Marked `[SUPPLY]` in the content files:

- The four paper abstracts, verbatim.
- Citations and paper URLs, once published.
- Repository URLs.
- Elementa propositions beyond the three Book I seeds.

The three `src/content/marginalia/*.mdx` entries are **seeds written to
demonstrate the format** — edit or replace them with your own.

Set the real domain in `src/consts.ts` (`SITE`) before deploying; it drives
canonical URLs, the sitemap and Open Graph tags.
