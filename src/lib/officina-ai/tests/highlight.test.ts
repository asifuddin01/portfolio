import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightSource } from '../view/highlight.ts';

test('C and Java highlight comments, strings and keywords without injecting markup', () => {
  for (const language of ['c', 'java']) {
    const lines = highlightSource('/* two\nlines */\nint x = 3; // <img>\nString text = "<script>";', language);
    assert.equal(lines.length, 4);
    assert.match(lines[0], /^<span class="ot-tk-comment">\/\* two<\/span>$/);
    assert.match(lines[1], /^<span class="ot-tk-comment">lines \*\/<\/span>$/);
    assert.match(lines[2], /<span class="ot-tk-keyword">int<\/span>/);
    assert.match(lines[2], /ot-tk-comment">\/\/ &lt;img&gt;/);
    assert.match(lines[3], /ot-tk-string">"&lt;script&gt;"/);
    assert.doesNotMatch(lines.join(''), /<img>|<script>/);
  }
});

test('Python keeps hash comments and its boolean keywords', () => {
  assert.match(highlightSource('x = True # ready')[0], /ot-tk-keyword">True/);
  assert.match(highlightSource('x = True # ready')[0], /ot-tk-comment"># ready/);
});
