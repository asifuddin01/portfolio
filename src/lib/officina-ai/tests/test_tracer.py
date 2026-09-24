"""
Deterministic tests for the Python tracer, run on native CPython.

Every assertion here is about a fact the tracer observed: which line ran,
what a variable became, what a condition evaluated to. The same tracer runs
inside Pyodide in the browser; pyodide.test.ts beside this file checks the two agree.

    npm run test:officina-ai
"""

import os
import sys
import textwrap
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'python'))

import tracer  # noqa: E402


def run(source, stdin='', **limits):
    return tracer.trace(textwrap.dedent(source).lstrip('\n'), stdin, limits or None)


def lines(steps, event='line'):
    return [s['line'] for s in steps if s['event'] == event]


def changes(steps, name):
    """Every value `name` took, in order, across all frames."""
    out = []
    for s in steps:
        for c in s.get('changes', []):
            if c[1] == name and len(c) == 3:
                out.append(c[2])
    return out


def conditions(steps):
    return [c for s in steps for c in s.get('conditions', [])]


class Basics(unittest.TestCase):
    def test_assignment_and_arithmetic(self):
        steps, result = run('''
            a = 17
            b = 5
            c = a // b
            d = a / b
        ''')
        self.assertEqual(result['status'], 'ok')
        self.assertTrue(result['complete'])
        self.assertEqual(lines(steps), [1, 2, 3, 4])
        self.assertEqual(changes(steps, 'c'), [3])
        # A float stays a float: 3.4 is not rendered as a bare number.
        self.assertEqual(changes(steps, 'd'), [{'t': 'float', 'r': '3.4'}])

    def test_steps_are_numbered_in_order(self):
        steps, _ = run('x = 1\ny = 2\n')
        self.assertEqual([s['step'] for s in steps], list(range(len(steps))))
        self.assertEqual(steps[0]['event'], 'call')
        self.assertEqual(steps[0]['function'], '<module>')
        self.assertEqual(steps[-1]['event'], 'return')

    def test_output_is_attached_to_the_line_that_printed_it(self):
        steps, result = run('''
            print("a")
            x = 2
            print("b", x)
        ''')
        printed = [(s['line'], s['stdout']) for s in steps if 'stdout' in s]
        self.assertEqual(printed, [(1, 'a\n'), (3, 'b 2\n')])
        self.assertEqual(result['stdout'], 'a\nb 2\n')

    def test_deleted_variable_is_reported(self):
        steps, _ = run('x = 1\ndel x\n')
        deletions = [c for s in steps for c in s.get('changes', []) if len(c) == 2]
        self.assertEqual(deletions, [[0, 'x']])


class Conditions(unittest.TestCase):
    def test_if_else_result_and_operands(self):
        steps, _ = run('''
            s = "madam"
            i = 0
            if s[i] != s[len(s) - 1 - i]:
                r = "no"
            else:
                r = "yes"
        ''')
        (cond,) = conditions(steps)
        self.assertEqual(cond['expr'], 's[i] != s[len(s) - 1 - i]')
        self.assertFalse(cond['result'])
        self.assertEqual(cond['operands'], [
            {'expr': 's[i]', 'value': 'm'},
            {'expr': 's[len(s) - 1 - i]', 'value': 'm'},
        ])
        self.assertEqual(lines(steps), [1, 2, 3, 6])
        self.assertEqual(changes(steps, 'r'), ['yes'])

    def test_short_circuit_operand_is_marked_skipped(self):
        steps, _ = run('''
            a = 0
            b = 5
            if a > 1 and b > 1:
                pass
        ''')
        (cond,) = conditions(steps)
        self.assertFalse(cond['result'])
        self.assertEqual(cond['operands'][0], {'expr': 'a', 'value': 0})
        self.assertEqual(cond['operands'][1], {'expr': 'b', 'skipped': True})

    def test_condition_is_evaluated_exactly_once(self):
        steps, result = run('''
            calls = []
            class Flag:
                def __bool__(self):
                    calls.append(1)
                    return True
            it = iter([5, 6])
            if next(it) > 0 and Flag():
                pass
            print(len(calls), next(it))
        ''')
        # Instrumentation must not re-run the test: one __bool__, one next().
        self.assertEqual(result['stdout'], '1 6\n')

    def test_elif_chain(self):
        steps, _ = run('''
            n = 7
            if n < 5:
                k = "small"
            elif n < 10:
                k = "medium"
            else:
                k = "large"
        ''')
        results = [(c['expr'], c['result']) for c in conditions(steps)]
        self.assertEqual(results, [('n < 5', False), ('n < 10', True)])
        self.assertEqual(changes(steps, 'k'), ['medium'])

    def test_ternary(self):
        steps, _ = run('x = 4\ny = "even" if x % 2 == 0 else "odd"\n')
        (cond,) = conditions(steps)
        self.assertEqual(cond['kind'], 'ternary')
        self.assertTrue(cond['result'])


class Loops(unittest.TestCase):
    def test_for_loop_iterations(self):
        steps, _ = run('''
            total = 0
            for i in range(3):
                total += i
            done = True
        ''')
        loop = [s['loop'] for s in steps if 'loop' in s]
        self.assertEqual(loop, [
            {'line': 2, 'iteration': 1},
            {'line': 2, 'iteration': 2},
            {'line': 2, 'iteration': 3},
            {'line': 2, 'done': 3},
        ])
        self.assertEqual(changes(steps, 'i'), [0, 1, 2])
        self.assertEqual(changes(steps, 'total'), [0, 1, 3])

    def test_while_loop_condition_each_pass(self):
        steps, _ = run('''
            n = 3
            while n > 0:
                n -= 1
        ''')
        self.assertEqual([c['result'] for c in conditions(steps)], [True, True, True, False])
        self.assertEqual([s['loop'] for s in steps if 'loop' in s][-1], {'line': 2, 'done': 3})

    def test_nested_loop_counter_restarts(self):
        steps, _ = run('''
            for i in range(2):
                for j in range(2):
                    pass
        ''')
        inner = [s['loop'] for s in steps if s.get('loop', {}).get('line') == 2]
        self.assertEqual(inner, [
            {'line': 2, 'iteration': 1}, {'line': 2, 'iteration': 2}, {'line': 2, 'done': 2},
            {'line': 2, 'iteration': 1}, {'line': 2, 'iteration': 2}, {'line': 2, 'done': 2},
        ])

    def test_break_then_fresh_loop(self):
        steps, _ = run('''
            for k in range(2):
                for i in range(10):
                    if i == 1:
                        break
        ''')
        inner = [s['loop']['iteration'] for s in steps
                 if s.get('loop', {}).get('line') == 2 and 'iteration' in s['loop']]
        self.assertEqual(inner, [1, 2, 1, 2])


class Functions(unittest.TestCase):
    def test_call_arguments_return_value_and_caller_line(self):
        steps, _ = run('''
            def add(a, b=2):
                return a + b
            x = add(3)
        ''')
        (call,) = [s for s in steps if s['event'] == 'call' and s['function'] == 'add']
        self.assertEqual(call['args'], [['a', 3], ['b', 2]])
        self.assertEqual(call['callerLine'], 3)
        self.assertEqual(call['depth'], 1)
        (ret,) = [s for s in steps if s['event'] == 'return' and s['function'] == 'add']
        self.assertEqual(ret['returnValue'], 5)
        # x is assigned after add has returned, which is when it happened.
        order = [(s['event'], s['function']) for s in steps]
        self.assertLess(order.index(('return', 'add')),
                        next(i for i, s in enumerate(steps) if [0, 'x', 5] in s.get('changes', [])))

    def test_recursion_depth_and_return_order(self):
        steps, _ = run('''
            def fact(n):
                if n <= 1:
                    return 1
                return n * fact(n - 1)
            r = fact(4)
        ''')
        calls = [(s['depth'], s['args'][0][1]) for s in steps if s['event'] == 'call' and s['function'] == 'fact']
        self.assertEqual(calls, [(1, 4), (2, 3), (3, 2), (4, 1)])
        returns = [s['returnValue'] for s in steps if s['event'] == 'return' and s['function'] == 'fact']
        self.assertEqual(returns, [1, 2, 6, 24])

    def test_callee_mutation_is_seen_in_caller_frame(self):
        steps, _ = run('''
            def push(xs):
                xs.append(9)
            def main():
                data = [1]
                push(data)
                return data
            main()
        ''')
        # `data` belongs to main's frame, and changes while push is running.
        push_line = next(s for s in steps if s['function'] == 'push' and s['event'] == 'line')
        main_fid = next(s['fid'] for s in steps if s['event'] == 'call' and s['function'] == 'main')
        self.assertIn([main_fid, 'data', {'t': 'list', 'items': [1, 9], 'n': 2}], push_line['changes'])

    def test_global_statement_updates_module_scope(self):
        steps, _ = run('''
            count = 0
            def bump():
                global count
                count += 1
            bump()
        ''')
        self.assertEqual(changes(steps, 'count'), [0, 1])

    def test_nonlocal_closure(self):
        steps, _ = run('''
            def outer():
                n = 0
                def inc():
                    nonlocal n
                    n += 1
                inc()
                inc()
                return n
            outer()
        ''')
        outer = next(s['fid'] for s in steps if s['event'] == 'call' and s['function'] == 'outer')
        seen = [c[2] for s in steps for c in s.get('changes', []) if c[:2] == [outer, 'n']]
        # inc() rebinds a cell that belongs to outer's frame while outer waits.
        self.assertEqual(seen, [0, 1, 2])

    def test_generator_yields_are_call_and_return(self):
        steps, result = run('''
            def gen():
                yield 1
                yield 2
            total = sum(gen())
        ''')
        rets = [s.get('returnValue') for s in steps if s['event'] == 'return' and s['function'] == 'gen']
        self.assertEqual(rets[:2], [1, 2])
        self.assertEqual(changes(steps, 'total'), [3])

    def test_methods_and_object_attributes(self):
        steps, _ = run('''
            class Node:
                def __init__(self, val):
                    self.val = val
                    self.next = None
            a = Node(1)
            a.next = Node(2)
        ''')
        final = changes(steps, 'a')[-1]
        self.assertEqual(final['t'], 'object')
        self.assertEqual(final['cls'], 'Node')
        nxt = dict(final['attrs'])['next']
        self.assertEqual(dict(nxt['attrs'])['val'], 2)


class Errors(unittest.TestCase):
    def test_syntax_error_has_no_trace(self):
        steps, result = run('x = (1,\ny = 2\n')
        self.assertEqual(steps, [])
        self.assertEqual(result['status'], 'syntax')
        self.assertEqual(result['error']['kind'], 'syntax')
        self.assertIsNotNone(result['error']['line'])

    def test_compile_time_error_is_a_syntax_error(self):
        steps, result = run('return 5\n')
        self.assertEqual(steps, [])
        self.assertEqual(result['status'], 'syntax')

    def test_runtime_error_points_at_the_step_that_raised(self):
        steps, result = run('''
            def div(a, b):
                return a / b
            x = 1
            y = div(x, 0)
            z = 3
        ''')
        self.assertEqual(result['status'], 'error')
        err = result['error']
        self.assertEqual((err['type'], err['line'], err['kind']), ('ZeroDivisionError', 2, 'runtime'))
        raised = steps[err['step']]
        self.assertEqual(raised['event'], 'exception')
        self.assertEqual(raised['function'], 'div')
        # Line 5 never ran; the trace must not say it did.
        self.assertNotIn(5, lines(steps))
        unwound = [s for s in steps if s['event'] == 'return' and s['function'] == 'div']
        self.assertTrue(unwound[0].get('unwinding'))
        self.assertNotIn('returnValue', unwound[0])

    def test_handled_exception_continues(self):
        steps, result = run('''
            try:
                int("x")
            except ValueError as e:
                msg = "bad"
            print(msg)
        ''')
        self.assertEqual(result['status'], 'ok')
        self.assertEqual([s['exception']['type'] for s in steps if s['event'] == 'exception'], ['ValueError'])
        self.assertEqual(result['stdout'], 'bad\n')

    def test_deep_recursion(self):
        steps, result = run('''
            def down(n):
                return down(n + 1)
            down(0)
        ''', max_steps=1_000_000, max_seconds=20)
        self.assertEqual(result['status'], 'error')
        self.assertEqual(result['error']['kind'], 'recursion')

    def test_sys_exit_is_a_normal_ending(self):
        _, result = run('import sys\nprint("bye")\nsys.exit(3)\nprint("never")\n')
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['exitCode'], 3)
        self.assertEqual(result['stdout'], 'bye\n')


class Limits(unittest.TestCase):
    def test_step_limit_marks_trace_incomplete(self):
        stops = []
        steps = []
        import json
        result = tracer.run('while True:\n    pass\n', '', {'max_steps': 200},
                            lambda t: steps.extend(json.loads(t)), False, stops.append)
        self.assertEqual(result['status'], 'stopped')
        self.assertFalse(result['complete'])
        self.assertEqual(result['stopped']['reason'], 'steps')
        self.assertEqual(len(steps), 200)
        self.assertEqual(len(stops), 1)            # reported the moment it stopped

    def test_time_limit(self):
        began = time.perf_counter()
        _, result = run('while True:\n    x = 1\n', max_seconds=0.2, max_steps=10**9)
        self.assertLess(time.perf_counter() - began, 2)
        self.assertEqual(result['stopped']['reason'], 'time')

    def test_except_exception_cannot_swallow_the_stop(self):
        _, result = run('''
            while True:
                try:
                    pass
                except Exception:
                    pass
        ''', max_steps=300)
        self.assertEqual(result['stopped']['reason'], 'steps')

    def test_output_limit(self):
        steps, result = run('while True:\n    print("x" * 100)\n', max_output=1000, max_steps=10**9)
        self.assertEqual(result['stopped']['reason'], 'output')
        self.assertEqual(len(result['stdout']), 1000)
        self.assertTrue(steps[-1].get('partial'))
        self.assertEqual(''.join(s.get('stdout', '') for s in steps), result['stdout'])

    def test_source_size_limit(self):
        _, result = run('x = 1\n' * 100, max_source=50)
        self.assertEqual(result['status'], 'rejected')

    def test_first_steps_are_sent_one_at_a_time(self):
        import json
        chunks = []
        tracer.run('for i in range(100):\n    pass\n', '', {'eager_steps': 10}, lambda t: chunks.append(json.loads(t)))
        self.assertEqual([len(c) for c in chunks[:10]], [1] * 10)

    def test_chunks_arrive_in_order(self):
        import json
        chunks = []
        tracer.run('for i in range(100):\n    pass\n', '', {'chunk_size': 25, 'eager_steps': 0, 'flush_seconds': 60},
                   lambda t: chunks.append(json.loads(t)))
        self.assertGreater(len(chunks), 4)
        self.assertTrue(all(len(c) == 25 for c in chunks[:-1]))
        numbers = [s['step'] for c in chunks for s in c]
        self.assertEqual(numbers, list(range(len(numbers))))


class Input(unittest.TestCase):
    def test_input_reads_stdin_and_is_recorded(self):
        steps, result = run('name = input("Name? ")\nprint("hi", name)\n', stdin='Ada\n')
        self.assertEqual(changes(steps, 'name'), ['Ada'])
        self.assertEqual(steps[1].get('stdin'), 'Ada\n')
        self.assertEqual(result['stdout'], 'Name? hi Ada\n')

    def test_input_without_stdin_is_eof(self):
        _, result = run('x = input()\n')
        self.assertEqual(result['error']['type'], 'EOFError')


class Isolation(unittest.TestCase):
    def test_program_cannot_break_the_tracer_through_json(self):
        steps, result = run('import json\njson.dumps = None\nx = [1, 2]\n')
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(changes(steps, 'x'), [{'t': 'list', 'items': [1, 2], 'n': 2}])

    def test_builtins_do_not_leak_between_runs(self):
        run('import builtins\nbuiltins.print = None\nbuiltins.len = None\nbuiltins.leak = 1\n')
        _, result = run('print("still here", len("ab"))\nprint(hasattr(__builtins__, "leak"))\n')
        self.assertEqual(result['stdout'], 'still here 2\nFalse\n')

    def test_breaking_builtins_does_not_break_the_tracer(self):
        steps, result = run('import builtins\nbuiltins.len = None\nbuiltins.isinstance = None\nx = [1, 2]\ny = 3\n')
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(changes(steps, 'y'), [3])

    def test_turning_tracing_off_is_reported(self):
        _, result = run('import sys\nsys.settrace(None)\nx = 1\n')
        self.assertFalse(result['complete'])
        self.assertIn('incompleteReason', result)

    def test_helpers_are_not_shown_as_variables(self):
        steps, _ = run('x = 1\nif x:\n    y = 2\n')
        names = {c[1] for s in steps for c in s.get('changes', [])}
        self.assertEqual(names, {'x', 'y'})

    def test_same_program_same_trace(self):
        src = 'a = [3, 1, 2]\na.sort()\nfor v in a:\n    print(v)\n'
        self.assertEqual(run(src)[0], run(src)[0])


class Values(unittest.TestCase):
    def test_encodings(self):
        enc = tracer.encode
        self.assertEqual(enc(2**60), {'t': 'int', 'r': str(2**60)})
        self.assertEqual(enc(1.0), {'t': 'float', 'r': '1.0'})
        self.assertEqual(enc('x' * 300)['n'], 300)
        self.assertEqual(enc((1,)), {'t': 'tuple', 'items': [1], 'n': 1})
        self.assertEqual(enc({'a': 1}), {'t': 'dict', 'items': [['a', 1]], 'n': 1})
        self.assertEqual(enc(range(3)), {'t': 'other', 'cls': 'range', 'r': 'range(0, 3)'})
        big = enc(list(range(1000)))
        self.assertEqual((len(big['items']), big['n']), (tracer.MAX_ITEMS, 1000))

    def test_cycles_and_depth_are_bounded(self):
        a = [1]
        a.append(a)
        self.assertEqual(tracer.encode(a)['items'][1], {'t': 'cycle', 'cls': 'list'})
        deep = [[[[[1]]]]]
        self.assertEqual(tracer.encode(deep)['items'][0]['items'][0]['items'][0], {'t': 'more', 'cls': 'list'})

    def test_user_repr_is_never_called(self):
        steps, result = run('''
            class Loud:
                def __repr__(self):
                    print("repr ran")
                    return "Loud"
            x = Loud()
        ''')
        self.assertEqual(result['stdout'], '')


class Speed(unittest.TestCase):
    def test_five_thousand_steps_natively(self):
        src = '''
            def bubble(xs):
                n = len(xs)
                for i in range(n):
                    for j in range(n - 1 - i):
                        if xs[j] > xs[j + 1]:
                            xs[j], xs[j + 1] = xs[j + 1], xs[j]
                return xs
            data = list(range(60, 0, -1))
            bubble(data)
        '''
        began = time.perf_counter()
        steps, result = run(src)
        took = time.perf_counter() - began
        self.assertGreater(len(steps), 4000)
        # Native CPython; Pyodide is measured against the real budget in pyodide.test.ts.
        # Judged locally only: on a shared CI runner this mostly measures the runner.
        if not os.environ.get('CI'):
            self.assertLess(took, 0.5, f'{len(steps)} steps took {took * 1000:.0f} ms')


if __name__ == '__main__':
    unittest.main()
