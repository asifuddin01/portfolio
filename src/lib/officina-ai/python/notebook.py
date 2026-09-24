"""
Runs /officina's notebook cells inside the Python worker (worker.js).

Cells share one namespace, as in Jupyter: what one cell defines, the next can
use — until the worker is replaced. Stop and the time limit replace it,
because terminating a worker is the only way to end a program that never
hands control back, and the page says so when it happens.

Everything a cell writes, stdout and stderr alike, is captured in the order it
was written — the notebook has always shown the two together and split the
traceback off afterwards (splitOutput in officina.astro). It is sent to the
page in pieces while the cell runs, so what a runaway cell printed before it
was stopped is still on the page after the worker has gone.
"""

import builtins
import io
import sys
import time
import traceback

from pyodide.code import eval_code_async

_perf = time.perf_counter
_format_exception = traceback.format_exception

# A cell that prints now and then has every write sent at once, so a line
# printed just before a long silent stretch is already on the page if the
# reader presses Stop. Only a flood is batched — every 50 ms or 8 KB — so a
# loop printing thousands of lines is not dominated by messages to the page.
# A token bucket tells the two apart: up to BURST writes at once, refilled at
# RATE a second.
BURST = 50
RATE = 200
FLUSH_SECONDS = 0.05
FLUSH_CHARS = 8192


class OutputLimit(BaseException):
    """A BaseException, so `except Exception:` in a cell cannot swallow it."""


class _Capture(io.TextIOBase):
    def __init__(self, limit, send):
        self._limit = limit
        self._send = send
        self._size = 0
        self._pending = []
        self._pending_size = 0
        self._sent = _perf()
        self._tokens = BURST
        self._stamp = self._sent
        self.full = False

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
        if self.full:
            raise OutputLimit()
        room = self._limit - self._size
        if len(text) > room:
            self._add(text[:max(room, 0)])
            self.full = True
            self.flush()
            raise OutputLimit()
        self._add(text)
        now = _perf()
        self._tokens = min(BURST, self._tokens + (now - self._stamp) * RATE)
        self._stamp = now
        if self._tokens >= 1:
            self._tokens -= 1
            self.flush()
        elif self._pending_size >= FLUSH_CHARS or now - self._sent >= FLUSH_SECONDS:
            self.flush()
        return len(text)

    def _add(self, text):
        if text:
            self._size += len(text)
            self._pending.append(text)
            self._pending_size += len(text)

    def append(self, text):
        """Text past the limit: the traceback that says why the cell ended."""
        self._pending.append(text)
        self._pending_size += len(text)

    def flush(self):
        if self._pending:
            chunk = ''.join(self._pending)
            self._pending.clear()
            self._pending_size = 0
            self._send(chunk)
        self._sent = _perf()


namespace = {'__name__': '__main__', '__builtins__': builtins}


async def run_cell(code, limit, send):
    """
    Run one cell in the shared namespace. Output goes to `send` as it is
    written; the return value says how the cell ended: 'ok', 'error' or
    'output-limit'.
    """
    capture = _Capture(limit, send)
    saved = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = capture
    outcome = 'ok'
    try:
        await eval_code_async(code, namespace)
    except OutputLimit:
        outcome = 'output-limit'
    except BaseException as err:
        # Formatted here rather than left to Pyodide, so it lands in the same
        # stream, after everything the cell printed, as it always has.
        outcome = 'error'
        # Without this function's own frame: the traceback then opens exactly
        # as it did when Pyodide ran on the page, and splitOutput tidies it the
        # same way.
        tb = err.__traceback__
        if tb is not None and tb.tb_frame.f_code is run_cell.__code__:
            tb = tb.tb_next
        capture.append(''.join(_format_exception(type(err), err, tb)))
    finally:
        sys.stdout, sys.stderr = saved
        capture.flush()
    return outcome
