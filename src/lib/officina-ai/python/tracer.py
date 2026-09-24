"""
The Python tracer: what a program actually did, one step at a time.

Every Python trace Officina shows comes from this file. It runs the reader's
program under ``sys.settrace`` and records what the interpreter did: which
line ran, which variables changed and to what, what each condition evaluated
to and why, which function was called with which arguments, what it returned,
and what it printed. If something was not observed it is not in the trace.
An AI layer may explain a trace afterwards; it never writes one.

The same file runs in two places, unchanged:

* inside Pyodide, in a Web Worker (worker.js), which is how the browser uses
  it; and
* under native CPython 3.14, which is how tests/test_tracer.py exercises it.

Both must produce the same trace for the same program. tests/pyodide.test.ts
holds them to that.

What a step is
--------------
A step is emitted when something *finishes*: a line has run, a function has
been entered, a function has returned, an exception has been raised. A line
step carries the state after that line ran and every variable it changed, so
the reader sees ``x = f(3)`` together with ``x`` becoming 9 — after the steps
inside ``f`` rather than before them, which is the order it happened in.

Conditions are recorded by instrumentation, not by re-evaluating anything:
each ``if``/``while``/ternary test is wrapped so that its operands and result
are captured *as the program computes them*. Evaluating ``s[i]`` a second
time to display it could run user code twice; wrapping it cannot.
"""

import ast
import builtins
import io
import itertools
import json
import sys
import time
import types

# The tracer's own name lookups — len, isinstance, type and the rest — go to
# a private copy of builtins taken now, before any program has run. Every
# function below is created with this copy, so a program that does
# `builtins.len = None` breaks itself and not the tracer watching it.
__builtins__ = dict(builtins.__dict__)

SCHEMA = 1
FILENAME = '<officina>'

DEFAULT_LIMITS = {
    'max_steps': 50_000,       # a trace longer than this is stopped and marked incomplete
    'max_seconds': 5.0,        # wall clock, checked on every step
    'max_output': 256 * 1024,  # characters of stdout + stderr
    'max_source': 200 * 1024,  # characters of program text
    'chunk_size': 1000,        # steps per chunk handed to on_chunk
    'eager_steps': 64,         # the first steps go out one at a time, so they are on screen at once
    'flush_seconds': 0.1,      # and after that, nothing waits in the buffer longer than this
}

# How much of a value a step records. A 10,000-element list is shown as its
# first MAX_ITEMS elements and its length; nesting past MAX_DEPTH is elided.
MAX_STR = 200
MAX_ITEMS = 50
MAX_DEPTH = 3
MAX_SAFE_INT = 2**53 - 1       # beyond this a JSON number is not exact in JavaScript

# Held here so a program that reassigns json.dumps or time.perf_counter
# cannot break the tracer that is watching it.
_dumps = json.dumps
_loads = json.loads
_perf = time.perf_counter
_settrace = sys.settrace
_gettrace = sys.gettrace
_getframe = sys._getframe


def _make_json():
    """
    JSON text for what the tracer records, without going through json.dumps.

    json.dumps is Python code that looks names up in the real builtins, so a
    program that sets `builtins.isinstance = None` would break every step
    after it. The C encoder underneath checks types itself and looks nothing
    up. Everything the tracer encodes is plain dicts, lists, strings,
    integers, booleans and None, which is all it needs to handle.
    """
    try:
        from json import encoder
        make = encoder.c_make_encoder
        if make is None:
            raise ImportError
        encode = make(None, None, encoder.encode_basestring, None, ':', ',', False, False, True)
        return lambda value: ''.join(encode(value, 0))
    except (ImportError, AttributeError, TypeError):
        return lambda value: _dumps(value, ensure_ascii=False, separators=(',', ':'))


_json = _make_json()


class TraceStopped(BaseException):
    """
    Ends a run that has hit a limit.

    A BaseException so that ``except Exception:`` in the reader's code cannot
    swallow it. A bare ``except:`` still can; worker.js covers that case by
    terminating the worker, and the trace has already been reported by then.
    """

    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason
        self.message = message


# ── Values ─────────────────────────────────────────────────────────────────

_IMMUTABLE = frozenset({
    type(None), bool, int, float, complex, str, bytes, range,
    types.FunctionType, types.BuiltinFunctionType, types.ModuleType, type,
})
_REPR_SAFE = frozenset({range, bytes, bytearray, complex, slice})
_REPR_SAFE_MODULES = frozenset({'decimal', 'fractions', 'datetime', '_pydecimal', '_decimal', 'enum'})


def _clip(text, limit=MAX_STR):
    return text if len(text) <= limit else text[:limit] + '…'


def _int_repr(value):
    try:
        text = repr(value)
    except ValueError:            # past the interpreter's int→str digit limit
        return f'<{value.bit_length()}-bit integer>'
    return text if len(text) <= 60 else f'{text[:24]}…{text[-12:]} ({len(text)} digits)'


def encode(value, depth=0, seen=None):
    """
    A JSON-safe description of a value, without running the reader's code.

    Built-in containers are walked structurally and user objects are read
    through their ``__dict__``; nothing calls a user-defined ``__repr__``,
    which could be slow, have side effects, or lie.
    """
    t = type(value)
    if value is None or t is bool:
        return value
    if t is int:
        return value if -MAX_SAFE_INT <= value <= MAX_SAFE_INT else {'t': 'int', 'r': _int_repr(value)}
    if t is float:
        return {'t': 'float', 'r': repr(value)}
    if t is str:
        return value if len(value) <= MAX_STR else {'t': 'str', 'v': value[:MAX_STR], 'n': len(value)}

    if t is types.FunctionType or t is types.BuiltinFunctionType:
        return {'t': 'function', 'name': value.__qualname__}
    if t is types.MethodType:
        return {'t': 'function', 'name': value.__func__.__qualname__}
    if t is types.ModuleType:
        return {'t': 'module', 'name': value.__name__}
    if isinstance(value, type):
        return {'t': 'class', 'name': value.__qualname__}
    if t in _REPR_SAFE or t.__module__ in _REPR_SAFE_MODULES:
        return {'t': 'other', 'cls': t.__qualname__, 'r': _clip(repr(value))}

    if depth >= MAX_DEPTH:
        return {'t': 'more', 'cls': t.__qualname__}
    if seen is None:
        seen = set()
    if id(value) in seen:
        return {'t': 'cycle', 'cls': t.__qualname__}
    seen.add(id(value))
    try:
        return _encode_compound(value, t, depth, seen)
    finally:
        seen.discard(id(value))


def _encode_compound(value, t, depth, seen):
    kind = None
    if issubclass(t, list):
        kind = 'list'
    elif issubclass(t, tuple):
        kind = 'tuple'
    elif issubclass(t, (set, frozenset)):
        kind = 'set' if issubclass(t, set) else 'frozenset'
    elif t.__name__ == 'deque' and t.__module__ == 'collections':
        kind = 'list'

    if kind is not None:
        out = {'t': kind, 'items': [encode(x, depth + 1, seen) for x in itertools.islice(value, MAX_ITEMS)], 'n': len(value)}
        if t.__module__ != 'builtins':
            out['cls'] = t.__qualname__
        return out

    if issubclass(t, dict):
        out = {
            't': 'dict',
            'items': [[encode(k, depth + 1, seen), encode(v, depth + 1, seen)]
                      for k, v in itertools.islice(dict.items(value), MAX_ITEMS)],
            'n': len(value),
        }
        if t is not dict:
            out['cls'] = t.__qualname__
        return out

    if issubclass(t, BaseException):
        try:
            message = str(value)
        except Exception:
            message = ''
        return {'t': 'exception', 'cls': t.__qualname__, 'r': _clip(message)}

    attrs = _attributes(value, t)
    if attrs is not None and t.__module__ != 'builtins':
        return {'t': 'object', 'cls': t.__qualname__,
                'attrs': [[k, encode(v, depth + 1, seen)] for k, v in attrs]}
    return {'t': 'other', 'cls': t.__qualname__, 'r': f'<{t.__qualname__} object>'}


def _attributes(value, t):
    """An instance's attributes, read without calling the class's own hooks."""
    try:
        d = object.__getattribute__(value, '__dict__')
        if type(d) is dict:
            return list(itertools.islice(dict.items(d), MAX_ITEMS))
    except Exception:
        pass
    slots = []
    for klass in t.__mro__:
        for name in klass.__dict__.get('__slots__', ()):
            try:
                slots.append((name, object.__getattribute__(value, name)))
            except Exception:
                pass
    return slots or None


def _visible(name, prefix):
    return not (name.startswith('__') and name.endswith('__')) and not name.startswith(prefix)


# ── Static structure ───────────────────────────────────────────────────────

def _structure(tree):
    """Functions, classes and loops, for the program outline and loop counting."""
    functions, classes, loops = [], [], {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            a = node.args
            params = [p.arg for p in (*a.posonlyargs, *a.args)]
            if a.vararg:
                params.append('*' + a.vararg.arg)
            params += [p.arg for p in a.kwonlyargs]
            if a.kwarg:
                params.append('**' + a.kwarg.arg)
            functions.append({'name': node.name, 'line': node.lineno, 'end': node.end_lineno, 'params': params})
        elif isinstance(node, ast.ClassDef):
            classes.append({'name': node.name, 'line': node.lineno, 'end': node.end_lineno})
        elif isinstance(node, (ast.For, ast.AsyncFor, ast.While)):
            body_start = node.body[0].lineno
            if body_start == node.lineno:
                continue      # `for x in y: f(x)` on one line; nothing to count between
            loops[node.lineno] = {
                'kind': 'while' if isinstance(node, ast.While) else 'for',
                'body': (body_start, node.body[-1].end_lineno),
                'end': node.end_lineno,
            }
    functions.sort(key=lambda f: f['line'])
    classes.sort(key=lambda c: c['line'])
    return functions, classes, loops


# ── Instrumentation ────────────────────────────────────────────────────────

class _Instrument(ast.NodeTransformer):
    """
    Wraps every ``if``, ``while`` and ternary test so its result and operands
    are recorded as they are computed.

    ``if s[i] != s[j]:`` becomes
    ``if COND(0, VAL(0, 0, s[i]) != VAL(0, 1, s[j])):``. VAL returns its
    argument untouched, and COND returns ``bool(test)`` — the one truthiness
    check the ``if`` would have made anyway — so the program computes exactly
    what it would have, once, in the same order. Operands a short-circuit
    skips are never evaluated and are recorded as skipped.

    Every inserted node takes the location of the node it wraps, so no line
    number changes and no extra line events are produced.
    """

    def __init__(self, source, cond_name, val_name):
        self.source = source
        self.cond_name = cond_name
        self.val_name = val_name
        self.conditions = []

    def _segment(self, node):
        return ast.get_source_segment(self.source, node) or ast.unparse(node)

    def _call(self, name, args, at):
        func = ast.copy_location(ast.Name(id=name, ctx=ast.Load()), at)
        return ast.copy_location(ast.Call(func=func, args=args, keywords=[]), at)

    def _const(self, value, at):
        return ast.copy_location(ast.Constant(value=value), at)

    def _wrap(self, test, node, kind):
        cid = len(self.conditions)
        operands = []

        def value(expr):
            if isinstance(expr, ast.Constant):
                return expr               # nothing to learn from a literal
            k = len(operands)
            operands.append(self._segment(expr))
            return self._call(self.val_name, [self._const(cid, expr), self._const(k, expr), expr], expr)

        def walk(expr):
            if isinstance(expr, ast.Compare):
                expr.left = value(expr.left)
                expr.comparators = [value(c) for c in expr.comparators]
                return expr
            if isinstance(expr, ast.BoolOp):
                expr.values = [walk(v) for v in expr.values]
                return expr
            if isinstance(expr, ast.UnaryOp) and isinstance(expr.op, ast.Not):
                expr.operand = walk(expr.operand)
                return expr
            if isinstance(expr, (ast.Name, ast.Attribute, ast.Subscript)):
                return value(expr)
            return expr

        text = self._segment(test)
        wrapped = walk(test)
        self.conditions.append({'line': node.lineno, 'kind': kind, 'expr': text, 'operands': operands})
        return self._call(self.cond_name, [self._const(cid, test), wrapped], test)

    def visit_If(self, node):
        self.generic_visit(node)
        node.test = self._wrap(node.test, node, 'if')
        return node

    def visit_While(self, node):
        self.generic_visit(node)
        node.test = self._wrap(node.test, node, 'while')
        return node

    def visit_IfExp(self, node):
        self.generic_visit(node)
        node.test = self._wrap(node.test, node, 'ternary')
        return node


# ── Standard streams ───────────────────────────────────────────────────────

class _Out(io.TextIOBase):
    def __init__(self, tracer, stream):
        self._tracer = tracer
        self._stream = stream

    def writable(self):
        return True

    def isatty(self):
        return False

    @property
    def encoding(self):
        return 'utf-8'

    def write(self, text):
        if not isinstance(text, str):
            raise TypeError(f'write() argument must be str, not {type(text).__name__}')
        self._tracer._write(self._stream, text)
        return len(text)

    def flush(self):
        pass


class _In(io.TextIOBase):
    """stdin, fed from the text the reader supplied, with every read recorded."""

    def __init__(self, tracer, text):
        self._tracer = tracer
        self._buffer = io.StringIO(text)

    def readable(self):
        return True

    def isatty(self):
        return False

    @property
    def encoding(self):
        return 'utf-8'

    def readline(self, size=-1):
        line = self._buffer.readline(size)
        self._tracer._read(line)
        return line

    def read(self, size=-1):
        text = self._buffer.read(size)
        self._tracer._read(text)
        return text


# ── The tracer ─────────────────────────────────────────────────────────────

class _Frame:
    __slots__ = ('fid', 'frame', 'function', 'depth', 'pending', 'cache', 'loops',
                 'raised', 'volatile', 'is_module', 'cells')

    def __init__(self, fid, frame, depth):
        code = frame.f_code
        self.fid = fid
        self.frame = frame
        self.function = code.co_qualname
        self.depth = depth
        self.pending = None           # the line that has started and not yet finished
        self.cache = {}               # name -> (object, encoded json, encoded value)
        self.loops = []               # [header line, iterations] for loops currently running
        self.raised = False           # an exception is propagating through this frame
        self.volatile = False         # holds something another frame could change
        self.is_module = code.co_name == '<module>'
        self.cells = bool(code.co_cellvars or code.co_freevars)


class Tracer:
    def __init__(self, source, limits, loops, conditions, prefix, on_chunk, on_stop=None):
        self.on_stop = on_stop
        self.muted = False            # set while the tracer itself is reading a value
        self.raising = []             # steps of an exception still propagating
        self.source = source
        self.limits = limits
        self.loops = loops
        self.conditions = conditions
        self.prefix = prefix
        self.on_chunk = on_chunk

        self.count = 0
        self.chunk = []
        self.stack = []
        self.by_frame = {}
        self.next_fid = 0

        self.out = []                 # stdout since the last step
        self.err = []
        self.inp = []
        self.conds = []               # conditions evaluated since the last step
        self.operands = {}            # (fid, cid) -> {k: encoded value}
        self.stdout = []
        self.stderr = []
        self.written = 0

        self.started = _perf()
        self.flushed = self.started
        self.deadline = self.started + limits['max_seconds']
        self.stopped = None
        self.memo = None

    # sys.settrace entry point: a new frame is starting.
    def global_trace(self, frame, event, arg):
        if self.stopped is not None or self.muted or frame.f_code.co_filename != FILENAME:
            return None
        caller = self.stack[-1] if self.stack else None
        fs = _Frame(self.next_fid, frame, len(self.stack))
        self.next_fid += 1
        self.stack.append(fs)
        self.by_frame[frame] = fs

        step = {'event': 'call', 'line': frame.f_lineno, 'fid': fs.fid,
                'function': fs.function, 'depth': fs.depth}
        if caller is not None:
            step['parent'] = caller.fid
            if caller.pending is not None:
                step['callerLine'] = caller.pending
        if not fs.is_module:
            code = frame.f_code
            n = code.co_argcount + code.co_kwonlyargcount
            n += bool(code.co_flags & 0x04) + bool(code.co_flags & 0x08)   # *args, **kwargs
            f_locals = frame.f_locals
            args = [[name, encode(f_locals[name])] for name in code.co_varnames[:n] if name in f_locals]
            if args:
                step['args'] = args
        self._emit(step)
        return self.local_trace

    def local_trace(self, frame, event, arg):
        if self.stopped is not None:
            return None
        fs = self.by_frame.get(frame)
        if fs is None:
            return None
        if event == 'line':
            self._line(fs, frame.f_lineno)
        elif event == 'return':
            self._return(fs, frame, arg)
        elif event == 'exception':
            self._exception(fs, frame, arg)
        return self.local_trace

    def _finish(self, fs, next_line):
        """
        Emit the step for the line `fs` was running, now that it has finished.

        `next_line` is where execution went: the next line in this frame, or
        None when the frame is being left. That is what tells a loop header
        apart — into the body is another iteration, anywhere else is the end.
        """
        step = {'event': 'line', 'line': fs.pending, 'fid': fs.fid,
                'function': fs.function, 'depth': fs.depth}
        fs.pending = None
        loop = self.loops.get(step['line'])
        if loop is not None and fs.loops and fs.loops[-1][0] == step['line']:
            entry = fs.loops[-1]
            start, end = loop['body']
            if next_line is not None and start <= next_line <= end:
                entry[1] += 1
                step['loop'] = {'line': entry[0], 'iteration': entry[1]}
            else:
                step['loop'] = {'line': entry[0], 'done': entry[1]}
        self._emit(step)

    def _line(self, fs, line):
        if fs.pending is not None:
            self._finish(fs, line)

        # Loops this line has left, innermost first; then, if this line is a
        # loop header reached from outside the loop, a fresh run of it.
        while fs.loops:
            header = fs.loops[-1][0]
            if header <= line <= self.loops[header]['end']:
                break
            fs.loops.pop()
        if line in self.loops and not (fs.loops and fs.loops[-1][0] == line):
            fs.loops.append([line, 0])

        self.raising = []             # a line is running, so any earlier exception was handled
        fs.raised = False
        fs.pending = line

    def _return(self, fs, frame, value):
        if fs.pending is not None:
            self._finish(fs, None)
        step = {'event': 'return', 'line': frame.f_lineno, 'fid': fs.fid,
                'function': fs.function, 'depth': fs.depth}
        if fs.raised:
            step['unwinding'] = True           # left by an exception, not a return
        elif not fs.is_module:
            step['returnValue'] = encode(value)
        self._emit(step)
        self.stack.pop()
        self.by_frame.pop(frame, None)

    def _exception(self, fs, frame, arg):
        kind, value, _ = arg
        if kind is TraceStopped:
            return
        if fs.pending is not None:
            self._finish(fs, None)
        try:
            message = str(value)
        except Exception:
            message = ''
        self.raising.append(self.count)
        self._emit({'event': 'exception', 'line': frame.f_lineno, 'fid': fs.fid,
                    'function': fs.function, 'depth': fs.depth,
                    'exception': {'type': kind.__qualname__, 'message': _clip(message, 500)}})
        fs.raised = True
        fs.pending = None

    # ── Emitting ──

    def _emit(self, step):
        self._record(step)
        now = _perf()
        # A worker killed from outside takes its unsent steps with it, so the
        # buffer is kept short: every step at first, then by size or by age.
        if (len(self.chunk) >= self.limits['chunk_size'] or self.count <= self.limits['eager_steps']
                or now - self.flushed > self.limits['flush_seconds']):
            self.flush()
        if self.count >= self.limits['max_steps']:
            self.stop('steps', f"Stopped after {self.count:,} steps — the step limit. "
                               f"The trace up to that point is shown; it is incomplete.")
        if now > self.deadline:
            self.stop('time', f"Stopped after {self.limits['max_seconds']:g} s — the time limit. "
                              f"The trace up to that point is shown; it is incomplete.")

    def _record(self, step):
        step['step'] = self.count
        changes = self._changes()
        if changes:
            step['changes'] = changes
        if self.conds:
            step['conditions'] = self.conds
            self.conds = []
        if self.out:
            step['stdout'] = ''.join(self.out)
            self.out.clear()
        if self.err:
            step['stderr'] = ''.join(self.err)
            self.err.clear()
        if self.inp:
            step['stdin'] = ''.join(self.inp)
            self.inp.clear()
        self.chunk.append(step)
        self.count += 1

    def flush(self):
        self.flushed = _perf()
        if self.chunk:
            chunk, self.chunk = self.chunk, []
            if self.on_chunk is not None:
                self.on_chunk(_json(chunk))

    def stop(self, reason, message):
        self.stopped = {'reason': reason, 'message': message, 'step': self.count - 1}
        self.flush()
        if self.on_stop is not None:
            # Said now, not when exec returns: a program that catches
            # BaseException may never return, and the trace is already whole.
            self.on_stop(_json(self.stopped))
        raise TraceStopped(reason, message)

    def _changes(self):
        """
        What changed since the last step, in every frame that could have changed.

        The current frame and the module's globals are always compared. Other
        frames on the stack only when they hold something mutable or share a
        closure cell — a caller's integers cannot change while it is waiting,
        but a list it passed down can.
        """
        self.memo = {}
        changes = []
        last = len(self.stack) - 1
        for i, fs in enumerate(self.stack):
            if i == last or fs.is_module or fs.volatile or fs.cells:
                self._diff(fs, changes)
        self.memo = None
        return changes

    def _diff(self, fs, changes):
        f_locals = fs.frame.f_locals
        cache = fs.cache
        prefix = self.prefix
        present = set()
        volatile = fs.cells
        for name, obj in list(f_locals.items()):
            if not _visible(name, prefix):
                continue
            present.add(name)
            t = type(obj)
            prev = cache.get(name)
            if prev is not None and prev[0] is obj and t in _IMMUTABLE:
                continue
            if t not in _IMMUTABLE:
                volatile = True
            key = id(obj)
            hit = self.memo.get(key)
            if hit is None:
                value = encode(obj)
                hit = (_json(value), value)
                if t not in _IMMUTABLE:
                    self.memo[key] = hit
            if prev is not None and prev[1] == hit[0]:
                cache[name] = (obj, prev[1], prev[2])
                continue
            cache[name] = (obj, hit[0], hit[1])
            changes.append([fs.fid, name, hit[1]])
        for name in [n for n in cache if n not in present]:
            del cache[name]
            changes.append([fs.fid, name])
        fs.volatile = volatile

    # ── Called by the instrumented program and the streams ──

    def _condition(self, cid, value):
        result = bool(value)
        if self.stopped is not None:
            return result
        fs = self.by_frame.get(_getframe(1))
        meta = self.conditions[cid]
        seen = self.operands.pop((fs.fid if fs else -1, cid), {})
        operands = []
        for k, text in enumerate(meta['operands']):
            if k in seen:
                operands.append({'expr': text, 'value': seen[k]})
            else:
                operands.append({'expr': text, 'skipped': True})
        record = {'kind': meta['kind'], 'expr': meta['expr'], 'result': result, 'line': meta['line']}
        if operands:
            record['operands'] = operands
        self.conds.append(record)
        return result

    def _value(self, cid, k, value):
        if self.stopped is None:
            fs = self.by_frame.get(_getframe(1))
            # Reading a list subclass can run its __iter__. That is the tracer
            # looking, not the program running, so it must not become steps.
            self.muted = True
            try:
                encoded = encode(value)
            finally:
                self.muted = False
            self.operands.setdefault((fs.fid if fs else -1, cid), {})[k] = encoded
        return value

    def _write(self, stream, text):
        if not text:
            return
        self.written += len(text)
        if self.written > self.limits['max_output']:
            room = self.limits['max_output'] - (self.written - len(text))
            text = text[:max(room, 0)]
            (self.out if stream == 'stdout' else self.err).append(text)
            (self.stdout if stream == 'stdout' else self.stderr).append(text)
            if self.stopped is None:
                top = self.stack[-1] if self.stack else None
                if top is not None and top.pending is not None:
                    # The line was cut off mid-print; record it, marked as unfinished.
                    self._record({'event': 'line', 'line': top.pending, 'fid': top.fid,
                                  'function': top.function, 'depth': top.depth, 'partial': True})
                self.stop('output', f"Stopped after {self.limits['max_output']:,} characters of output — "
                                    f"the output limit. The trace up to that point is shown; it is incomplete.")
            raise TraceStopped('output', self.stopped['message'])
        (self.out if stream == 'stdout' else self.err).append(text)
        (self.stdout if stream == 'stdout' else self.stderr).append(text)

    def _read(self, text):
        if text:
            self.inp.append(text)


# ── Running a program ──────────────────────────────────────────────────────

_BUILTINS = dict(builtins.__dict__)
_MISSING = object()


def _module_state():
    state = {}
    for name, module in list(sys.modules.items()):
        if isinstance(module, types.ModuleType):
            state[name] = (module, dict(module.__dict__))
    return state


# Modules loaded before any program ran, and what was in them. In Pyodide
# that includes math, re and others a program may import and then patch;
# without restoring them, `math.pi = 3` in one run would hold in the next.
_MODULES = _module_state()
_SYS_LISTS = {name: list(getattr(sys, name)) for name in ('path', 'meta_path', 'path_hooks')}


def _reset_builtins():
    """Undo anything a previous program did to builtins, so runs cannot leak into each other."""
    current = builtins.__dict__
    for name in [n for n in current if n not in _BUILTINS]:
        del current[name]
    for name, value in _BUILTINS.items():
        if current.get(name) is not value:
            current[name] = value


def _reset_modules():
    """Forget modules a program imported and put back any it changed."""
    modules = sys.modules
    for name in [n for n in modules if n not in _MODULES]:
        del modules[name]
    for name, (module, saved) in _MODULES.items():
        if modules.get(name) is not module:
            modules[name] = module
        current = module.__dict__
        if len(current) == len(saved) and all(current.get(k, _MISSING) is v for k, v in saved.items()):
            continue
        for key in [k for k in current if k not in saved]:
            del current[key]
        current.update(saved)
    for name, saved in _SYS_LISTS.items():
        getattr(sys, name)[:] = saved


def _error_line(tb):
    line = None
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == FILENAME:
            line = tb.tb_lineno
        tb = tb.tb_next
    return line


def run(source, stdin='', limits=None, on_chunk=None, reset_modules=False, on_stop=None):
    """
    Trace a program. Steps are delivered in chunks to ``on_chunk`` as JSON
    text; the return value is a dict describing how the run ended.
    """
    limits = {**DEFAULT_LIMITS, **(limits or {})}
    began = _perf()
    base = {
        'schema': SCHEMA,
        'language': 'python',
        'runtime': {
            'implementation': 'pyodide' if sys.platform == 'emscripten' else sys.implementation.name,
            'version': '.'.join(map(str, sys.version_info[:3])),
        },
        'limits': {k: limits[k] for k in ('max_steps', 'max_seconds', 'max_output')},
    }

    if len(source) > limits['max_source']:
        return {**base, 'status': 'rejected', 'complete': False, 'steps': 0, 'stdout': '', 'stderr': '',
                'error': {'kind': 'input', 'type': 'InputTooLarge',
                          'message': f"The program is {len(source):,} characters; the limit is {limits['max_source']:,}."}}

    try:
        tree = ast.parse(source, FILENAME)
        functions, classes, loops = _structure(tree)
        prefix = f'__officina_{int(_perf() * 1e6) % 1_000_000:06d}_'
        instrument = _Instrument(source, prefix + 'cond', prefix + 'val')
        tree = ast.fix_missing_locations(instrument.visit(tree))
        code = compile(tree, FILENAME, 'exec')
    except ValueError as err:
        # ast.parse refuses NUL bytes with a ValueError rather than a SyntaxError.
        return {**base, 'status': 'syntax', 'complete': False, 'steps': 0, 'stdout': '', 'stderr': '',
                'error': {'kind': 'syntax', 'type': 'SyntaxError', 'message': str(err), 'line': None}}
    except SyntaxError as err:
        # Nothing ran, so there is no trace — only the error, where it is.
        return {**base, 'status': 'syntax', 'complete': False, 'steps': 0, 'stdout': '', 'stderr': '',
                'error': {'kind': 'syntax', 'type': type(err).__name__, 'message': err.msg,
                          'line': err.lineno, 'column': err.offset,
                          'endLine': getattr(err, 'end_lineno', None), 'endColumn': getattr(err, 'end_offset', None)}}
    parsed = _perf()

    tracer = Tracer(source, limits, loops, instrument.conditions, prefix, on_chunk, on_stop)
    namespace = {
        '__name__': '__main__',
        '__builtins__': builtins,
        prefix + 'cond': tracer._condition,
        prefix + 'val': tracer._value,
    }

    _reset_builtins()
    saved = (sys.stdout, sys.stderr, sys.stdin, sys.getrecursionlimit())
    sys.stdout = _Out(tracer, 'stdout')
    sys.stderr = _Out(tracer, 'stderr')
    sys.stdin = _In(tracer, stdin)

    error = None
    exit_code = None
    tracing_lost = False
    try:
        _settrace(tracer.global_trace)
        try:
            exec(code, namespace)
        finally:
            tracing_lost = _gettrace() != tracer.global_trace and tracer.stopped is None
            _settrace(None)
    except TraceStopped:
        pass
    except SystemExit as err:
        exit_code = err.code if isinstance(err.code, int) else (0 if err.code is None else 1)
        if err.code is not None and not isinstance(err.code, int):
            tracer.stderr.append(f'{err.code}\n')
    except MemoryError:
        error = {'kind': 'memory', 'type': 'MemoryError',
                 'message': 'The program ran out of memory.', 'line': None}
    except BaseException as err:
        error = {'kind': 'recursion' if isinstance(err, RecursionError) else 'runtime',
                 'type': type(err).__qualname__, 'message': _clip(str(err), 500),
                 'line': _error_line(err.__traceback__)}
    finally:
        sys.stdout, sys.stderr, sys.stdin = saved[:3]
        sys.setrecursionlimit(saved[3])
        _reset_builtins()
        if reset_modules:
            _reset_modules()

    if tracer.stopped is None:
        tracer.flush()
    if error is not None:
        # The step where it was raised, not the last step of the unwinding.
        error['step'] = tracer.raising[0] if tracer.raising else tracer.count - 1

    finished = _perf()
    result = {
        **base,
        'status': 'stopped' if tracer.stopped else ('error' if error else 'ok'),
        'complete': tracer.stopped is None and not tracing_lost,
        'steps': tracer.count,
        'stdout': ''.join(tracer.stdout),
        'stderr': ''.join(tracer.stderr),
        'structure': {'functions': functions, 'classes': classes},
        'timing': {'parseMs': round((parsed - began) * 1000, 2), 'runMs': round((finished - parsed) * 1000, 2)},
    }
    if tracer.stopped:
        result['stopped'] = tracer.stopped
    if error:
        result['error'] = error
    if exit_code is not None:
        result['exitCode'] = exit_code
    if tracing_lost:
        result['incompleteReason'] = 'The program turned tracing off, so steps after that point are missing.'
    return result


def run_json(source, stdin, limits_json, on_chunk, on_stop=None, reset_modules=True):
    """The worker's entry point: JSON in, JSON out, so nothing crosses the boundary as a proxy."""
    limits = _loads(limits_json) if limits_json else None
    return _json(run(str(source), str(stdin or ''), limits, on_chunk, bool(reset_modules), on_stop))


def trace(source, stdin='', limits=None):
    """Convenience for tests and tools: the whole trace in memory."""
    # Chunks arrive while the program runs, when builtins may be whatever it
    # made them; keep the text and decode it afterwards.
    chunks = []
    result = run(source, stdin, limits, chunks.append)
    steps = [step for chunk in chunks for step in _loads(chunk)]
    return steps, result


if __name__ == '__main__':
    # python3 tracer.py program.py [stdin.txt] — prints {"steps": [...], "result": {...}}
    with open(sys.argv[1], encoding='utf-8') as fh:
        program = fh.read()
    feed = ''
    if len(sys.argv) > 2:
        with open(sys.argv[2], encoding='utf-8') as fh:
            feed = fh.read()
    all_steps, outcome = trace(program, feed)
    print(_json({'steps': all_steps, 'result': outcome}))
