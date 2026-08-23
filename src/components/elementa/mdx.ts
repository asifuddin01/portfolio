/**
 * The components an Elementa body may use without importing them.
 *
 * Passed to `<Content components={ELEMENTA_COMPONENTS} />`, so a problem
 * written in /admin can use the §5.4 template by name. An author editing
 * through the CMS has no import statement to forget.
 */
import Answer from './Answer.astro';
import ApparatusRef from './ApparatusRef.astro';
import Breaks from './Breaks.astro';
import CheckNumeric from './CheckNumeric.astro';
import CheckSanity from './CheckSanity.astro';
import Eq from './Eq.astro';
import EqRef from './EqRef.astro';
import Find from './Find.astro';
import Given from './Given.astro';
import Hint from './Hint.astro';
import Simplification from './Simplification.astro';
import Solution from './Solution.astro';
import SolutionToggle from './SolutionToggle.astro';
import Statement from './Statement.astro';
import Strategy from './Strategy.astro';
import Variation from './Variation.astro';

export const ELEMENTA_COMPONENTS = {
  Answer, ApparatusRef, Breaks, CheckNumeric, CheckSanity, Eq, EqRef,
  Find, Given, Hint, Simplification, Solution, SolutionToggle,
  Statement, Strategy, Variation,
};
