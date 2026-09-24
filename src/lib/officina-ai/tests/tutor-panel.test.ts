import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeFrom, renderAnswer } from '../view/tutor-panel.ts';

/** How an answer is shown: code as code, prose as prose, nothing the model writes as markup. */

test('a program in an answer keeps its indentation', () => {
  const html = renderAnswer('Squares:\n\n```python\nfor i in range(1, 6):\n    print(i * i)\n```\n\nWatch line 2.');
  assert.match(html, /<pre class="tu-code"><code>for i in range\(1, 6\):\n {4}print\(i \* i\)<\/code><\/pre>/);
  assert.match(html, /<p>Squares:<\/p>/);
});

test('a fence still streaming in is already shown as code', () => {
  assert.match(renderAnswer('Here:\n```python\ndef f(n):\n    return'), /<pre class="tu-code"><code>def f\(n\):\n {4}return<\/code><\/pre>/);
});

test('backticks become inline code and step numbers become links', () => {
  const html = renderAnswer('The test `s[i] != s[j]` was false at step 4.');
  assert.match(html, /<code class="tu-inline">s\[i\] != s\[j\]<\/code>/);
  assert.match(html, /data-step="4"/);
});

test('nothing a model writes becomes markup', () => {
  const html = renderAnswer('<img src=x onerror=alert(1)> and ```\n<script>alert(1)</script>\n```');
  assert.ok(!/<img|<script/.test(html), html);
  assert.match(html, /&lt;script&gt;/);
});

test('the program put in the editor is the one in the fence, as written', () => {
  assert.equal(codeFrom('Text\n```python\nx = 1\n    y = 2\n```\nmore'), 'x = 1\n    y = 2');
  assert.equal(codeFrom('no code here'), null);
});
