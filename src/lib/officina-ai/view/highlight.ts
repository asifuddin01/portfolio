/**
 * Just enough Python highlighting to read a program by: keywords, strings,
 * comments, numbers and the names being defined. Not a parser — the tracer
 * has the real one — so it only colours text and never decides anything.
 *
 * Returns one HTML string per source line, with every span closed on the line
 * it opened, so a triple-quoted string across lines still highlights and the
 * code view can mark a single line without splitting a tag.
 */
const KEYWORDS = new Set(
  ('False None True and as assert async await break class continue def del elif else except ' +
    'finally for from global if import in is lambda nonlocal not or pass raise return try while ' +
    'with yield match case').split(' '),
);
const BUILTINS = new Set(
  ('print len range int str float list dict set tuple bool input enumerate zip map filter sum ' +
    'min max abs sorted reversed isinstance type open round divmod any all iter next repr ord chr').split(' '),
);

const TOKEN =
  /(#[^\n]*)|([rRbBuUfF]{0,2}(?:'''[\s\S]*?(?:'''|$)|"""[\s\S]*?(?:"""|$)|'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?))|(\b\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?j?\b|\b0[xXoObB][\da-fA-F_]+\b)|([A-Za-z_]\w*)/g;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const COMPILED_KEYWORDS = new Set(('auto bool break case char class const continue default do double else enum extern ' +
  'false final float for if import int interface long new null package private protected public return short signed ' +
  'sizeof static struct super switch this throw throws true try typedef union unsigned void volatile while').split(' '));
const COMPILED_TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|(?![\s\S]))|^[ \t]*#[^\n]*)|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(\b(?:0[xX][\da-fA-F]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)[fFlLuU]*\b)|([A-Za-z_]\w*)/gm;

export function highlightSource(source: string, language = 'python'): string[] {
  if (language === 'python') return highlightPython(source);
  let last = 0;
  let html = '';
  for (const match of source.matchAll(COMPILED_TOKEN)) {
    html += esc(source.slice(last, match.index));
    const [text, comment, string, number, name] = match;
    const cls = comment ? 'ot-tk-comment' : string ? 'ot-tk-string' : number ? 'ot-tk-number' :
      COMPILED_KEYWORDS.has(name) ? 'ot-tk-keyword' : '';
    html += cls ? wrapLines(text, cls) : esc(text);
    last = match.index! + text.length;
  }
  return (html + esc(source.slice(last))).split('\n');
}

export function highlightPython(source: string): string[] {
  const out: string[] = [];
  let last = 0;
  let defining = false;
  const push = (text: string, cls?: string) => {
    if (!text) return;
    out.push(cls ? wrapLines(text, cls) : esc(text));
  };
  for (const m of source.matchAll(TOKEN)) {
    push(source.slice(last, m.index));
    const [text, comment, string, number, name] = m;
    if (comment) push(text, 'ot-tk-comment');
    else if (string) push(text, 'ot-tk-string');
    else if (number) push(text, 'ot-tk-number');
    else if (name) {
      if (defining) push(text, 'ot-tk-def');
      else if (KEYWORDS.has(name)) push(text, 'ot-tk-keyword');
      else if (BUILTINS.has(name)) push(text, 'ot-tk-builtin');
      else push(text);
      defining = name === 'def' || name === 'class';
      last = m.index! + text.length;
      continue;
    }
    defining = false;
    last = m.index! + text.length;
  }
  push(source.slice(last));
  return out.join('').split('\n');
}

/** Wrap text in a span per line, so no tag crosses a newline. */
function wrapLines(text: string, cls: string): string {
  return text
    .split('\n')
    .map((part) => (part ? `<span class="${cls}">${esc(part)}</span>` : ''))
    .join('\n');
}
