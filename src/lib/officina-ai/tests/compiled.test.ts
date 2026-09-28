import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examples, parsed, traceC, traceJava, type NativeTrace } from './compiled-native.ts';
import { instrumentC } from '../compiled/instrument-c.ts';
import { instrumentJava } from '../compiled/instrument-java.ts';
import { Edits, UnsupportedTrace } from '../compiled/instrument.ts';
import type { TraceStep, TraceValue } from '../trace/schema.ts';

/**
 * The C and Java tracers, held to two things: a traced program prints
 * exactly what it prints untraced, and the trace says what it did — the
 * values, the calls, the conditions — correctly.
 */

const where = (t: NativeTrace, line: number, event = 'line') => t.steps.filter((s) => s.line === line && s.event === event);
const set = (s: TraceStep, name: string) => s.changes?.find((c) => c[1] === name && c.length === 3)?.[2];
const removed = (s: TraceStep, name: string) => !!s.changes?.some((c) => c[1] === name && c.length === 2);
const declared = (t: NativeTrace, name: string) => t.steps.flatMap((s) => s.declared ?? []).find((d) => d[1] === name)?.[2];
const other = (v: TraceValue | undefined) => (v && typeof v === 'object' && 'r' in v ? v.r : v);

/** Addresses and the program's own path change from run to run; nothing else may. */
const steady = (s: string) => s.replace(/0x[0-9a-f]+/g, '0x…').replace(/\S*\/original\b/g, 'program');

for (const language of ['c', 'java'] as const) {
  test(`every ${language === 'c' ? 'C' : 'Java'} example traces, and prints what it prints untraced`, () => {
    for (const ex of examples(language)) {
      const t = (language === 'c' ? traceC : traceJava)(ex.code, { input: ex.stdin });
      if (t.end && 'error' in t.end) {
        // Only the example written to fail may: C gives a division by zero no
        // defined result, so its untraced run is no measure.
        assert.match(ex.title, /error|exception/i, `${ex.title} ended in an error`);
        continue;
      }
      assert.ok(t.end && ('done' in t.end || 'exit' in t.end), `${ex.title} did not finish: ${JSON.stringify(t.end)}`);
      assert.equal(steady(t.stdout), steady(t.original), ex.title);
    }
  });
}

test('C: values, pointers by what they point at, loops, conditions and calls', () => {
  const t = traceC(`#include <stdio.h>
int total(int *xs, int n) {
    int sum = 0;
    for (int i = 0; i < n; i++) sum += xs[i];
    return sum;
}
void bump(int *p) { *p += 1; }
int main(void) {
    int a[3] = {4, 5, 6};
    int x, y = 2;
    x = y > 1 ? 10 : 20;
    bump(&x);
    int *p = &a[1];
    printf("%d %d\\n", total(a, 3), *p);
    return 0;
}`);
  assert.equal(t.stdout, '15 5\n');
  assert.equal(declared(t, 'a'), 'int[3]');
  assert.equal(declared(t, 'p'), 'int *');
  assert.equal(other(set(where(t, 10)[0], 'x')), '?', 'declared without a value');
  assert.equal(set(where(t, 11)[0], 'x'), 10);
  const ternary = where(t, 11)[0].conditions!;
  assert.deepEqual(ternary.map((c) => [c.kind, c.expr, c.result, c.operands]), [['ternary', 'y > 1', true, [{ expr: 'y', value: 2 }]]]);
  // bump changes main's x through a pointer, and the trace says so while bump runs.
  const inBump = t.steps.find((s) => s.function === 'bump' && s.event === 'line')!;
  assert.equal(set(inBump, 'x'), 11);
  assert.equal(other(set(t.steps.find((s) => s.function === 'bump')!, 'p')), '→ x in main()');
  assert.equal(other(set(where(t, 13)[0], 'p')), '→ a[1]');
  const call = t.steps.find((s) => s.function === 'total' && s.event === 'call')!;
  assert.equal(call.callerLine, 14);
  assert.deepEqual(call.args?.map(([n, v]) => [n, other(v)]), [['xs', '→ a[0] in main()'], ['n', 3]]);
  assert.deepEqual(where(t, 4).filter((s) => s.loop).map((s) => s.loop), [
    { line: 4, iteration: 1 }, { line: 4, iteration: 2 }, { line: 4, iteration: 3 }, { line: 4, done: 3 },
  ]);
  assert.equal(t.steps.find((s) => s.function === 'total' && s.event === 'return')!.returnValue, 15);
  assert.ok(where(t, 5).some((s) => removed(s, 'i')), 'the loop variable leaves scope when the loop ends');
});

test('C: arrays, strings, structs, enums and 2-D arrays are shown as values', () => {
  const t = traceC(`#include <stdio.h>
typedef struct { int x, y; } Point;
enum Colour { RED, GREEN };
int main(void) {
    char name[8] = "Ada";
    Point p = {3, 4};
    enum Colour c = GREEN;
    int grid[2][2] = {{1, 2}, {3, 4}};
    const char *s = name;
    printf("%s %d %d %d %s\\n", name, p.x, c, grid[1][0], s);
    return 0;
}`);
  assert.equal(t.stdout, 'Ada 3 1 3 Ada\n');
  assert.equal(set(where(t, 5)[0], 'name'), 'Ada');
  assert.deepEqual(set(where(t, 6)[0], 'p'), { t: 'object', cls: 'Point', attrs: [['x', 3], ['y', 4]] });
  assert.equal(other(set(where(t, 7)[0], 'c')), 'GREEN');
  assert.deepEqual(set(where(t, 8)[0], 'grid'), { t: 'list', items: [{ t: 'list', items: [1, 2], n: 2 }, { t: 'list', items: [3, 4], n: 2 }], n: 2 });
  assert.equal(set(where(t, 9)[0], 's'), 'Ada');
  assert.equal(declared(t, 'grid'), 'int[2][2]');
});

test('C: input is read from the Input box, and each step says what it took', () => {
  const t = traceC(`#include <stdio.h>
int main(void) {
    int a = 0, b = 0;
    scanf("%d", &a);
    scanf("%d", &b);
    int c = getchar();
    printf("%d %d %d\\n", a, b, c);
    return 0;
}`, { input: '7 12' });
  assert.equal(t.stdout, '7 12 -1\n');
  assert.equal(where(t, 4)[0].stdin, '7');
  assert.equal(where(t, 5)[0].stdin, ' 12');
});

test('C: undefined behaviour stops the trace on the line that did it', () => {
  const cases: [string, number, RegExp][] = [
    ['int main(void) { int z = 0;\nint q = 10 / z;\nreturn q; }', 2, /Division by zero/],
    ['int main(void) { int a[3] = {0};\nfor (int i = 0; i <= 3; i++)\na[i] = i;\nreturn 0; }', 3, /Index out of bounds/],
    ['struct N { int v; };\nint main(void) { struct N *p = 0;\nreturn p->v; }', 3, /NULL pointer/],
    ['#include <assert.h>\nint main(void) { int x = 2;\nassert(x == 3);\nreturn 0; }', 3, /Assertion failed/],
  ];
  for (const [source, line, type] of cases) {
    const t = traceC(source);
    assert.ok(t.end && 'error' in t.end, source);
    const last = t.steps.at(-1)!;
    assert.equal(last.event, 'exception');
    assert.equal(last.line, line, source);
    assert.match(last.exception!.type, type);
  }
  const deep = traceC('int down(int n) { return down(n + 1); }\nint main(void) { return down(0); }', { original: false });
  assert.match(deep.steps.at(-1)!.exception!.type, /Stack overflow/);
  assert.match(traceC('int main(void) { int a[4] = {0};\nreturn a[4]; }').steps.at(-1)!.exception!.message, /Index 4 is outside int\[4\]/);
});

test('C: the step and output limits end a run, and say which', () => {
  const loop = traceC('int main(void) { long i = 0; while (1) { i++; } }', { limits: ['1000', '5', '262144'], original: false });
  assert.deepEqual(loop.end, { stop: 'steps', step: 999 });
  assert.equal(loop.steps.length, 1000);
  const flood = traceC('#include <stdio.h>\nint main(void) { for (;;) printf("0123456789"); }', { limits: ['50000', '5', '1000'], original: false });
  assert.equal(flood.end?.stop, 'output');
  assert.equal(flood.stdout.length, 1000);
  assert.equal(flood.steps.at(-1)!.partial, true);
});

test('C: exit() ends the run with what was printed so far', () => {
  const t = traceC('#include <stdio.h>\n#include <stdlib.h>\nint main(void) { printf("bye"); exit(3); }');
  assert.deepEqual(t.end, { exit: true });
  assert.equal(t.stdout, 'bye');
});

test('Java: objects, a caller\'s array changed by a callee, and definite assignment', () => {
  const t = traceJava(`public class Main {
    int count;
    void add(int by) { count += by; }
    static void bump(int[] a) { a[0] += 10; }
    public static void main(String[] args) {
        Main m = new Main();
        m.add(2);
        int[] xs = {1, 2};
        bump(xs);
        String grade;
        if (xs[0] > 5) grade = "big"; else grade = "small";
        System.out.println(m.count + " " + xs[0] + " " + grade);
    }
}`);
  assert.equal(t.stdout, '2 11 big\n');
  const add = t.steps.find((s) => s.function === 'add' && s.event === 'line')!;
  assert.deepEqual(set(add, 'this'), { t: 'object', cls: 'Main', attrs: [['count', 2]] });
  const inBump = t.steps.find((s) => s.function === 'bump' && s.event === 'line')!;
  assert.deepEqual(set(inBump, 'xs'), { t: 'list', items: [11, 2], n: 2 }, "main's array changes while bump runs");
  assert.equal(declared(t, 'xs'), 'int[]');
  assert.equal(set(where(t, 11).at(-1)!, 'grade'), 'big');
  const test = where(t, 11)[0].conditions![0];
  assert.deepEqual(test.operands, [{ expr: 'xs[0]', value: 11 }]);
});

test('Java: an exception is seen where it is thrown, as it leaves, and where it is caught', () => {
  const t = traceJava(`public class Main {
    static int divide(int a, int b) {
        return a / b;
    }
    public static void main(String[] args) {
        try {
            divide(1, 0);
        } catch (ArithmeticException e) {
            System.out.println("caught " + e.getMessage());
        }
        int[] a = new int[2];
        a[2] = 1;
    }
}`);
  const thrown = t.steps.find((s) => s.event === 'exception')!;
  assert.deepEqual([thrown.function, thrown.line, thrown.exception], ['divide', 3, { type: 'ArithmeticException', message: '/ by zero' }]);
  assert.equal(t.steps[thrown.step + 1].unwinding, true);
  assert.deepEqual(set(where(t, 9)[0], 'e'), { t: 'exception', cls: 'ArithmeticException', r: '/ by zero' });
  // Nothing catches the second; the run ends on it.
  assert.equal(t.end && 'error' in t.end, true);
  const last = t.steps.filter((s) => s.event === 'exception').at(-1)!;
  assert.deepEqual([last.line, last.exception?.type], [12, 'ArrayIndexOutOfBoundsException']);
});

test('Java: the step limit ends even a program that catches everything', () => {
  const t = traceJava('public class Main { public static void main(String[] a) { while (true) { try { int x = 1; } catch (Throwable e) { } } } }', { limits: ['1000', '5', '262144'], original: false });
  assert.deepEqual(t.end, { stop: 'steps', step: 999 });
  const deep = traceJava('public class Main { static int down(int n) { return down(n + 1); } public static void main(String[] a) { down(0); } }', { original: false });
  assert.equal(deep.steps.at(-1)!.exception?.type, 'StackOverflowError');
});

test('Java: input comes from the Input box', () => {
  const t = traceJava(`import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt();
        System.out.println(n * 2);
    }
}`, { input: '21\n' });
  assert.equal(t.stdout, '42\n');
});

test('programs the tracer cannot follow are refused with the line that says why', () => {
  const refuse = (language: 'c' | 'java', source: string, line: number) =>
    assert.throws(
      () => parsed(language, source, (root) => (language === 'c' ? instrumentC : instrumentJava)(root, source)),
      (e: unknown) => e instanceof UnsupportedTrace && e.line === line,
      source,
    );
  refuse('c', 'int main(void) {\n  int i = 0;\nagain:\n  if (++i < 3) goto again;\n  return 0;\n}', 4);
  refuse('c', 'int main(void) {\n  return (;\n}', 2);
  refuse('java', 'public class Main {\n  public static void main(String[] a) {\n    new Thread(() -> {}).start();\n  }\n}', 3);
  assert.throws(() => parsed('c', 'int _ot_x;\nint main(void) { return 0; }', (root) => instrumentC(root, 'int _ot_x;\nint main(void) { return 0; }')), UnsupportedTrace);
});

test('instrumenting only adds text, and never a line', () => {
  const source = '#include <stdio.h>\nint main(void) {\n  int x = 1;\n  if (x > 0) x++;\n  printf("%d\\n", x);\n  return 0;\n}\n';
  const { code } = parsed('c', source, (root) => instrumentC(root, source));
  const lines = code.split('\n');
  source.split('\n').forEach((original, i) => {
    let at = 0;
    for (const ch of original.replace(/\s/g, '')) {
      at = lines[i].indexOf(ch, at);
      assert.notEqual(at, -1, `line ${i + 1} lost ${JSON.stringify(ch)}: ${lines[i]}`);
      at++;
    }
  });
});

test('wraps that share a position nest: openings outer first, closings inner first', () => {
  const edits = new Edits();
  edits.wrap(0, 1, '(', ')');
  edits.wrap(0, 1, '[', ']');
  edits.insert(1, '!');
  edits.replace(1, 2, 'Y');
  assert.equal(edits.apply('ab'), '([a])!Y');
});
