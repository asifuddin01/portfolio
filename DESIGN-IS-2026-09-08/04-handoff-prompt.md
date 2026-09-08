```text
/make-plan Redesign the public portfolio shell, Frontispiece, and first-visit path. Current design failed audit at 15/30 with critical gaps in principles #2 useful, #4 understandable, and #6 honest.

Verdict paragraph (quoted from 03-verdict.md):
> REDESIGN — At 15/30, the portfolio has an unusually strong visual identity and careful implementation, but its load-bearing first-visit structure, labeling, task path, and claim discipline need to be rebuilt around what a new visitor is trying to do.

Why redesign and not refine: The total is below the 20-point threshold and the load-bearing understandability principle scored 0 because the primary navigation and first action are not self-explanatory to a new visitor.

Primary user: A potential collaborator, employer, client, or academically inclined visitor evaluating Asifuddin's work.
Primary task: Understand who Asifuddin is, inspect credible selected work, and contact him or download his CV without a detour.
Constraints: Preserve the scholarly personal character, existing content, Astro 7/Tailwind 4 stack, responsive behavior, and WCAG 2.2 AA floor.

Preserve from current design:
- The Vellum/Nocturne color, type, measure, rhythm, and motion tokens in `src/styles/tokens.css:19-92`.
- The bespoke, accessible explanatory figures and their mobile-safe reduced-motion behavior in `src/components/front/DescentPlate.astro:130-310` and `src/components/elementa/NetworkPlate.astro:130-437`.
- The complete empty/loading/error/success/focus/disabled state work in `src/components/layout/SearchDialog.astro:168-214`, `src/pages/researchlens.astro:913-1139`, and `src/styles/global.css:105-111`.

Discard:
- Latin-only primary navigation and the split `/` versus `/home` home model. Evidence: `src/consts.ts:23-39`, `src/components/layout/Header.astro:17-30`. Caused failure on principle #4.
- The landing page's seven-section exhaustive inventory and repeated destinations as the first-visit hierarchy. Evidence: `src/pages/index.astro:56-250`. Caused failure on principles #2 and #10.
- Multi-row mobile chrome with tiny inline hit targets. Evidence: `src/components/layout/Header.astro:48-90`. Caused failure on principle #5.

Top 3–5 moves from the audit (verbatim):
1. Principle #4 — Understandable: Replace Latin-only primary labels with plain labels and keep the Latin names as secondary editorial subtitles; make the wordmark and Home resolve to `/`, and name `/home` “Full portfolio.” Evidence: `src/consts.ts:23-39`, `src/components/layout/Header.astro:17-30`.
2. Principle #2 — Useful: Rebuild the Frontispiece around identity plus three direct actions—View selected work, Download CV, Contact—followed by a small proof set; move the detailed inventory behind “Full portfolio.” Evidence: `src/pages/index.astro:56-99,128-250`, `src/pages/vitae.astro:28-38`.
3. Principles #5/#10 — Unobtrusive/minimal: On mobile, collapse the primary navigation into one accessible menu, keep the header under 72px with at least 44px targets, and trim the landing page from 7 sections/1,125 words/45 controls to selected evidence. Evidence: `src/components/layout/Header.astro:48-90`, runtime structural/visual measurements in `DESIGN-IS-2026-09-08/01-evidence.md`.
4. Principle #6 — Honest: Align every headline claim and action label to current verifiable behavior: say “fix proposed upstream,” “Papers and manuscripts,” narrow “every claim”/“cannot go stale,” and label the HTML CV step honestly or download the file directly. Evidence: `src/content/site/frontispiece.mdx:33-38`, `src/pages/papers/index.astro:22-45`, `src/pages/researchlens.astro:119-129,197-213`, `src/pages/vitae.astro:28-38`.
5. Principles #8/#9 — Thorough/efficient: Keep explanatory figure motion CSS-native, mobile-safe, and explicitly reduced-motion aware; pause ambient/offscreen loops and preserve the real metric text instead of replacing it with temporary zeroes. Evidence: `src/components/front/DescentPlate.astro:245-310`, `src/components/elementa/NetworkPlate.astro:311-437`, `src/pages/index.astro:254-315`, `src/styles/motion.css:194-205`.

Redesign principles in priority order:
1. Principle #4 — Understandable — a new visitor can predict every primary destination and identify the three primary actions without a tooltip.
2. Principle #2 — Useful — selected work, direct CV download, and contact are each one obvious action from the first screen.
3. Principle #10 — As little design as possible — the landing page contains only identity, direct actions, selected proof, and one path to deeper material.

Deliverables for the plan:
- New information architecture (not derived from the old label set)
- New primary flow (low-fi, labeled, compared side-by-side to current)
- Desktop and mobile shell specifications, including menu behavior and 44px target minimums
- States checklist (empty, loading, error, success, focus, disabled)
- Copy/claim verification table with owners or evidence links
- Migration path for users currently on the old design
- Cutover criteria (when the old design is retired)

Anti-patterns to guard against (specific to REDESIGN):
- Porting the old structure under new styling
- Keeping both designs behind a flag indefinitely
- Redesigning to follow a trend rather than the principles above
- Treating the Preserve list as optional—it must be filled before this handoff is valid
```
