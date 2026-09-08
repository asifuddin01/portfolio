# Dieter Rams scorecard

1. Good design is innovative — Score: 2/3
   Evidence: The scholarly-book portfolio and data-driven explanatory plates refresh familiar portfolio patterns without inventing a new interaction model ([visual evidence](01-evidence.md#visual)).
   Justification: This is a clear, useful reinterpretation of existing editorial and portfolio conventions, but no comparison against five peers establishes a genuinely new pattern.

2. Good design makes a product useful — Score: 1/3
   Evidence: Work is inspectable, but contact is relegated to the footer, CV download takes an intermediate page, and the first screen has no explicit next action ([structural evidence](01-evidence.md#structural), [copy evidence](01-evidence.md#copy-honesty)).
   Justification: The primary evaluation/contact task can be completed, but it requires unnecessary navigation and scrolling detours.

3. Good design is aesthetic — Score: 2/3
   Evidence: Type and color are centralized and highly coherent, while spacing is more ad hoc and the 185.5px mobile header is a significant responsive inconsistency ([visual evidence](01-evidence.md#visual)).
   Justification: The visible system is strong, but the mobile chrome prevents a fully consistent execution.

4. Good design makes a product understandable — Score: 0/3
   Evidence: Six primary labels require domain/Latin interpretation, the wordmark and “Frontispiece” lead to two different home concepts, and no primary action is visually named above the fold ([copy evidence](01-evidence.md#copy-honesty), [structural evidence](01-evidence.md#structural)).
   Justification: A first-time visitor cannot identify the destination or role of every primary control—and cannot identify one intended primary action—without exploration.

5. Good design is unobtrusive — Score: 1/3
   Evidence: On mobile, multi-row chrome consumes 22% of the viewport; persistent background/figure motion and ornamental separators compete with a dense content page ([visual evidence](01-evidence.md#visual), [weight evidence](01-evidence.md#weight-friction)).
   Justification: The content remains legible, but the chrome and ambient treatment do not consistently recede behind it.

6. Good design is honest — Score: 1/3
   Evidence: There are multiple claim/behavior mismatches, including an open upstream fix described as completed, absolute grounding/privacy language, and “Published papers” covering unpublished work; no dark patterns were found ([copy evidence](01-evidence.md#copy-honesty)).
   Justification: The rubric assigns 1 when two or more inflations are present, even without manipulative behavior.

7. Good design is long-lasting — Score: 2/3
   Evidence: Classical book typography and restrained colors are durable, while the combined custom-cursor/parallax/magnetic-motion layer is one distinctly contemporary marker (`src/styles/motion.css:144-227`, `src/scripts/motion.ts:111-217`).
   Justification: One trend-marked interaction layer keeps an otherwise timeless visual language from the top score.

8. Good design is thorough down to the last detail — Score: 3/3
   Evidence: Empty, loading, error, success, focus, and disabled states are all explicitly present and styled; automated build, accessibility, contrast, content, and link checks pass ([visual evidence](01-evidence.md#visual), [accessibility evidence](01-evidence.md#accessibility)).
   Justification: The rubric's complete state checklist is met rather than merely inferred from default browser behavior.

9. Good design is environmentally friendly — Score: 2/3
   Evidence: Initial JS is 24.5KB, dark and reduced-motion modes are honored, and there is no autoplay, but 11 CSS loops remain active at idle plus a fine-pointer cursor loop ([weight evidence](01-evidence.md#weight-friction)).
   Justification: It meets the under-500KB/motion-gated anchor, but idle animation prevents a 3.

10. Good design is as little design as possible — Score: 1/3
    Evidence: The landing page carries 7 sections, about 1,125 words, 45 controls, 8 repeated-destination groups, 6 internal separators, and a second “whole portfolio” destination ([structural evidence](01-evidence.md#structural)).
    Justification: More than a few elements can be removed or consolidated without breaking the primary task.

## Total

**15/30**

