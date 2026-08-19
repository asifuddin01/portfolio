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
| `/admin` | Content manager — write and publish from the browser |

## The disclosure guard — read this before editing a plate

Three of the four plates hold unpublished results. `src/content.config.ts`
carries a `superRefine` that **fails the build** if a plate marked
`disclosure: embargoed` also carries `metrics`.

This is deliberate. It puts the embargo in the data rather than in anyone's
memory. Do not soften it to a warning, and do not remove it. To confirm it still
works, add a metric to any embargoed plate and run `npm run build` — the build
must fail with `Plate N is embargoed and must not carry metrics.`

## Editing the site

Everything you publish routinely is edited at **`/admin`** in the browser. No
files, no terminal.

Sveltia CMS commits MDX straight into this repository, so what you edit *is*
what the site builds from — there is no separate database, and the whole history
is in git. Saving triggers a Cloudflare Pages rebuild; the change is live in a
minute or two.

What you can edit there:

| Section | What |
|---|---|
| Marginalia | Book reviews, model reviews, essays, notes — with image upload |
| Elementa | Propositions, including the `Given` dependency links |
| Plates | Abstracts, citations, paper and repo links, results |
| Site text | The Prologue, and the frontispiece epigraph and role line |

Images uploaded through the editor land in `public/uploads/` and are referenced
as `/uploads/<name>`. They are framed like a plate by `.prose img`.

### Signing in

Two options; the CMS offers both on its login screen.

1. **Access token** — no infrastructure. In GitHub, create a fine-grained
   personal access token scoped to this repository only, with
   *Contents: read and write*. Paste it into **Sign In Using Access Token**.
   Stored in that browser only.
2. **Sign in with GitHub** — a real button. Deploy the OAuth broker in
   `worker/`, register a GitHub OAuth App, then uncomment `base_url` in
   `public/admin/config.yml`. Setup is in the deployment guide.

`local_backend: true` is also set, so running `npm run dev` and opening
`/admin` lets you edit the files on disk directly with no login at all.

### Two things the CMS cannot do

- **Add a figure.** Figures are hand-written SVG components; a new one needs a
  developer. The `Figure` dropdown lists what is registered in
  `src/lib/figures.ts`.
- **Add or delete a plate.** Plate numbers drive the whole compendium, so the
  Plates collection is edit-only by design.

### If a save does not appear on the site

The build refused it. That is the guard below doing its job, and Cloudflare
keeps serving the last good version in the meantime — the site never breaks.
Check the Pages build log for the reason.

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

All of the above are editable at `/admin` — none of it needs a code change.

The three marginalia entries are **seeds written to demonstrate the format** —
edit or replace them from `/admin`.

Set the real domain in `src/consts.ts` (`SITE`) before deploying; it drives
canonical URLs, the sitemap and Open Graph tags.
