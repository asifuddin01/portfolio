# Verdict: REDESIGN

**REDESIGN — At 15/30, the portfolio has an unusually strong visual identity and careful implementation, but its load-bearing first-visit structure, labeling, task path, and claim discipline need to be rebuilt around what a new visitor is trying to do.**

This is a redesign of information architecture and interaction hierarchy, not a rejection of the brand. Preserve the typography, palette, editorial voice, accessible state work, and explanatory figures; rebuild how the shell names destinations and how the landing page earns attention.

## Highest-leverage moves

1. Principle #4 — Understandable: Replace Latin-only primary labels with plain labels and keep the Latin names as secondary editorial subtitles; make the wordmark and Home resolve to `/`, and name `/home` “Full portfolio.” Evidence: `src/consts.ts:23-39`, `src/components/layout/Header.astro:17-30`.
2. Principle #2 — Useful: Rebuild the Frontispiece around identity plus three direct actions—View selected work, Download CV, Contact—followed by a small proof set; move the detailed inventory behind “Full portfolio.” Evidence: `src/pages/index.astro:56-99,128-250`, `src/pages/vitae.astro:28-38`.
3. Principles #5/#10 — Unobtrusive/minimal: On mobile, collapse the primary navigation into one accessible menu, keep the header under 72px with at least 44px targets, and trim the landing page from 7 sections/1,125 words/45 controls to selected evidence. Evidence: `src/components/layout/Header.astro:48-90`, runtime structural/visual measurements in `DESIGN-IS-2026-09-08/01-evidence.md`.
4. Principle #6 — Honest: Align every headline claim and action label to current verifiable behavior: say “fix proposed upstream,” “Papers and manuscripts,” narrow “every claim”/“cannot go stale,” and label the HTML CV step honestly or download the file directly. Evidence: `src/content/site/frontispiece.mdx:33-38`, `src/pages/papers/index.astro:22-45`, `src/pages/researchlens.astro:119-129,197-213`, `src/pages/vitae.astro:28-38`.
5. Principles #8/#9 — Thorough/efficient: Keep explanatory figure motion CSS-native, mobile-safe, and explicitly reduced-motion aware; pause ambient/offscreen loops and preserve the real metric text instead of replacing it with temporary zeroes. Evidence: `src/components/front/DescentPlate.astro:245-310`, `src/components/elementa/NetworkPlate.astro:311-437`, `src/pages/index.astro:254-315`, `src/styles/motion.css:194-205`.
