// The Armarium's search suggestions rank names with rank() from src/lib/armarium.ts.
import assert from 'node:assert/strict';
import { fold, rank } from '../src/lib/armarium.ts';

const r = (q, ...names) => rank(fold(q), names.map(fold));
assert.equal(r('hum', 'Humayun Ahmed'), 0);
assert.equal(r('ahmed', 'Humayun Ahmed'), 1);
assert.equal(r('yun', 'Humayun Ahmed'), 2);
assert.equal(r('humayon', 'Humayun Ahmed'), 3);
assert.equal(r('lovcraft', 'H. P. Lovecraft'), 3);
assert.equal(r('xyz', 'Humayun Ahmed'), 9);
assert.equal(r('arsene', 'Arsène Lupin'), 0);
assert.equal(r('উদ্দীন', 'জসীম উদ্দীন'), 1);
assert.equal(r('দ্য', 'Dune', 'দ্য আউটসাইডার'), 0);
console.log('✓ armarium search ranking');

// Saving a rating from the page rewrites only rating and review in the book's file.
import { withRating } from '../src/lib/armarium.ts';
const book = '---\naccession: 1\ntitle: "Circe"\nshelves:\n  - fantasy\nrating: 3\nreview: |-\n  Old line one.\n\n  Old line two.\nlanguage: Bangla\n---\n';
const out = withRating(book, 4.5, 'ভালো বই, "quoted"\nsecond line');
assert.equal(out, '---\naccession: 1\ntitle: "Circe"\nshelves:\n  - fantasy\nlanguage: Bangla\nrating: 4.5\nreview: "ভালো বই, \\"quoted\\"\\nsecond line"\n---\n');
assert.equal(withRating(out, 0, '  '), '---\naccession: 1\ntitle: "Circe"\nshelves:\n  - fantasy\nlanguage: Bangla\n---\n');
assert.throws(() => withRating('no frontmatter', 4, ''));
console.log('✓ armarium rating rewrite');
