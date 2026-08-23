/**
 * Runs the five Elementa guards and reports.
 *
 * Errors fail the build. Warnings do not: a warning is almost always a
 * chapter that is written but not yet brought up to the Math Mandate, and
 * the corpus has to be able to be online while that work is done. Marking a
 * chapter `published` converts its warnings into errors.
 */
import { runAllGuards } from './elementa/guards.mjs';

const verbose = process.argv.includes('--verbose');
const results = await runAllGuards();

let errors = 0;
let warnings = 0;

for (const r of results) {
  errors += r.errors.length;
  warnings += r.warnings.length;
  const mark = r.errors.length ? '✗' : '✓';
  console.log(
    `${mark} ${r.name.padEnd(12)} ${String(r.errors.length).padStart(3)} error(s)   ` +
    `${String(r.warnings.length).padStart(4)} owed`
  );
  for (const e of r.errors) console.log(`    ✗ ${e}`);
  if (verbose) for (const w of r.warnings) console.log(`    · ${w}`);
}

if (!verbose && warnings) {
  console.log(
    `\n  ${warnings} outstanding obligation(s) across the corpus — chapters that are ` +
    `written but do not yet meet their declared tier.\n  Run with --verbose to list them; ` +
    `they become errors the moment a chapter is marked published.`
  );
}

if (errors) {
  console.error(`\n✗ ELEMENTA: ${errors} error(s). See §12 of the specification.`);
  process.exit(1);
}
console.log(`\n✓ Elementa: all seven guards pass.`);
