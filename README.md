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
| `/imagines` | Photographs, with captions and optional notes |
| `/papers` | Published papers and manuscripts, with links |
| `/tabulae` | The plate gallery — artwork, each with a note |
| `/tabulae/[slug]` | One plate, with its historical background |
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
| Plates | Research plates — add, edit and delete |
| Axioms | The five maxims and their marginal cites |
| Imagines | Photographs — upload, caption, optional note |
| Papers | Published papers and manuscripts — add one, paste the link |
| Education | Degrees, shown on the Vitae page and in the CV |
| Engineering projects | Shown in the Appendix and on the CV |
| Tabulae | Artwork — upload an image and write its history |
| Elementa books | The books propositions are filed under — add your own |
| Instrumentarium | The skill groups on the home page |
| Instrumenta propria | Architectures and losses written from scratch |
| Site text | The Prologue, the colophon, the frontispiece epigraph and role line |

Images have two destinations, on purpose:

- **Pictures inside a review** go to `public/uploads/` and are referenced as
  `/uploads/<name>`. Framed like a plate by `.prose img`.
- **Artwork in the Tabulae collection** goes to `src/assets/plates/` with a
  path relative to the entry, so Astro optimises it into a responsive WebP
  set. That is what the collection-specific `media_folder` in `config.yml`
  is for; do not "simplify" it to an absolute path or the optimisation stops.

### Tabulae, and why they are not called plates

The four research entries in `works` are Plates I–IV. The artwork is numbered
too, so calling both "plate" collided. The artwork is *tabulae* — the term
engraved atlases use — and lives at `/tabulae`.

Each entry carries a `treatment`: `intaglio` for line art, which prints onto
the page with a blend mode so the paper white becomes vellum, or `photograph`
for objects, which are toned instead. **Choosing `intaglio` for a photograph
will render it nearly black.**

Two numbers, doing different jobs. **Plate order** is the gallery sequence and
sets the Tabula numeral. **Position on the home page** is where it falls on
the front page: 1 sits beside the name, 2 next, and so on.

To put a plate between two others, use a half. `3.5` lands it straight after
3 and pushes everything below down. Typing a number another plate already
holds is not an error, but the plate already there stays in front — the half
is what actually inserts.

`npm run tidy:plates` renumbers everything back to 1, 2, 3… so the number you
type matches the position you see. Worth running after hiding a few plates,
which otherwise leaves holes: hide four and the plate showing fourth might
still be stored as 8.

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

### New entries appear on their own

Astro's glob loader fixes its file list when the dev server boots and never
rescans, so a newly created entry would otherwise stay invisible until a
restart. `npm run dev` therefore runs `scripts/dev-auto.mjs`, which watches
`src/content/` and restarts the server only when the *set* of files changes.

| Action | What happens |
|---|---|
| Edit an existing entry | Hot-reloads. No restart — Astro already handles it. |
| Add a new entry | Restart, automatically. Visible in ~5s. |
| Delete an entry | Restart, automatically. Gone in ~2s. |

`npm run dev:plain` is the unwrapped `astro dev` if you ever want it.

**In production none of this applies.** The CMS commits to GitHub, Cloudflare
runs `npm run build` from a fresh checkout, and a cold build has no stale file
list. Verified by cloning the repo and building from scratch. If you ever
suspect a stale content cache, `npx astro build --force` clears it.

### The CV regenerates itself

`public/cv/Md-Asif-Uddin-CV.pdf` is built by `scripts/build-cv.mjs` before
every `astro build`, reading the same content collections the site renders —
education, works, papers, instrumentarium, projects, and the CV summary under
Site text. Edit anything in `/admin` and the next deploy ships a matching CV.
It is gitignored, because it is an artefact rather than source.

Two deliberate choices in it:

- **No phone number.** Your CV has one; this file is served publicly, which is
  a different exposure from a CV handed to a person. Add `PHONE` to
  `src/consts.ts` and the masthead line in the script if you want it.
- **No results.** Research entries carry the title and what the work does.
  Metrics live on the plate, where the caveats are next to them.

### Adding a book to the Elementa

Books are a collection, not a fixed list. Add one under **Elementa books**
first — causal inference, bioinformatics, whatever — and it appears in the
Book dropdown when you write a proposition. A proposition pointing at a book
that does not exist fails the build rather than rendering a blank heading.

### One thing the CMS cannot do

**Add a figure.** Figures are hand-written SVG diagrams, not uploads; a new
one needs a developer. The `Figure` dropdown lists what is registered in
`src/lib/figures.ts`. Artwork is different — that is Tabulae, and you can add
as much of it as you like.
That is the only one. Everything else — plates, tabulae, books, marginalia,
propositions, the home-page sections — can be added and deleted from `/admin`.

### Where the Compendium comes from

The Compendium on the home page has no collection of its own — it renders the
**Plates**. Add or edit a plate and its card appears there, on the Vitae page
and in the CV. The same holds for the Chronicle, which renders **Education**,
and the Appendix, which renders **Engineering projects**.

Every section of the home page is CMS-backed. Nothing on it needs a code
change any more.

### There are no roles

Sveltia has no permission system. "Disabled by the administrator" is a
`create: false` flag in `config.yml`, not a role check. Whoever can sign in
has full write access to the repository, which is why the token should be
fine-grained and scoped to this repo alone.

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
| `npm run check:cms` | Parses config.yml; checks folders and relations resolve |
| `npm run cv` | Regenerates the CV PDF on its own |
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
