# Design audit evidence

Evidence was gathered from the live site, a production build, representative desktop (1440 × 900) and mobile (390 × 844) browser views, and the source cited below. Runtime numbers are measurements, not estimates, unless marked otherwise.

## Structural evidence {#structural}

- **Interactive elements:** 45 on the built Frontispiece: 41 anchors, 3 buttons, and 1 input. The global shell contributes the wordmark, eight primary links, search, theme, and six footer links (`src/components/layout/Header.astro:15-37`, `src/consts.ts:30-39`, `src/components/layout/Colophon.astro:11-27`); page actions and evidence links occupy `src/pages/index.astro:57-250`.
- **Primary component depth:** four nodes / three edges at the deepest shell path: `index.astro` → `BaseLayout` → `Header` → `SearchDialog` or `ThemeToggle` (`src/pages/index.astro:3-5`, `src/layouts/BaseLayout.astro:16-22,126`, `src/components/layout/Header.astro:2-3,35-36`).
- **Repeated destinations:** 8 repeated-href groups, 18 link instances in the built Frontispiece. `/researchlens` appears four times; `/home`, the GitHub profile, `/vitae/cv`, three work routes, and `/papers#reviews` each appear twice. The duplication is visible across the hero/evidence/Now/systems/Summa regions (`src/pages/index.astro:70-98,103-160,237-250`) and footer (`src/components/layout/Colophon.astro:16-27`).
- **Dead props / unused imports:** 0 in the audited component path. Source inspection found every import consumed, and `astro check` completed with 0 errors and 0 warnings (one unrelated deprecation hint).
- **Content density:** 7 main Frontispiece sections, 6 ornamental separators plus the footer separator, about 1,125 main-content words, and 45 interactive elements (`src/pages/index.astro:56-250`).
- **Home-model split:** the first navigation item points to `/`, while the name points to `/home`; comments explicitly describe two different starts (`src/components/layout/Header.astro:17-30`, `src/pages/index.astro:10-22`).

## Visual evidence {#visual}

- **Type scale:** 11, 13, 14, 16, 19, 24, 32, 44, and 64px, with a 19px body size. It is centrally declared and used across the shell (`src/styles/tokens.css:39-67`).
- **Spacing observed:** 3.2, 4, 5.6, 8, 12.8, 13.6, 14.4, 16, 17.6, 19.2, 20, 24, 32, 48, 64, 80, and up to 144px responsive chapter spacing. Gutter and chapter rhythm are tokenized, but component-local values are more numerous (`src/styles/tokens.css:64-70`, `src/components/layout/Header.astro:48-90`, `src/pages/index.astro:318-360`).
- **Color count:** 23 unique hexadecimal tokens across Vellum, Nocturne, and the five data colors. Core colors, type, measure, rhythm, and motion curves have one source (`src/styles/tokens.css:19-92`).
- **Lowest primary-text contrast:** 4.73:1, `--oxblood-text` on Nocturne `--paper-raised`; all audited text-token/background pairs pass WCAG AA. The intended correction is documented at `src/styles/tokens.css:5-16` and independently confirmed by `npm run contrast`.
- **Responsive chrome:** desktop header height is 63px. At 390 × 844 it becomes 185.5px (22% of the viewport) and the eight-link navigation wraps into two rows. Link hit boxes measure 17px high, search 19 × 19px, and theme 82.5 × 21.6px; the wrap and small type originate at `src/components/layout/Header.astro:48-90` and `src/styles/tokens.css:49-61`.
- **System coherence:** the book-like typography, restrained rules, palette, and bespoke explanatory figures visibly belong to one family (`src/styles/tokens.css:19-92`, `src/components/front/DescentPlate.astro:130-200`, `src/components/elementa/NetworkPlate.astro:203-280`).
- **States checklist:** empty — present (`SearchDialog.astro:168-173,210-214`); loading — present (`SearchDialog.astro:175-176`); error — present (`SearchDialog.astro:180-183`, `src/pages/researchlens.astro:913-963`); success — present as rendered search/answer results (`SearchDialog.astro:186-214`, `src/pages/researchlens.astro:1026-1139`); focus — present (`src/styles/global.css:105-111`); disabled — present (`src/pages/researchlens.astro:315,1454-1455`).
- **Mobile motion reproduction and repair:** before the patch, Elementa's loop was coupled to `.js .is-revealed`; on mobile the plate begins 1,387px below the top and remained static until that separate observer path succeeded. After the patch, a 390 × 844 test sampled `np-fwd` while `is-revealed=false`: its dash offset changed from `0` to `-3.7462px` in 900ms. Frontispiece changed trace/head/end state over 850ms. The independent loops and explicit reduced-motion states are at `src/components/front/DescentPlate.astro:245-310` and `src/components/elementa/NetworkPlate.astro:311-437`.

## Copy and honesty evidence {#copy-honesty}

### User-facing string inventory

Continuous prose blocks are grouped as one string; dynamic collection entries are cited at their render site.

- **Global shell:** author name (`src/consts.ts:4`); “Frontispiece”, “Elementa”, “Papers”, “Tabulae”, “Marginalia”, “ResearchLens”, “Vitae”, “Officina” (`src/consts.ts:30-39`); “Search the site”, “Search the book”, placeholder, “Close search”, “Searching…”, local-index error, empty/result counts (`src/components/layout/SearchDialog.astro:23-54,168-183,210-214`); “Vellum” / “Nocturne” (`src/components/layout/ThemeToggle.astro:5-7,29-34`); email, “github”, “linkedin”, “curriculum vitae”, “imagines”, “feed” (`src/components/layout/Colophon.astro:16-27`).
- **Frontispiece:** title/role/tagline/epigraph/location/Now copy, four Now items, and five evidence claims (`src/content/site/frontispiece.mdx:2-38`); section labels and prose “Systems that run”, “Architectures built, not fine-tuned”, “What that takes, in practice”, “Research”, “The Summa”, plus all generated system/architecture/stack/work labels and CTAs (`src/pages/index.astro:103-250`); figure title, explanation, and legend (`src/components/front/DescentPlate.astro:130-143`).
- **Elementa:** “Elementa”, CMS lede, progress label, graph/figure links, generated book names/counts, Apparatus card, tier explanation/table labels (`src/pages/elementa/index.astro:62-181`); figure title/explanation and accessible SVG description (`src/components/elementa/NetworkPlate.astro:130-136,203-212`).
- **Papers:** “Published papers”, two introductory paragraphs, state labels, record/review/library headings, generated titles and links (`src/pages/papers/index.astro:13-110`).
- **ResearchLens:** product description, lede, pipeline labels, guarantees, examples, progress/status/error/result strings (`src/pages/researchlens.astro:119-160,197-225,776-817,913-1000,1026-1139`).
- **Vitae:** name, role, “Get the PDF”, contact details, research/paper/project/education/skill headings and generated entries (`src/pages/vitae.astro:22-90`).
- **Officina:** runtime/editor labels and explanatory prose, including external-runtime and privacy statements; download/example dialogs (`src/pages/officina.astro:140-198`).

### Flagged inflations or mismatches

- “found and fixed upstream” asserts completion while the linked MONAI change is still an open pull request; use “fix proposed upstream in PR #9096” until merged (`src/content/site/frontispiece.mdx:36-38`).
- “5 architectures designed and trained from scratch, not fine-tuned” is broader than the per-entry evidence; only RichAttentionUNet explicitly says no pretrained weights. State the count as “5 architectures/losses documented with their design decisions,” or add evidence to every entry (`src/content/site/frontispiece.mdx:33-35`, `src/content/instrumenta/richattentionunet.mdx:1-5`).
- ResearchLens says “every claim” and “cannot go stale”. Its enforcement is unusually strong, but absolutes outrun what a live external system can guarantee. Prefer “claims are linked to retrieved passages” and “fetched from the current site at question time” (`src/pages/researchlens.astro:119-129,197-213`).
- “Nothing here reaches a server. There is none” conflicts with the immediately preceding disclosure that CheerpJ loads from its vendor. Prefer “Your code and opened files never leave your browser; runtimes are downloaded when needed” (`src/pages/officina.astro:154-170`).
- “Published papers” contains published, preprint, under-review, and in-preparation records and then reviews/library material. “Papers and manuscripts” matches the actual behavior (`src/pages/papers/index.astro:22-45,57-110`).
- “Get the PDF” opens an HTML CV proof before download rather than returning a PDF. Use “View printable CV” or link directly to the generated PDF (`src/pages/vitae.astro:28-38`).
- Search is named “the site” on its trigger and “the book” in its dialog (`src/components/layout/SearchDialog.astro:23-52`).

### Jargon and dark patterns

- Plain-label recommendations: Frontispiece → Home; Elementa → AI course; Tabulae → Art & philosophy; Marginalia → Notes & reviews; Vitae → CV; Officina → Code notebook; Summa → Full portfolio. Keep the Latin names as secondary editorial subtitles (`src/consts.ts:30-39`, `src/pages/index.astro:237-250`).
- **Dark patterns:** 0. No forced continuity, hidden cost, fake scarcity, or confirmshaming was found.

## Weight and friction evidence {#weight-friction}

- **Initial JavaScript:** 24,466 bytes uncompressed on the production Frontispiece: 17,052 external bytes across three bundles plus 7,414 inline bytes across five scripts. Measured from `dist/index.html` after `npm run build`; entry points originate in `src/layouts/BaseLayout.astro:72-115,147-149`, `SearchDialog.astro:64-313`, `ThemeToggle.astro:29-58`, and `src/pages/index.astro:254-315`.
- **Initial network requests:** 14 estimated production requests: HTML, 2 CSS bundles, 3 JS bundles, 7 used font subsets, and favicon. Method: built-HTML asset references plus the seven font faces observed in the rendered primary view. Search data is correctly deferred until the dialog opens (`src/components/layout/SearchDialog.astro:11-15,97-125`).
- **Time to interactive:** 1,000ms estimated on a normal connection. Method: static HTML is complete before scripting, only 24.5KB initial JS is present, and primary native controls bind at DOM readiness; no lab throttling was available, so this is a directional number rather than a Core Web Vital.
- **Idle animation count:** 11 persistent loops on the Frontispiece after intro motion settles: 9 trace/head/end loops plus 2 ink-wash pseudo-elements (`src/components/front/DescentPlate.astro:264-299`, `src/styles/motion.css:194-205`). On fine pointers the cursor also runs a perpetual `requestAnimationFrame` loop (`src/scripts/motion.ts:111-159`).
- **Initial notifications / badges / modals:** 0 visible. One search dialog exists but is closed and lazy-loads its index (`src/components/layout/SearchDialog.astro:39-62,154-160`).
- **Resource protections:** no autoplay video; dark mode is explicit (`src/styles/tokens.css:76-92`); reduced motion stops CSS animation and runtime listeners (`src/styles/motion.css:265-282`, `src/scripts/motion.ts:219-230`).
- **Semantic friction:** the evidence counter replaces correct text with zero until animation completes or the item intersects, exposing temporarily false values to screenshots and some assistive paths (`src/pages/index.astro:254-315`).

## Accessibility evidence {#accessibility}

### Contrast

| Text token | Vellum paper / raised | Nocturne paper / raised | Result |
|---|---:|---:|---|
| ink | 13.69 / 15.29 | 13.77 / 12.68 | pass |
| ink-soft | 7.37 / 8.23 | 6.03 / 5.55 | pass |
| fundus | 4.83 / 5.39 | 6.88 / 6.33 | pass |
| brass-text | 5.27 / 5.89 | 7.54 / 6.94 | pass |
| oxblood-text | 8.47 / 9.46 | 5.14 / 4.73 | pass |
| verdigris | 6.24 / 6.97 | 6.66 / 6.13 | pass |

Values were produced by `npm run contrast`; token intent is documented at `src/styles/tokens.css:5-16`.

- **Focus order:** Skip to content → wordmark → eight primary-nav links → search → theme → hero GitHub → hero CV → five evidence links → Now links → system actions → deeper work/Summa actions → footer contact/social/CV/gallery/feed. This follows source order (`src/layouts/BaseLayout.astro:119-149`, `src/components/layout/Header.astro:15-37`, `src/pages/index.astro:54-250`, `src/components/layout/Colophon.astro:11-30`). Closed-dialog controls are correctly removed from the initial tab order by native `<dialog>` behavior.
- **Keyboard reachability:** yes for every primary action; all are native anchors, buttons, input, or dialog controls. Search also supports `/` and Cmd/Ctrl-K (`src/components/layout/SearchDialog.astro:23-62,240-307`).
- **Focus visibility:** a global 2px outline with 2px offset exists, with component-specific input focus where needed (`src/styles/global.css:105-111`, `src/components/layout/SearchDialog.astro:387`).
- **Landmarks:** 1 banner, 1 primary navigation, 1 main, 1 contentinfo, 6 labelled regions, and 1 dormant search landmark on the Frontispiece (`src/layouts/BaseLayout.astro:119-145`, `src/components/layout/Header.astro:15-38`, `src/pages/index.astro:57-250`).
- **Skip link:** present and points to `#main` (`src/layouts/BaseLayout.astro:119-133`, `src/styles/global.css:113-127`).
- **Primary concern:** mobile header targets are materially below the common 44 × 44px touch target, despite keyboard semantics and contrast passing (`src/components/layout/Header.astro:63-90`, runtime measurements under [Visual evidence](#visual)).
