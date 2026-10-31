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
