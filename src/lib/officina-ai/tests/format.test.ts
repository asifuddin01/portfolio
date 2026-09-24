import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedIndices, formatValue, typeOf } from '../view/format.ts';

test('values are spelled as Python prints them', () => {
  assert.equal(formatValue(null), 'None');
  assert.equal(formatValue(true), 'True');
  assert.equal(formatValue(3), '3');
  assert.equal(formatValue({ t: 'float', r: '3.0' }), '3.0');
  assert.equal(formatValue('madam'), "'madam'");
  assert.equal(formatValue("it's"), '"it\'s"');
  assert.equal(formatValue('a\nb'), "'a\\nb'");
  assert.equal(formatValue({ t: 'tuple', items: [1], n: 1 }), '(1,)');
  assert.equal(formatValue({ t: 'set', items: [], n: 0 }), 'set()');
  assert.equal(formatValue({ t: 'dict', items: [['a', 1]], n: 1 }), "{'a': 1}");
  assert.equal(formatValue({ t: 'list', items: [1, 2], n: 5 }), '[1, 2, … 3 more]');
  assert.equal(formatValue({ t: 'object', cls: 'Node', attrs: [['value', 1], ['next', null]] }), 'Node(value=1, next=None)');
  assert.equal(formatValue({ t: 'cycle', cls: 'list' }), '[...]');
});

test('long values are clipped, not wrapped', () => {
  const long = formatValue({ t: 'list', items: Array.from({ length: 50 }, (_, i) => i), n: 50 }, 20);
  assert.equal(long.length, 20);
  assert.ok(long.endsWith('…'));
});

test('type labels', () => {
  assert.equal(typeOf(1), 'int');
  assert.equal(typeOf({ t: 'float', r: '1.5' }), 'float');
  assert.equal(typeOf({ t: 'list', items: [], n: 0 }), 'list');
  assert.equal(typeOf({ t: 'object', cls: 'Node', attrs: [] }), 'Node');
});

test('in-place list changes name the positions that changed', () => {
  const before = { t: 'list' as const, items: [10, 20, 30, 40], n: 4 };
  const after = { t: 'list' as const, items: [10, 20, 50, 40], n: 4 };
  assert.deepEqual(changedIndices(before, after), [2]);
  assert.equal(changedIndices(before, { ...after, items: [1], n: 1 }), null);
  assert.equal(changedIndices(3, 4), null);
});
