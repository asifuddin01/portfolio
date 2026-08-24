/**
 * The five Elementa build guards (spec §12).
 *
 * The embargo guard on the research plates established the pattern:
 * structural rules are enforced by the build, not by discipline. The Math
 * Mandate is enforced the same way, and for the same reason — a rule that
 * depends on anyone's memory is not a rule.
 *
 *   check-math-quota   §5.2   problems, variants, exercises, per tier
 *   check-graph        I-7    every dependency ID resolves; no cycles
 *   check-notation     I-5    one symbol, one meaning, introduced before use
 *   lint-prose         I-6    forbidden phrases, hex literals, spelling
 *   verify-snippets    I-4    every printed number reproduces
 *
 * On the quota guard and `status`
 * ------------------------------
 * The quota is enforced against chapters marked `published`. A chapter in
 * `review` is live and readable but has not claimed to meet the mandate, so
 * failing it would only mean the corpus could not be online while it is being
 * written. Promoting a chapter to `published` is the commitment; the guard is
 * what makes the commitment mean something.
 */
import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { readCollection, list } from './read.mjs';

const C = {
  books: 'src/content/books',
  concepts: 'src/content/concepts.yaml',
  chapters: 'src/content/chapters',
  propositions: 'src/content/elementa',
  problems: 'src/content/problems',
  apparatus: 'src/content/apparatus',
};

/** §7.2 — the coverage quota, across the four non-mathematical strands. */
const COVERAGE_RULES = {
  M0: { definitions: 3, beforeYouStart: 1, formalResults: 0, assumptions: 0, failureModes: 1, references: 2, implementation: false },
  M1: { definitions: 4, beforeYouStart: 2, formalResults: 1, assumptions: 0, failureModes: 1, references: 3, implementation: true },
  M2: { definitions: 6, beforeYouStart: 3, formalResults: 1, assumptions: 1, failureModes: 1, references: 4, implementation: true },
  M3: { definitions: 8, beforeYouStart: 3, formalResults: 2, assumptions: 2, failureModes: 2, references: 6, implementation: true },
};

/** Reading order of the eight books, for the backwards-dependency rule. */
const BOOK_RANK = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };

const TIER_RULES = {
  M0: { minProblems: 0, minVariants: 0, minExercises: 0 },
  M1: { minProblems: 1, minVariants: 1, minExercises: 3 },
  M2: { minProblems: 3, minVariants: 3, minExercises: 6 },
  M3: { minProblems: 5, minVariants: 4, minExercises: 10 },
};
const M3_GROUPS = [['numeric'], ['symbolic'], ['limit', 'counterexample'], ['complexity', 'shape']];

const FORBIDDEN = [
  'it can be shown', 'it is easy to see', 'clearly,', 'obviously,',
  'after some algebra', 'trivially', 'simply put', 'in a nutshell',
  'game-changing', 'revolutionary', 'delve', 'cutting-edge', 'seamless',
];
const SPELLING = [
  ['normalization', 'normalisation'], ['normalize', 'normalise'],
  ['tokenization', 'tokenisation'], ['tokenize', 'tokenise'],
  ['optimization', 'optimisation'], ['optimize', 'optimise'],
  ['regularization', 'regularisation'], ['behavior', 'behaviour'],
  ['generalization', 'generalisation'], ['generalize', 'generalise'],
  ['initialization', 'initialisation'], ['visualization', 'visualisation'],
  ['factorization', 'factorisation'], ['randomization', 'randomisation'],
  ['marginalization', 'marginalisation'], ['neighbor', 'neighbour'],
];

const rel = (f) => path.relative(process.cwd(), f);

async function load() {
  const [books, chapters, propositions, problems, apparatus] = await Promise.all([
    readCollection(C.books), readCollection(C.chapters),
    readCollection(C.propositions), readCollection(C.problems),
    readCollection(C.apparatus),
  ]);
  return { books, chapters, propositions, problems, apparatus };
}

/** Every proposition's ID, derived from its chapter and its number (§3.1). */
function propositionIds({ chapters, propositions }) {
  const chapterId = new Map(chapters.map((c) => [c.id, c.data.id]));
  const ids = new Map();
  for (const p of propositions) {
    const cid = chapterId.get(p.data.chapter);
    if (!cid) continue;
    ids.set(p.id, `${cid}.P${String(p.data.proposition).padStart(2, '0')}`);
  }
  return ids;
}

// ── §5.2 The Math Mandate ──────────────────────────────────────────────────
export async function checkMathQuota(data) {
  const { chapters, problems, books } = data ?? (await load());
  const errors = [];
  const warnings = [];

  for (const ch of chapters) {
    const { id, mathTier = 'M1', status } = ch.data;
    const rule = TIER_RULES[mathTier];
    if (!rule) { errors.push(`${id}: unknown mathTier "${mathTier}".`); continue; }

    const mine = problems.filter((p) => p.data.chapter === id);
    const worked = mine.filter((p) => p.data.kind === 'problem');
    const exercises = mine.filter((p) => p.data.kind === 'exercise');
    const variants = new Set(worked.map((p) => p.data.variant));

    // A chapter still in review is allowed to owe. One marked published is not.
    const into = status === 'published' ? errors : warnings;

    if (worked.length < rule.minProblems)
      into.push(`${id} (${mathTier}): ${worked.length} worked problems, needs ${rule.minProblems}.`);
    if (variants.size < rule.minVariants)
      into.push(`${id} (${mathTier}): ${variants.size} distinct variants [${[...variants].join(', ')}], needs ${rule.minVariants}.`);
    if (exercises.length < rule.minExercises)
      into.push(`${id} (${mathTier}): ${exercises.length} exercises, needs ${rule.minExercises}.`);

    // Repetition is not coverage — this one fails whatever the status, because
    // it is a defect in what exists rather than a gap in what does not.
    for (const v of variants) {
      const n = worked.filter((p) => p.data.variant === v).length;
      if (worked.length >= 4 && n * 2 > worked.length)
        errors.push(`${id}: variant "${v}" is ${n}/${worked.length} problems — repetition, not coverage (§5.3).`);
    }

    if (mathTier === 'M3') {
      for (const group of M3_GROUPS) {
        if (!group.some((v) => variants.has(v)))
          into.push(`${id} (M3): no problem of variant ${group.join(' or ')}.`);
      }
      if (worked.length > 0 && !worked.some((p) => Number(p.data.difficulty) === 3))
        into.push(`${id} (M3): no ▲▲▲ problem.`);
    }

    if ((mathTier === 'M1' || mathTier === 'M2') &&
        list(ch.data.keyEquations).length > 6 && !ch.data.tierRationale)
      errors.push(`${id}: tagged ${mathTier} with ${list(ch.data.keyEquations).length} key equations — write a tierRationale or promote it to M3.`);
  }

  // Book-level obligation (§5.2).
  for (const book of books) {
    const numeral = book.data.id;
    if (numeral === '0') continue;
    const own = chapters.filter((c) => c.data.book === book.id);
    if (!own.some((c) => c.data.mathTier === 'M3')) continue;
    const shipped = own.every((c) => c.data.status === 'published');
    const into = shipped ? errors : warnings;

    const set = problems.filter((p) => p.data.chapter === `${numeral}.BOOK`);
    const cross = set.filter((p) => p.data.scope === 'cross-book');
    if (set.length < 8)
      into.push(`Book ${numeral}: has load-bearing chapters but its problem set holds ${set.length}/8.`);
    if (cross.length < 2)
      into.push(`Book ${numeral}: needs ≥2 cross-book problems, has ${cross.length}.`);
  }

  return { errors, warnings, name: 'math-quota' };
}


// ── §7.2 Coverage — the four strands that are not mathematics ──────────────
/**
 * A chapter can satisfy every problem quota and still leave a reader who does
 * not know what the words mean, cannot picture the mechanism, and has no idea
 * what the theorem does not promise. So each strand carries its own minimum,
 * and neither side can buy its way out of the other: seven beautiful problems
 * and four definitions still fails.
 */
export async function checkCoverage(data) {
  const { chapters } = data ?? (await load());
  const errors = [];
  const warnings = [];

  for (const ch of chapters) {
    const { id, mathTier = 'M1', status } = ch.data;
    const rule = COVERAGE_RULES[mathTier];
    if (!rule) continue;
    const into = status === 'published' ? errors : warnings;

    const count = (k) => list(ch.data[k]).length;
    const need = (got, want, what) => {
      if (got < want) into.push(`${id} (${mathTier}): ${got} ${what}, needs ${want}.`);
    };

    need(count('definitions'), rule.definitions, 'numbered definitions');
    need(count('beforeYouStart'), rule.beforeYouStart, 'BEFORE YOU START entries');
    need(count('formalResults'), rule.formalResults, 'named formal results');
    need(count('assumptions'), rule.assumptions, 'enumerated assumptions');
    need(count('failureModes'), rule.failureModes, 'concrete failure modes');
    need(count('references'), rule.references, 'sources with authors, year and venue');

    if (rule.implementation && ch.data.implementation !== true)
      into.push(`${id}: no runnable implementation (Practice strand, §7.1).`);

    // The concept figure is required at every tier, M0 included: a chapter
    // with nothing a reader could redraw has not been taught.
    if (!ch.data.conceptFigure || ch.data.conceptFigure === 'null')
      into.push(`${id}: no concept figure. Every chapter owes one drawing a reader could reproduce from memory.`);

    if (!ch.data.problemStatement)
      into.push(`${id}: no problem statement. A mechanism introduced before its problem is memorised, not understood.`);
  }

  return { errors, warnings, name: 'coverage' };
}

// ── §6.3 Placement — one mechanism, one home (invariant I-9) ───────────────
/**
 * Duplication is the failure mode that makes a work like this rot: two
 * treatments drift, contradict, and the reader stops trusting either. The
 * guard is possible because ownership is declared rather than inferred.
 */
export async function checkPlacement(data) {
  const { chapters } = data ?? (await load());
  const errors = [];
  const warnings = [];

  // The controlled vocabulary. A concept carrying an `apparatus:` anchor is
  // owned by Book 0; no chapter may claim it.
  const raw = await readFile(C.concepts, 'utf8');
  const vocab = new Map();
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const start = line.match(/^-\s+id:\s*(\S+)/);
    if (start) { current = { id: start[1] }; vocab.set(current.id, current); continue; }
    const kv = line.match(/^\s+([A-Za-z_][\w-]*):\s*(\S+)/);
    if (kv && current) current[kv[1]] = kv[2];
  }

  const owner = new Map();
  for (const ch of chapters) {
    const id = ch.data.id;
    const owns = list(ch.data.owns);
    const borrows = list(ch.data.borrows);

    if (owns.length === 0)
      errors.push(`${id}: owns[] is empty — every chapter must own at least one concept (§6.3).`);

    for (const c of owns) {
      const entry = vocab.get(c);
      if (!entry) {
        errors.push(`${id}: owns "${c}", which is not in the concept vocabulary. Adding one is a deliberate act.`);
        continue;
      }
      if (entry.apparatus) {
        errors.push(`${id}: claims to own "${c}", but that concept lives in the Apparatus at ${entry.apparatus}. Borrow it instead.`);
        continue;
      }
      if (owner.has(c))
        errors.push(`Concept "${c}" is owned by both ${owner.get(c)} and ${id}. One mechanism, one home (I-9).`);
      else owner.set(c, id);
    }

    for (const c of borrows) {
      if (!vocab.has(c))
        errors.push(`${id}: borrows "${c}", which is not in the concept vocabulary.`);
      if (owns.includes(c))
        errors.push(`${id}: lists "${c}" as both owned and borrowed. It is one or the other.`);
    }
  }

  // A borrowed concept has to be owned somewhere, or the reader is sent nowhere.
  for (const ch of chapters) {
    for (const c of list(ch.data.borrows)) {
      const entry = vocab.get(c);
      if (!entry || entry.apparatus) continue;
      if (!owner.has(c))
        errors.push(`${ch.data.id}: borrows "${c}", which no chapter owns. Either a chapter derives it or it belongs in the Apparatus.`);
    }
  }

  const unclaimed = [...vocab.values()].filter((v) => !v.apparatus && !owner.has(v.id));
  if (unclaimed.length)
    warnings.push(`${unclaimed.length} concept(s) in the vocabulary that no chapter yet owns.`);

  return { errors, warnings, name: 'placement' };
}

// ── I-7 Graph integrity ────────────────────────────────────────────────────
export async function checkGraph(data) {
  const d = data ?? (await load());
  const { books, chapters, propositions, problems, apparatus } = d;
  const errors = [];
  const warnings = [];

  const bookIds = new Set(books.map((b) => b.id));
  const chapterIds = new Set(chapters.map((c) => c.data.id));

  /** Reading order, so "points backwards" is a comparison and not a guess. */
  const rank = new Map();
  for (const c of chapters) {
    const [numeral, n] = String(c.data.id).split('.');
    rank.set(c.data.id, (BOOK_RANK[numeral] ?? 99) * 100 + Number(n));
  }
  const apparatusIds = new Set(apparatus.map((a) => a.data.id));
  const propIds = propositionIds(d);
  const propIdSet = new Set(propIds.values());
  const propBySlug = new Map(propositions.map((p) => [p.id, p]));

  /**
   * §7.1 — BEFORE YOU START mixes kinds on purpose: the prior results a reader
   * needs are sometimes a chapter, sometimes a single proposition, and often an
   * Apparatus entry. All three are clickable IDs, so all three resolve here.
   */
  const resolves = (ref) =>
    chapterIds.has(ref) || propIdSet.has(ref) || apparatusIds.has(ref);

  for (const c of chapters) {
    if (!bookIds.has(c.data.book))
      errors.push(`${rel(c.file)}: book "${c.data.book}" does not exist.`);
    for (const p of list(c.data.beforeYouStart))
      if (!resolves(p))
        errors.push(`${c.data.id}: BEFORE YOU START names "${p}", which resolves to nothing.`);
    for (const a of list(c.data.apparatus))
      if (!apparatusIds.has(a))
        errors.push(`${c.data.id}: apparatus reference "${a}" resolves to nothing.`);

    /**
     * I-7 in v3 — a dependency must point *backwards*. A chapter that leans on
     * one the reader has not reached yet is the anti-pattern §24 calls the
     * forward borrow, and it is the reason the books are ordered as they are.
     */
    const here = rank.get(c.data.id);
    for (const ref of list(c.data.beforeYouStart)) {
      if (!chapterIds.has(ref)) continue;
      const there = rank.get(ref);
      if (here != null && there != null && there >= here)
        errors.push(`${c.data.id}: depends on ${ref}, which the reader reaches later. Dependencies point backwards (I-7).`);
    }
  }

  for (const b of books) {
    for (const a of list(b.data.mathPrerequisites))
      if (!apparatusIds.has(a))
        errors.push(`Book ${b.data.id}: mathPrerequisite "${a}" resolves to nothing.`);
  }

  for (const p of propositions) {
    for (const g of list(p.data.given))
      if (!propBySlug.has(g))
        errors.push(`${rel(p.file)}: given "${g}" resolves to nothing.`);
    for (const a of list(p.data.apparatus))
      if (!apparatusIds.has(a))
        errors.push(`${propIds.get(p.id) ?? p.id}: apparatus reference "${a}" resolves to nothing.`);
  }

  for (const q of problems) {
    if (q.data.chapter && !String(q.data.chapter).endsWith('.BOOK') && !chapterIds.has(q.data.chapter))
      errors.push(`${q.data.id}: filed under chapter "${q.data.chapter}", which does not exist.`);
    for (const dep of list(q.data.depends))
      if (!propIdSet.has(dep))
        errors.push(`${q.data.id}: depends on "${dep}", which resolves to nothing.`);
    for (const back of list(q.data.reachesBack))
      if (!chapterIds.has(back))
        errors.push(`${q.data.id}: reachesBack "${back}", which resolves to nothing.`);
  }

  /**
   * Reserved slugs. `/elementa/apparatus` and `/elementa/foundations/problems`
   * are static routes, and Astro resolves a static segment before a dynamic
   * one — so a book slugged "apparatus" or a chapter slugged "problems" would
   * not collide loudly, it would 404 silently. Fail here instead.
   */
  const RESERVED_BOOK = new Set(['apparatus', 'map', 'figures', 'problems', 'closing']);
  const RESERVED_CHAPTER = new Set(['problems', 'closing']);
  const RESERVED_PROP = new Set(['problems']);

  for (const b of books) {
    if (b.data.id !== '0' && RESERVED_BOOK.has(b.id))
      errors.push(`Book "${b.id}" would be shadowed by the static route /elementa/${b.id}. Rename it.`);
  }
  for (const c of chapters) {
    const slug = c.id.split('--')[1];
    if (RESERVED_CHAPTER.has(slug))
      errors.push(`Chapter "${c.id}" would be shadowed by /elementa/<book>/${slug}. Rename it.`);
  }
  for (const p of propositions) {
    if (RESERVED_PROP.has(p.id))
      errors.push(`Proposition "${p.id}" would be shadowed by /elementa/<book>/<chapter>/${p.id}. Rename it.`);
  }

  // Cycles among propositions. A derivation that quietly uses a later result
  // is the anti-pattern §22 calls the forward borrow.
  const edges = new Map(propositions.map((p) => [p.id, list(p.data.given)]));
  const state = new Map();
  const trail = [];
  const walk = (node) => {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'open') {
      const at = trail.indexOf(node);
      errors.push(`Dependency cycle: ${[...trail.slice(at), node].join(' → ')}`);
      return;
    }
    state.set(node, 'open');
    trail.push(node);
    for (const next of edges.get(node) ?? []) if (edges.has(next)) walk(next);
    trail.pop();
    state.set(node, 'done');
  };
  for (const id of edges.keys()) walk(id);

  const usedBy = new Set(propositions.flatMap((p) => list(p.data.given)));
  const orphans = propositions.filter(
    (p) => list(p.data.given).length === 0 && !usedBy.has(p.id)
  );
  if (orphans.length)
    warnings.push(`${orphans.length} proposition(s) sit on no edge: ${orphans.slice(0, 5).map((o) => o.id).join(', ')}${orphans.length > 5 ? ' …' : ''}`);

  return { errors, warnings, name: 'graph' };
}

// ── I-5 Notation registry ──────────────────────────────────────────────────
export async function checkNotation(data) {
  const d = data ?? (await load());
  const { chapters, propositions } = d;
  const errors = [];
  const warnings = [];

  const raw = await readFile('src/content/notation.yaml', 'utf8');
  const entries = [];
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().startsWith('#') || !line.trim()) continue;
    const start = line.match(/^-\s+id:\s*(.*)$/);
    if (start) {
      current = { id: start[1].trim().replace(/^["']|["']$/g, '') };
      entries.push(current);
      continue;
    }
    const kv = line.match(/^\s+([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv && current) current[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }

  const byId = new Map();
  const bySymbol = new Map();
  for (const e of entries) {
    if (byId.has(e.id)) errors.push(`Notation: "${e.id}" is declared twice.`);
    byId.set(e.id, e);
    const prior = bySymbol.get(e.symbol);
    if (prior && prior.meaning !== e.meaning)
      errors.push(`Notation: symbol "${e.symbol}" means two different things (${prior.id}, ${e.id}).`);
    bySymbol.set(e.symbol, e);
  }

  // Chapter reading order, so "introduced later than used" is checkable.
  const chapterOrder = [...chapters]
    .sort((a, b) => String(a.data.book).localeCompare(String(b.data.book)) || a.data.order - b.data.order);
  const rank = new Map();
  const bookRank = new Map(
    ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'].map((n, i) => [n, i])
  );
  for (const c of chapterOrder) {
    const [bookNumeral, n] = String(c.data.id).split('.');
    rank.set(c.data.id, (bookRank.get(bookNumeral) ?? 99) * 100 + Number(n));
  }

  const check = (who, symbols, atChapter) => {
    for (const s of list(symbols)) {
      const entry = byId.get(s);
      if (!entry) {
        errors.push(`${who}: symbol "${s}" is not in the notation registry (§5.6).`);
        continue;
      }
      const here = rank.get(atChapter);
      const there = rank.get(entry.introducedIn);
      if (here != null && there != null && there > here)
        errors.push(`${who}: uses "${entry.symbol}", which the registry says is introduced later, in ${entry.introducedIn}.`);
    }
  };

  for (const c of chapters) check(c.data.id, c.data.notation, c.data.id);
  const chapterOf = new Map(chapters.map((c) => [c.id, c.data.id]));
  for (const p of propositions)
    check(rel(p.file), p.data.notation, chapterOf.get(p.data.chapter));

  const used = new Set([
    ...chapters.flatMap((c) => list(c.data.notation)),
    ...propositions.flatMap((p) => list(p.data.notation)),
  ]);
  const unused = entries.filter((e) => !used.has(e.id));
  if (unused.length)
    warnings.push(`${unused.length} registry symbol(s) are declared but not yet claimed by any chapter.`);

  return { errors, warnings, name: 'notation' };
}

// ── I-6 Prose ──────────────────────────────────────────────────────────────
export async function lintProse(data) {
  const d = data ?? (await load());
  const errors = [];
  const warnings = [];

  const files = [
    ...d.chapters, ...d.propositions, ...d.problems, ...d.apparatus, ...d.books,
  ];

  /**
   * A cited work keeps the spelling its authors gave it. "Subword
   * Regularization" is the name of a paper, not a lapse, and silently
   * correcting it would misquote the source — so the spelling rule skips a
   * `title:` that sits beside a `url:`, which is exactly a citation and
   * nothing else.
   */
  const isCitationTitle = (lines, i) => {
    if (!/^\s*-?\s*title:/.test(lines[i] ?? '')) return false;
    return /^\s*url:/.test(lines[i + 1] ?? '') || /^\s*-?\s*url:/.test(lines[i - 1] ?? '');
  };

  /** An address is not prose. A slug inside one is not a spelling. */
  const insideUrl = (text, index) => {
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    for (const u of (text.slice(lineStart, text.indexOf('\n', index) + 1 || undefined)).matchAll(/\bhttps?:\/\/\S+/g)) {
      const from = lineStart + u.index;
      if (index >= from && index < from + u[0].length) return true;
    }
    return false;
  };

  for (const f of files) {
    const lines = f.text.split('\n');
    const lineAt = (index) => f.text.slice(0, index).split('\n').length;

    for (const phrase of FORBIDDEN) {
      for (const m of f.text.toLowerCase().matchAll(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))) {
        const line = lineAt(m.index);
        if (isCitationTitle(lines, line - 1) || insideUrl(f.text, m.index)) continue;
        errors.push(`${rel(f.file)}:${line}: "${phrase}" — §10 blocklist.`);
      }
    }

    for (const [wrong, right] of SPELLING) {
      for (const m of f.text.matchAll(new RegExp(`\\b${wrong}`, 'gi'))) {
        const line = lineAt(m.index);
        if (isCitationTitle(lines, line - 1) || insideUrl(f.text, m.index)) continue;
        errors.push(`${rel(f.file)}:${line}: "${m[0]}" — British spelling is "${right}" (§0).`);
      }
    }
  }

  // §9.2 — no hex literals in figure source; the palette is the only source
  // of colour, so a figure drawn for one theme reads in the other.
  const figDir = 'src/components/figures';
  let figs = [];
  try { figs = await readdir(figDir); } catch { /* no figures yet */ }
  for (const name of figs.filter((n) => n.endsWith('.astro'))) {
    const file = path.join(figDir, name);
    const text = await readFile(file, 'utf8');
    for (const m of text.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)) {
      const line = text.slice(0, m.index).split('\n').length;
      errors.push(`${rel(file)}:${line}: hex literal ${m[0]} — figures take colour only from the palette (§9.2).`);
    }
  }

  /**
   * A `$$` fence that opens with content after it and closes on a later line
   * is read as *inline* math, which then never closes — so every brace after
   * it leaks out and MDX reports a missing closing tag hundreds of lines away.
   * The build does fail, but it points at the wrong place, so catch it here
   * where the message can name the actual line.
   */
  for (const f of files) {
    const lines = f.text.split('\n');
    for (const [i, line] of lines.entries()) {
      const s = line.trim();
      if (!s.startsWith('$$') || s === '$$' || s.split('$$').length > 2) continue;
      errors.push(
        `${rel(f.file)}:${i + 1}: a display-maths block opens inline here and ` +
        `closes on a later line. Put both $$ fences on their own lines (§5.8).`
      );
    }
  }

  /**
   * A `^{...}` or `_{...}` outside a maths delimiter is LaTeX that escaped into
   * prose. MDX reads the brace as a JSX expression, fails to parse it, and
   * reports the error at a line that may be far from the cause — so name it
   * here instead.
   */
  for (const f of files) {
    // Only the body is MDX. Frontmatter is YAML and code fences are verbatim,
    // so a brace is harmless in both — checking them was the difference
    // between 3 real findings and 134.
    const offset = f.text.length - f.body.length;
    const lines = f.body.split('\n');
    const before = f.text.slice(0, offset).split('\n').length - 1;
    let inFence = false;
    let inMath = false;
    for (const [i, line] of lines.entries()) {
      const t = line.trim();
      if (t.startsWith('```')) { inFence = !inFence; continue; }
      if (t === '$$') { inMath = !inMath; continue; }
      if (inFence || inMath) continue;
      // Strip display maths before inline, or `$$x$$` is read as two empty
      // inline spans and its body is left exposed.
      const outside = line
        .replace(/\$\$[\s\S]*?\$\$/g, '')
        .replace(/\$[^$]*\$/g, '')
        .replace(/`[^`]*`/g, '');
      if (/[\^_]\{/.test(outside)) {
        errors.push(
          `${rel(f.file)}:${before + i + 1}: a superscript or subscript brace sits ` +
          `outside maths delimiters. MDX will read it as JSX. Wrap it in $…$ (§5.8).`
        );
      }
    }
  }

  // §5.7 — an equation numbered but never referenced should not be numbered.
  const cited = new Set();
  for (const f of files) for (const m of f.text.matchAll(/\(([IVX]+\.\d+\.\d+)\)/g)) cited.add(m[1]);
  for (const c of d.chapters) {
    for (const eq of list(c.data.keyEquations)) {
      const id = typeof eq === 'object' ? eq.id : eq;
      if (id && !cited.has(id))
        warnings.push(`${c.data.id}: equation (${id}) is numbered but never referenced (§5.7).`);
    }
  }

  return { errors, warnings, name: 'prose' };
}

// ── I-4 Reproduction snippets ──────────────────────────────────────────────
export async function verifySnippets(data) {
  const d = data ?? (await load());
  const errors = [];
  const warnings = [];
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);

  const claimed = d.problems.filter((p) => p.data.snippet);
  for (const p of claimed) {
    const script = path.join('scripts/snippets', String(p.data.snippet));
    const expected = script.replace(/\.py$/, '.expected.txt');
    try { await access(script); }
    catch {
      errors.push(`${p.data.id}: names snippet "${p.data.snippet}", which is not in scripts/snippets.`);
      continue;
    }
    let out;
    try {
      const r = await run('python3', [script], { timeout: 60_000 });
      out = r.stdout;
    } catch (err) {
      errors.push(`${p.data.id}: snippet failed — ${String(err.message).split('\n')[0]}`);
      continue;
    }
    let want;
    try { want = await readFile(expected, 'utf8'); }
    catch {
      errors.push(`${p.data.id}: snippet ran, but there is no ${rel(expected)} to diff its output against.`);
      continue;
    }
    if (out.trim() !== want.trim())
      errors.push(`${p.data.id}: snippet output does not match ${rel(expected)}. The prose and the code disagree about a number.`);
  }

  const unverified = d.problems.filter(
    (p) => p.data.verified === true && !p.data.snippet
  );
  for (const p of unverified)
    errors.push(`${p.data.id}: marked verified but names no snippet. Nothing was run.`);

  if (claimed.length === 0)
    warnings.push('No reproduction snippets yet. Invariant I-4 has nothing to check until a problem prints a number.');

  return { errors, warnings, name: 'snippets' };
}

export async function runAllGuards() {
  const data = await load();
  return Promise.all([
    checkMathQuota(data),  // §5   mathematics
    checkCoverage(data),   // §7   basics, concept, theory, practice
    checkPlacement(data),  // §6   one mechanism, one home
    checkGraph(data),      // I-7
    checkNotation(data),   // I-5
    lintProse(data),       // I-6
    verifySnippets(data),  // I-4
  ]);
}
