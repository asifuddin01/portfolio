/*
 * Officina's C tracer: the runtime.
 *
 * Linked into every traced C program. The calls instrument-c.ts puts into
 * the program land here, and this file turns them into trace steps — the
 * same JSON python/tracer.py produces — written to file descriptor 2 one line
 * per step, which the page reads (compiled/runtime.ts).
 *
 * How it sees variables: each one is registered, with its address, type and
 * size, when its declaration runs (_ot_bind), and forgotten when its block
 * ends (_ot_pop) or its function returns (_ot_leave). After every statement
 * the registered memory is read back — no value is ever passed in — so a
 * callee that changes its caller's array through a pointer changes it in the
 * trace at the step it did it, and nothing is evaluated twice.
 *
 * A step carries only what changed. A variable's bytes are hashed; it is
 * rendered as JSON only when the hash moves.
 *
 * A variable declared without a value is filled with 0xAA bytes, and a value
 * that is still exactly that pattern is shown as `?`. Reading such a variable
 * is undefined in C; a real run prints whatever was in memory, and this one
 * prints the pattern — -1431655766 for an int — while the trace says `?`.
 * ponytail: a genuine value made of 0xAA bytes (170 in an unsigned char)
 * also shows as `?`; tracking definedness per byte would end that.
 */
#define _GNU_SOURCE
#define OFFICINA_TRACE_RUNTIME
#include "trace.h"
#include <errno.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

extern const char *const _ot_names[], *const _ot_types[], *const _ot_functions[];
void _ot_globals(void);
int _ot_program(void);

#define MAX_DEPTH 1000
#define MAX_VARS 32768
#define MAX_ITEMS 50
#define MAX_STR 200
#define MAX_NEST 3
#define MAX_LEAVES 1000
#define EAGER_STEPS 64
#define UNSET 0xAA

static long max_steps = 50000, max_output = 262144;
static double max_seconds = 5;

/* ── The wire: steps, a line each, to fd 2 ──────────────────────────────── */

#ifdef __wasm__
struct iov { const void *base; size_t len; };
__attribute__((import_module("wasi_snapshot_preview1"), import_name("fd_write")))
int _ot_fd_write(int fd, const struct iov *iovs, size_t n, size_t *written);
__attribute__((import_module("wasi_snapshot_preview1"), import_name("clock_time_get")))
int _ot_clock_time_get(int id, uint64_t precision, uint64_t *time);
__attribute__((import_module("wasi_snapshot_preview1"), import_name("args_sizes_get")))
int _ot_args_sizes_get(size_t *argc, size_t *size);
__attribute__((import_module("wasi_snapshot_preview1"), import_name("args_get")))
int _ot_args_get(char **argv, char *buffer);
extern unsigned char __heap_base;
#endif

static char wire[1 << 16];
static size_t wlen;

static void flush(void) {
  size_t off = 0;
  while (off < wlen) {
#ifdef __wasm__
    struct iov v = { wire + off, wlen - off };
    size_t n = 0;
    if (_ot_fd_write(2, &v, 1, &n) || !n) break;
#else
    ssize_t n = write(2, wire + off, wlen - off);
    if (n <= 0) break;
#endif
    off += (size_t)n;
  }
  wlen = 0;
}

static double now(void) {
#ifdef __wasm__
  uint64_t t = 0;
  _ot_clock_time_get(1, 1000, &t);
  return (double)t / 1e9;
#else
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (double)t.tv_sec + (double)t.tv_nsec / 1e9;
#endif
}

/* Values are written to a scratch buffer first; the step decides where they go. */
static char vbuf[1 << 19];
static size_t vlen;
static int leaves;

static void vput(const char *s, size_t n) {
  if (vlen + n < sizeof vbuf) { memcpy(vbuf + vlen, s, n); vlen += n; }
}
static void vputs(const char *s) { vput(s, strlen(s)); }
static void vprintf_(const char *fmt, ...) {
  char b[160];
  va_list a;
  va_start(a, fmt);
  int n = vsnprintf(b, sizeof b, fmt, a);
  va_end(a);
  if (n > 0) vput(b, (size_t)n < sizeof b ? (size_t)n : sizeof b - 1);
}
/* A JSON string of `n` bytes. Bytes above 0x7F pass through: the page reads UTF-8. */
static void vjson(const char *s, size_t n) {
  vput("\"", 1);
  for (size_t i = 0; i < n; i++) {
    unsigned char c = (unsigned char)s[i];
    if (c == '"' || c == '\\') { char e[2] = { '\\', (char)c }; vput(e, 2); }
    else if (c == '\n') vput("\\n", 2);
    else if (c == '\t') vput("\\t", 2);
    else if (c < 0x20 || c == 0x7F) vprintf_("\\u%04x", c);
    else vput((const char *)&c, 1);
  }
  vput("\"", 1);
}
/* Move what is in the scratch buffer onto the wire. */
static void send_value(void) {
  size_t off = 0;
  while (off < vlen) {
    if (wlen == sizeof wire) flush();
    size_t k = vlen - off < sizeof wire - wlen ? vlen - off : sizeof wire - wlen;
    memcpy(wire + wlen, vbuf + off, k);
    wlen += k;
    off += k;
  }
  vlen = 0;
}

/* ── The program's streams ───────────────────────────────────────────── */

FILE *_ot_stdin, *_ot_stdout, *_ot_stderr;
static char *input;
static size_t input_len, input_pos;
static long input_sent;
static char pending_out[262144 + 1], pending_err[262144 + 1];
static size_t n_out, n_err, written;
static int overflowed;

static ssize_t capture(char *into, size_t *n, const char *b, size_t size) {
  size_t room = written < (size_t)max_output ? (size_t)max_output - written : 0;
  size_t take = size < room ? size : room;
  memcpy(into + *n, b, take);
  *n += take;
  written += size;
  if (take < size) overflowed = 1;
  return (ssize_t)size;
}
static ssize_t write_out(void *c, const char *b, size_t n) { (void)c; return capture(pending_out, &n_out, b, n); }
static ssize_t write_err(void *c, const char *b, size_t n) { (void)c; return capture(pending_err, &n_err, b, n); }
static ssize_t read_in(void *c, char *b, size_t n) {
  (void)c;
  size_t k = input_len - input_pos < n ? input_len - input_pos : n;
  memcpy(b, input + input_pos, k);
  input_pos += k;
  return (ssize_t)k;
}
/* Only asked where it is, so ftell can report what the program has used. */
__attribute__((unused)) static int seek_in(void *c, off_t *offset, int whence) {
  (void)c;
  if (whence != SEEK_CUR || *offset) return -1;
  *offset = (off_t)input_pos;
  return 0;
}

#ifdef __APPLE__
/* macOS has funopen, not fopencookie; only the native tests run there. */
static int apple_out(void *c, const char *b, int n) { return (int)write_out(c, b, (size_t)n); }
static int apple_err(void *c, const char *b, int n) { return (int)write_err(c, b, (size_t)n); }
static int apple_in(void *c, char *b, int n) { return (int)read_in(c, b, (size_t)n); }
static fpos_t apple_seek(void *c, fpos_t offset, int whence) { (void)c; return whence == SEEK_CUR && !offset ? (fpos_t)input_pos : -1; }
static void open_streams(void) {
  _ot_stdout = funopen(0, 0, apple_out, 0, 0);
  _ot_stderr = funopen(0, 0, apple_err, 0, 0);
  _ot_stdin = funopen(0, apple_in, 0, apple_seek, 0);
}
#else
static void open_streams(void) {
  cookie_io_functions_t out = { 0, write_out, 0, 0 }, err = { 0, write_err, 0, 0 }, in = { read_in, 0, seek_in, 0 };
  _ot_stdout = fopencookie(0, "w", out);
  _ot_stderr = fopencookie(0, "w", err);
  _ot_stdin = fopencookie(0, "r", in);
}
#endif

int _ot_puts(const char *s) {
  if (fputs(s, _ot_stdout) == EOF) return EOF;
  return fputc('\n', _ot_stdout) == EOF ? EOF : 1;
}
void _ot_perror(const char *s) {
  const char *why = strerror(errno);
  if (s && *s) fprintf(_ot_stderr, "%s: %s\n", s, why);
  else fprintf(_ot_stderr, "%s\n", why);
}

/* ── Frames and variables ────────────────────────────────────────────── */

typedef struct {
  const unsigned char *at;
  _ot_dump dump;
  uint64_t hash;
  int name, type, kind, size, n1, n2, flags, hides;
  unsigned char hidden, emitted;
} Var;

typedef struct { int fn, fid, line, end, first, returned; } Frame;

static Var vars[MAX_VARS];
static int nvars;
static Frame frames[MAX_DEPTH + 2];
static int depth = -1, next_fid;
static int no_line;
int *_ot_here = &no_line;

/* Variables whose block has ended since the last step, to be removed from it. */
static struct { int fid, name; } gone[1024];
static int ngone;

static long count;
static int stopped, finished;
static double deadline, flushed_at;

static const char *function_name(const Frame *f) { return f->fn < 0 ? "<module>" : _ot_functions[f->fn]; }

static _Noreturn void fail(int line, const char *type, const char *message);

/* ── Rendering a value ───────────────────────────────────────────────── */

static int nest;

#ifdef __wasm__
static int readable(const void *p, size_t n) {
  uintptr_t a = (uintptr_t)p, end = (uintptr_t)__builtin_wasm_memory_size(0) * 65536u;
  return a && a <= end && n <= end - a;
}
#else
static int readable(const void *p, size_t n) { (void)n; return p != 0; }
#endif

static int unset(const unsigned char *p, int size) {
  for (int i = 0; i < size; i++) if (p[i] != UNSET) return 0;
  return 1;
}

static long long read_int(const unsigned char *p, int size) {
  switch (size) {
    case 1: return *(const signed char *)p;
    case 2: { short v; memcpy(&v, p, 2); return v; }
    case 4: { int v; memcpy(&v, p, 4); return v; }
    default: { long long v; memcpy(&v, p, 8); return v; }
  }
}
static unsigned long long read_uint(const unsigned char *p, int size) {
  switch (size) {
    case 1: return *p;
    case 2: { unsigned short v; memcpy(&v, p, 2); return v; }
    case 4: { unsigned v; memcpy(&v, p, 4); return v; }
    default: { unsigned long long v; memcpy(&v, p, 8); return v; }
  }
}
static uintptr_t read_ptr(const unsigned char *p) { uintptr_t v; memcpy(&v, p, sizeof v); return v; }

/* The shortest decimal that reads back as the same number, as Python's repr. */
static void put_float(const unsigned char *p, int size) {
  char b[64];
  if (size == (int)sizeof(float)) {
    float v; memcpy(&v, p, sizeof v);
    for (int d = 1; d <= 9; d++) { snprintf(b, sizeof b, "%.*g", d, (double)v); if (strtof(b, 0) == v) break; }
  } else if (size == (int)sizeof(double)) {
    double v; memcpy(&v, p, sizeof v);
    for (int d = 1; d <= 17; d++) { snprintf(b, sizeof b, "%.*g", d, v); if (strtod(b, 0) == v) break; }
  } else {
    long double v; memcpy(&v, p, sizeof v);
    snprintf(b, sizeof b, "%.21Lg", v);
  }
  if (!strpbrk(b, ".eEnNiI")) strcat(b, ".0");
  vputs("{\"t\":\"float\",\"r\":");
  vjson(b, strlen(b));
  vputs("}");
}

static void put_char(int c) {
  char b[24];
  unsigned char u = (unsigned char)c;
  if (u == '\n') snprintf(b, sizeof b, "%d '\\n'", c);
  else if (u == '\t') snprintf(b, sizeof b, "%d '\\t'", c);
  else if (u == 0) snprintf(b, sizeof b, "0 '\\0'");
  else if (u == '\'' || u == '\\') snprintf(b, sizeof b, "%d '\\%c'", c, u);
  else if (u >= 0x20 && u < 0x7F) snprintf(b, sizeof b, "%d '%c'", c, u);
  else snprintf(b, sizeof b, "%d", c);
  vputs("{\"t\":\"other\",\"cls\":\"char\",\"r\":");
  vjson(b, strlen(b));
  vputs("}");
}

/* Where a pointer points, in the program's terms when it is one of its variables. */
static void put_pointer(uintptr_t p) {
  char b[160];
  for (int i = nvars - 1; i >= 0; i--) {
    const Var *v = &vars[i];
    size_t total = (size_t)v->size * (size_t)(v->n1 ? v->n1 : 1) * (size_t)(v->n2 ? v->n2 : 1);
    uintptr_t at = (uintptr_t)v->at;
    if (p < at || p >= at + total) continue;
    size_t off = p - at;
    const char *name = _ot_names[v->name];
    if (!v->n1 && !off) snprintf(b, sizeof b, "\xe2\x86\x92 %s", name);
    else if (v->n1 && !v->n2 && off % (size_t)v->size == 0) snprintf(b, sizeof b, "\xe2\x86\x92 %s[%zu]", name, off / (size_t)v->size);
    else if (v->n2 && off % (size_t)v->size == 0) {
      size_t k = off / (size_t)v->size;
      snprintf(b, sizeof b, "\xe2\x86\x92 %s[%zu][%zu]", name, k / (size_t)v->n2, k % (size_t)v->n2);
    } else snprintf(b, sizeof b, "\xe2\x86\x92 inside %s", name);
    for (int d = 0; d <= depth; d++) {
      int end = d < depth ? frames[d + 1].first : nvars;
      if (i >= frames[d].first && i < end && d > 0 && d != depth) {
        size_t n = strlen(b);
        snprintf(b + n, sizeof b - n, " in %s()", function_name(&frames[d]));
      }
    }
    goto done;
  }
#ifdef __wasm__
  if (p >= (uintptr_t)&__heap_base && p < (uintptr_t)sbrk(0)) { snprintf(b, sizeof b, "0x%lx (heap)", (unsigned long)p); goto done; }
#endif
  snprintf(b, sizeof b, "0x%lx", (unsigned long)p);
done:
  vputs("{\"t\":\"other\",\"cls\":\"pointer\",\"r\":");
  vjson(b, strlen(b));
  vputs("}");
}

static void put_string(const char *s) {
  if (!readable(s, 1)) { put_pointer((uintptr_t)s); return; }
  size_t n = 0;
  while (n < 100000 && readable(s + n, 1) && s[n]) n++;
  if (n <= MAX_STR) { vjson(s, n); return; }
  vputs("{\"t\":\"str\",\"v\":");
  vjson(s, MAX_STR);
  vprintf_(",\"n\":%zu}", n);
}

static void value(const unsigned char *p, int kind, int size, int n1, int n2, _ot_dump dump);

static void put_list(const unsigned char *p, int kind, int size, int n1, int n2, _ot_dump dump) {
  if (nest >= MAX_NEST) { vputs("{\"t\":\"more\",\"cls\":\"array\"}"); return; }
  size_t row = (size_t)size * (size_t)(n2 ? n2 : 1);
  if (kind == _OT_CHAR && !n2 && !dump) {
    if (unset(p, n1)) { vputs("{\"t\":\"other\",\"cls\":\"uninitialised\",\"r\":\"?\"}"); return; }
    const void *nul = memchr(p, 0, (size_t)n1);
    if (nul && !memchr(p, UNSET, (size_t)((const unsigned char *)nul - p))) {
      put_string((const char *)p);
      return;
    }
  }
  nest++;
  vputs("{\"t\":\"list\",\"items\":[");
  for (int i = 0; i < n1 && i < MAX_ITEMS && leaves < MAX_LEAVES; i++) {
    if (i) vput(",", 1);
    if (n2) put_list(p + row * (size_t)i, kind, size, n2, 0, dump);
    else value(p + (size_t)size * (size_t)i, kind, size, 0, 0, dump);
  }
  vprintf_("],\"n\":%d}", n1);
  nest--;
}

static void value(const unsigned char *p, int kind, int size, int n1, int n2, _ot_dump dump) {
  if (n1) { put_list(p, kind, size, n1, n2, dump); return; }
  leaves++;
  if (unset(p, size)) { vputs("{\"t\":\"other\",\"cls\":\"uninitialised\",\"r\":\"?\"}"); return; }
  if (dump) {
    if (nest >= MAX_NEST) { vputs("{\"t\":\"more\",\"cls\":\"struct\"}"); return; }
    nest++;
    dump(p);
    nest--;
    return;
  }
  switch (kind) {
    case _OT_INT: {
      long long v = read_int(p, size);
      if (v > 9007199254740991LL || v < -9007199254740991LL) vprintf_("{\"t\":\"int\",\"r\":\"%lld\"}", v);
      else vprintf_("%lld", v);
      return;
    }
    case _OT_UINT: {
      unsigned long long v = read_uint(p, size);
      if (v > 9007199254740991ULL) vprintf_("{\"t\":\"int\",\"r\":\"%llu\"}", v);
      else vprintf_("%llu", v);
      return;
    }
    case _OT_FLOAT: put_float(p, size); return;
    case _OT_CHAR: put_char((int)*(const char *)p); return;
    case _OT_BOOL: vputs(*p ? "true" : "false"); return;
    case _OT_PTR: {
      uintptr_t v = read_ptr(p);
      if (v) put_pointer(v); else vputs("null");
      return;
    }
    case _OT_STR: {
      uintptr_t v = read_ptr(p);
      if (v) put_string((const char *)v); else vputs("null");
      return;
    }
    default: vputs("{\"t\":\"other\",\"cls\":\"value\",\"r\":\"\xe2\x80\xa6\"}");
  }
}

static int first_attr[MAX_NEST + 2];
void _ot_object(const char *cls) {
  vputs("{\"t\":\"object\",\"cls\":");
  vjson(cls, strlen(cls));
  vputs(",\"attrs\":[");
  first_attr[nest] = 1;
}
void _ot_field(const char *name, const void *at, int kind, int size, int n1, int n2, _ot_dump dump) {
  if (!first_attr[nest]) vput(",", 1);
  first_attr[nest] = 0;
  vput("[", 1);
  vjson(name, strlen(name));
  vput(",", 1);
  value(at, kind, size, n1, n2, dump);
  vput("]", 1);
}
void _ot_end_object(void) { vputs("]}"); }
void _ot_enum(const char *name, long long v) {
  if (!name) { vprintf_("%lld", v); return; }
  vputs("{\"t\":\"other\",\"cls\":\"enum\",\"r\":");
  vjson(name, strlen(name));
  vputs("}");
}

static void render(const Var *v) {
  leaves = 0;
  nest = 0;
  value(v->at, v->kind, v->size, v->n1, v->n2, v->dump);
}

/* ── What changed ────────────────────────────────────────────────────── */

static uint64_t mix(uint64_t h, const unsigned char *p, size_t n) {
  for (; n >= 8; n -= 8, p += 8) { uint64_t w; memcpy(&w, p, 8); h = (h ^ w) * 0x100000001b3ULL; h ^= h >> 29; }
  for (; n; n--, p++) h = (h ^ *p) * 0x100000001b3ULL;
  return h;
}

static uint64_t fingerprint(const Var *v) {
  uint64_t h = 0xcbf29ce484222325ULL ^ (uint64_t)v->kind;
  if (!v->n1) {
    h = mix(h, v->at, (size_t)v->size);
    if (v->kind == _OT_STR && !unset(v->at, v->size)) {
      const char *s = (const char *)read_ptr(v->at);
      if (readable(s, 1)) for (size_t i = 0; i < MAX_STR && readable(s + i, 1); i++) { h = mix(h, (const unsigned char *)s + i, 1); if (!s[i]) break; }
    }
  } else if (!v->n2) {
    h = mix(h, v->at, (size_t)v->size * (size_t)(v->n1 < MAX_ITEMS ? v->n1 : MAX_ITEMS));
  } else {
    size_t cols = (size_t)(v->n2 < MAX_ITEMS ? v->n2 : MAX_ITEMS);
    for (int r = 0; r < v->n1 && r < MAX_ITEMS; r++)
      h = mix(h, v->at + (size_t)r * (size_t)v->n2 * (size_t)v->size, cols * (size_t)v->size);
  }
  return h ? h : 1;
}

/* Every change since the last step: the running frame and the globals always;
   a waiting frame only for what a callee could reach through a pointer. */
static void put_changes(void) {
  static struct { int i, fid; } declared[MAX_VARS];
  int ndeclared = 0, any = 0;
  char b[48];
  for (int g = 0; g < ngone; g++) {
    snprintf(b, sizeof b, "%s[%d,", any++ ? "," : ",\"changes\":[", gone[g].fid);
    vputs(b);
    vjson(_ot_names[gone[g].name], strlen(_ot_names[gone[g].name]));
    vput("]", 1);
  }
  ngone = 0;
  for (int d = 0; d <= depth; d++) {
    int end = d < depth ? frames[d + 1].first : nvars;
    for (int i = frames[d].first; i < end; i++) {
      Var *v = &vars[i];
      if (v->hidden || !(d == depth || d == 0 || (v->flags & _OT_SHARED))) continue;
      uint64_t h = fingerprint(v);
      if (h == v->hash) continue;
      v->hash = h;
      snprintf(b, sizeof b, "%s[%d,", any++ ? "," : ",\"changes\":[", frames[d].fid);
      vputs(b);
      vjson(_ot_names[v->name], strlen(_ot_names[v->name]));
      vput(",", 1);
      render(v);
      vput("]", 1);
      if (!v->emitted) { v->emitted = 1; declared[ndeclared].i = i; declared[ndeclared++].fid = frames[d].fid; }
    }
  }
  if (any) vput("]", 1);
  for (int k = 0; k < ndeclared; k++) {
    const Var *v = &vars[declared[k].i];
    snprintf(b, sizeof b, "%s[%d,", k ? "," : ",\"declared\":[", declared[k].fid);
    vputs(b);
    vjson(_ot_names[v->name], strlen(_ot_names[v->name]));
    vput(",", 1);
    /* `int a[] = {…}` is an int[4]; the size is known now, if not when written. */
    const char *t = _ot_types[v->type], *open = v->n1 ? strstr(t, "[]") : 0;
    char sized[200];
    if (open) snprintf(sized, sizeof sized, "%.*s[%d]%s", (int)(open - t), t, v->n1, open + 2);
    vjson(open ? sized : t, strlen(open ? sized : t));
    vput("]", 1);
  }
  if (ndeclared) vput("]", 1);
}

/* ── Conditions ──────────────────────────────────────────────────────── */

/* Operand values, noted as the program computes them, until their condition. */
static struct { int fid, cid, k; size_t at, len; } notes[256];
static int nnotes;
static char note_text[1 << 16];
static size_t note_len;
/* Conditions decided since the last step, already as JSON. */
static char conds[1 << 16];
static size_t conds_len;
static int nconds;

void _ot_note(int cid, int k, int kind, int size, const void *at, _ot_dump dump) {
  if (stopped || nnotes == 256) return;
  size_t mark = vlen;
  leaves = 0;
  nest = 0;
  value(at, kind, size, 0, 0, dump);
  size_t len = vlen - mark;
  if (note_len + len <= sizeof note_text) {
    memcpy(note_text + note_len, vbuf + mark, len);
    notes[nnotes].fid = frames[depth].fid;
    notes[nnotes].cid = cid;
    notes[nnotes].k = k;
    notes[nnotes].at = note_len;
    notes[nnotes].len = len;
    nnotes++;
    note_len += len;
  }
  vlen = mark;
}

static void add_condition(int cid, int result) {
  size_t mark = vlen;
  vprintf_("%s[%d,%s,[", nconds ? "," : "", cid, result ? "true" : "false");
  int fid = frames[depth].fid, first = 1, kept = 0;
  size_t kept_len = 0;
  for (int i = 0; i < nnotes; i++) {
    if (notes[i].fid == fid && notes[i].cid == cid) {
      vprintf_("%s[%d,", first ? "" : ",", notes[i].k);
      vput(note_text + notes[i].at, notes[i].len);
      vput("]", 1);
      first = 0;
      continue;
    }
    memmove(note_text + kept_len, note_text + notes[i].at, notes[i].len);
    notes[kept] = notes[i];
    notes[kept].at = kept_len;
    kept_len += notes[i].len;
    kept++;
  }
  nnotes = kept;
  note_len = kept_len;
  vput("]]", 2);
  size_t len = vlen - mark;
  if (conds_len + len <= sizeof conds) { memcpy(conds + conds_len, vbuf + mark, len); conds_len += len; nconds++; }
  vlen = mark;
}

/* ── Steps ───────────────────────────────────────────────────────────── */

static _Noreturn void stop(const char *reason);

static void begin(const char *event, int line) {
  const Frame *f = &frames[depth];
  vprintf_("{\"step\":%ld,\"event\":\"%s\",\"line\":%d,\"fid\":%d,\"function\":", count, event, line, f->fid);
  const char *fn = function_name(f);
  vjson(fn, strlen(fn));
  vprintf_(",\"depth\":%d", depth);
}

static void put_stream(const char *key, char *text, size_t *n) {
  if (!*n) return;
  vprintf_(",\"%s\":", key);
  vjson(text, *n);
  *n = 0;
}

/* A return step's value, rendered before the step is begun. */
static char returned_text[1 << 14];
static size_t returned_len;
static int has_returned;

/* Everything a step carries after its own fields, then the step goes out. */
static void close_step(void) {
  put_changes();
  if (has_returned) {
    vputs(",\"returnValue\":");
    vput(returned_text, returned_len);
    has_returned = 0;
  }
  if (nconds) {
    vputs(",\"c\":[");
    vput(conds, conds_len);
    vput("]", 1);
    nconds = 0;
    conds_len = 0;
  }
  fflush(_ot_stdout);
  fflush(_ot_stderr);
  put_stream("stdout", pending_out, &n_out);
  put_stream("stderr", pending_err, &n_err);
  long used = _ot_stdin ? ftell(_ot_stdin) : -1;
  if (used > input_sent) {
    vputs(",\"stdin\":");
    vjson(input + input_sent, (size_t)(used - input_sent));
    input_sent = used;
  }
  if (overflowed) vputs(",\"partial\":true");
  vputs("}\n");
  send_value();
  count++;
}

static void finish_step(void) {
  close_step();
  double t = now();
  if (count <= EAGER_STEPS || wlen >= sizeof wire / 2 || t - flushed_at > 0.05) { flush(); flushed_at = t; }
  if (overflowed) stop("output");
  if (count >= max_steps) stop("steps");
  if (t > deadline) stop("time");
}

void _ot_step(int line) {
  if (stopped) return;
  begin("line", line);
  finish_step();
}

int _ot_cond(int cid, int line, int result, int *iterations) {
  if (stopped) return result;
  add_condition(cid, result);
  if (!line) return result;                    /* a ternary: it belongs to its statement's step */
  begin("line", line);
  if (iterations) {
    if (result) vprintf_(",\"loop\":{\"line\":%d,\"iteration\":%d}", line, ++*iterations);
    else vprintf_(",\"loop\":{\"line\":%d,\"done\":%d}", line, *iterations);
  }
  finish_step();
  return result;
}

void _ot_bind(int name, int type, const void *at, int kind, int size, int n1, int n2, int flags, _ot_dump dump) {
  if (stopped) return;
  int hides = -1;
  for (int i = nvars - 1; i >= frames[depth].first; i--) {
    if (vars[i].name != name || vars[i].hidden) continue;
    if (vars[i].at == at) return;              /* bound again, by a loop's next test */
    vars[i].hidden = 1;
    hides = i;
    break;
  }
  if (nvars == MAX_VARS) return;
  for (int g = 0; g < ngone; g++)
    if (gone[g].fid == frames[depth].fid && gone[g].name == name) { gone[g] = gone[--ngone]; break; }
  Var *v = &vars[nvars++];
  memset(v, 0, sizeof *v);
  v->at = at; v->dump = dump; v->name = name; v->type = type; v->kind = kind;
  v->size = size; v->n1 = n1; v->n2 = n2; v->flags = flags; v->hides = hides;
  if (flags & _OT_FRESH) memset((void *)at, UNSET, (size_t)size * (size_t)(n1 ? n1 : 1) * (size_t)(n2 ? n2 : 1));
}

int _ot_mark(void) { return nvars; }

void _ot_pop(int *mark) {
  while (nvars > *mark) {
    Var *v = &vars[--nvars];
    if (v->hides >= 0) {
      Var *outer = &vars[v->hides];
      outer->hidden = 0;
      outer->hash = 0;
      outer->emitted = 0;
    } else if (v->emitted && ngone < 1024) {
      gone[ngone].fid = frames[depth].fid;
      gone[ngone].name = v->name;
      ngone++;
    }
  }
}

int _ot_enter(int fn, int line, int end) {
  if (stopped) { static int none; _ot_here = &none; return -1; }
  if (depth + 1 >= MAX_DEPTH) fail(*_ot_here, "Stack overflow",
    "More than 1,000 calls were waiting to return. On a real machine this "
    "usually ends in a crash (a stack overflow): check the recursion stops.");
  Frame *f = &frames[++depth];
  f->fn = fn; f->fid = next_fid++; f->line = line; f->end = end; f->first = nvars; f->returned = 0;
  _ot_here = &f->line;
  return f->fid;
}

/* The call step, once the parameters are bound. */
void _ot_call(void) {
  if (stopped) return;
  const Frame *f = &frames[depth], *caller = &frames[depth - 1];
  begin("call", f->line);
  vprintf_(",\"parent\":%d,\"callerLine\":%d,\"args\":[", caller->fid, caller->line);
  for (int i = f->first; i < nvars; i++) {
    if (i > f->first) vput(",", 1);
    vput("[", 1);
    vjson(_ot_names[vars[i].name], strlen(_ot_names[vars[i].name]));
    vput(",", 1);
    render(&vars[i]);
    vput("]", 1);
  }
  vput("]", 1);
  finish_step();
}

void _ot_ret(int line, int kind, int size, const void *at, _ot_dump dump) {
  if (stopped) return;
  frames[depth].returned = 1;
  leaves = 0;
  nest = 0;
  value(at, kind, size, 0, 0, dump);
  returned_len = vlen < sizeof returned_text ? vlen : 0;
  memcpy(returned_text, vbuf, returned_len);
  has_returned = returned_len > 0;
  vlen = 0;
  begin("return", line);
  finish_step();
}

void _ot_ret_void(int line) {
  if (stopped) return;
  frames[depth].returned = 1;
  begin("return", line);
  finish_step();
}

void _ot_leave(int *fid) {
  if (*fid < 0 || stopped) return;
  if (!frames[depth].returned) _ot_ret_void(frames[depth].end);
  for (int g = 0; g < ngone; g++) if (gone[g].fid == *fid) gone[g--] = gone[--ngone];
  nvars = frames[depth].first;
  depth--;
  _ot_here = &frames[depth].line;
}

/* ── Ending ──────────────────────────────────────────────────────────── */

static void end_line(const char *json) {
  vputs(json);
  vputs("\n");
  send_value();
  flush();
}

static _Noreturn void stop(const char *reason) {
  stopped = 1;
  char b[96];
  snprintf(b, sizeof b, "{\"stop\":\"%s\",\"step\":%ld}", reason, count - 1);
  end_line(b);
  _Exit(0);
}

static _Noreturn void fail(int line, const char *type, const char *message) {
  if (!stopped) {
    stopped = 1;
    begin("exception", line);
    vputs(",\"exception\":{\"type\":");
    vjson(type, strlen(type));
    vputs(",\"message\":");
    vjson(message, strlen(message));
    vputs("}");
    close_step();
    char b[64];
    snprintf(b, sizeof b, "{\"error\":{\"line\":%d,\"step\":%ld}}", line, count - 1);
    end_line(b);
  }
  _Exit(70);
}

/* exit() from inside the program: whatever it printed last still counts. */
static void at_exit(void) {
  if (finished || stopped) return;
  fflush(_ot_stdout);
  fflush(_ot_stderr);
  if (n_out || n_err) {
    begin("line", *_ot_here);
    vputs(",\"partial\":true");
    close_step();
  }
  end_line("{\"exit\":true}");
}

/* Runtime errors C leaves undefined, reported where they happen instead of
   being run on into (clang's -fsanitize checks call these). */
struct loc { const char *file; unsigned line, column; };
struct type { unsigned short kind, info; char name[1]; };
struct bounds { struct loc loc; const struct type *array, *index; };

static void divide(struct loc *d) {
  fail((int)d->line, "Division by zero",
       "The program divided by zero (or took a remainder by zero). C does not say what happens "
       "next; a real run usually stops here with a crash.");
}
void __ubsan_handle_divrem_overflow(struct loc *d, void *a, void *b) { (void)a; (void)b; divide(d); }
void __ubsan_handle_divrem_overflow_abort(struct loc *d, void *a, void *b) { (void)a; (void)b; divide(d); }

static void out_of_bounds(struct bounds *d, uintptr_t index) {
  unsigned bits = 1u << (d->index->info >> 1);
  long long i;
  if (bits <= sizeof(uintptr_t) * 8) {
    i = (long long)index;
    if ((d->index->info & 1) && bits < 64) { long long sign = 1LL << (bits - 1); i = ((long long)(index & ((1ULL << bits) - 1)) ^ sign) - sign; }
  } else {
    memcpy(&i, (const void *)index, sizeof i);
  }
  char type[64], message[300];
  snprintf(type, sizeof type, "%s", d->array->name[0] == '\'' ? d->array->name + 1 : d->array->name);
  char *quote = strchr(type, '\'');
  if (quote) *quote = 0;
  snprintf(message, sizeof message,
           "Index %lld is outside %s. C does not check array bounds: a real run would read or "
           "overwrite whatever memory is there, so the tracer stops here instead.", i, type);
  fail((int)d->loc.line, "Index out of bounds", message);
}
void __ubsan_handle_out_of_bounds(struct bounds *d, uintptr_t index) { out_of_bounds(d, index); }
void __ubsan_handle_out_of_bounds_abort(struct bounds *d, uintptr_t index) { out_of_bounds(d, index); }

static void null_pointer(struct loc *d) {
  fail((int)d->line, "NULL pointer",
       "The program read or wrote through a NULL pointer. On a real machine that is a crash "
       "(a segmentation fault).");
}
void __ubsan_handle_type_mismatch_v1(struct loc *d, void *p) { (void)p; null_pointer(d); }
void __ubsan_handle_type_mismatch_v1_abort(struct loc *d, void *p) { (void)p; null_pointer(d); }

_Noreturn void __assert_fail(const char *expr, const char *file, int line, const char *fn) {
  (void)file; (void)fn;
  char message[240];
  snprintf(message, sizeof message, "assert(%s) was false, so the program stopped.", expr);
  fail(line, "Assertion failed", message);
}

#ifdef __APPLE__
_Noreturn void __assert_rtn(const char *fn, const char *file, int line, const char *expr) { __assert_fail(expr, file, line, fn); }
#endif

_Noreturn void abort(void) { fail(*_ot_here, "abort()", "The program called abort()."); }

/* ── Start ───────────────────────────────────────────────────────────── */

#ifdef __wasm__
/* The toolchain links no C startup code and wasi-run calls main directly,
   so the arguments — input and limits — are asked for, not passed. (For
   WebAssembly clang also renames a main that takes arguments.) */
int main(void) {
  int argc = 0;
  char **argv = 0;
  size_t n = 0, size = 0;
  if (!_ot_args_sizes_get(&n, &size) && n) {
    argv = malloc((n + 1) * sizeof *argv);
    char *buffer = malloc(size);
    if (argv && buffer && !_ot_args_get(argv, buffer)) argc = (int)n;
  }
#else
int main(int argc, char **argv) {
#endif
  if (argc > 1) { input = argv[1]; input_len = strlen(input); }
  if (argc > 2) max_steps = atol(argv[2]);
  if (argc > 3) max_seconds = atof(argv[3]);
  if (argc > 4) max_output = atol(argv[4]);
  if (max_output > 262144) max_output = 262144;

  open_streams();
  setvbuf(_ot_stdout, 0, _IONBF, 0);
  setvbuf(_ot_stderr, 0, _IONBF, 0);
  atexit(at_exit);

  flushed_at = now();
  deadline = flushed_at + max_seconds;
  Frame *top = &frames[0];
  top->fn = -1; top->fid = next_fid++; top->line = 0; top->end = 0; top->first = 0; top->returned = 0;
  depth = 0;
  _ot_here = &top->line;
  _ot_globals();
  begin("call", 0);
  finish_step();

  int code = _ot_program();

  if (!stopped) {
    begin("return", 0);
    finish_step();
  }
  finished = 1;
  char b[48];
  snprintf(b, sizeof b, "{\"done\":%d}", code);
  end_line(b);
  return code;
}
