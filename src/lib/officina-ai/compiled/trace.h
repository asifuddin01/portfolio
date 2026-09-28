/*
 * Officina's C tracer: what a traced program is compiled with.
 *
 * instrument-c.ts inserts calls to the functions declared here into the
 * reader's program, on the lines they belong to, and clang includes this file
 * ahead of it (-include), so no line number moves. The functions themselves
 * live in trace.c, a separate translation unit: its own headers and feature
 * macros stay out of the reader's namespace, so a program may still name a
 * function `index` or `read`.
 *
 * The program's standard streams are redirected into the tracer, which is how
 * each step knows exactly what it printed and read. Only the names are
 * redirected — `stdout` and the functions that write to it implicitly — so
 * every stdio call the program makes still runs, in the C library, unchanged.
 */
#pragma once
#include <stdio.h>
#include <stddef.h>

#ifndef OFFICINA_TRACE_RUNTIME
extern FILE *_ot_stdin, *_ot_stdout, *_ot_stderr;
#undef stdin
#undef stdout
#undef stderr
#define stdin _ot_stdin
#define stdout _ot_stdout
#define stderr _ot_stderr
#define printf(...) fprintf(stdout, __VA_ARGS__)
#define vprintf(f, a) vfprintf(stdout, f, a)
#define puts(s) _ot_puts(s)
#define putchar(c) fputc(c, stdout)
#define scanf(...) fscanf(stdin, __VA_ARGS__)
#define vscanf(f, a) vfscanf(stdin, f, a)
#define getchar() fgetc(stdin)
#define perror(s) _ot_perror(s)
#endif

int _ot_puts(const char *s);
void _ot_perror(const char *s);

/* How a value is read back: the kind is chosen by the compiler, from the
   variable's own type, so the tracer never guesses. */
enum { _OT_INT = 1, _OT_UINT, _OT_FLOAT, _OT_CHAR, _OT_BOOL, _OT_PTR, _OT_STR, _OT_OTHER };
#define _OT_KIND(e) _Generic((e), \
  _Bool: _OT_BOOL, char: _OT_CHAR, signed char: _OT_INT, unsigned char: _OT_UINT, \
  short: _OT_INT, unsigned short: _OT_UINT, int: _OT_INT, unsigned: _OT_UINT, \
  long: _OT_INT, unsigned long: _OT_UINT, long long: _OT_INT, unsigned long long: _OT_UINT, \
  float: _OT_FLOAT, double: _OT_FLOAT, long double: _OT_FLOAT, \
  char *: _OT_STR, const char *: _OT_STR, \
  default: (__builtin_classify_type(e) == 5 ? _OT_PTR : _OT_OTHER))

/* A struct or enum shown field by field, by a function instrument-c.ts writes. */
typedef void (*_ot_dump)(const void *);

/* Flags on a variable: re-read it while another frame runs, because a
   callee can change it through a pointer. */
#define _OT_SHARED 1
/* Declared without a value: filled with a pattern the tracer shows as `?`. */
#define _OT_FRESH 2

void _ot_bind(int name, int type, const void *at, int kind, int size, int n1, int n2, int flags, _ot_dump dump);
#define _OT_BIND0(name, type, x, flags, dump) \
  _ot_bind(name, type, &(x), _OT_KIND(x), (int)sizeof(x), 0, 0, flags, dump)
#define _OT_BIND1(name, type, x, flags, dump) \
  _ot_bind(name, type, (x), _OT_KIND((x)[0]), (int)sizeof((x)[0]), (int)(sizeof(x) / sizeof((x)[0])), 0, flags, dump)
#define _OT_BIND2(name, type, x, flags, dump) \
  _ot_bind(name, type, (x), _OT_KIND((x)[0][0]), (int)sizeof((x)[0][0]), \
           (int)(sizeof(x) / sizeof((x)[0])), (int)(sizeof((x)[0]) / sizeof((x)[0][0])), flags, dump)

int _ot_mark(void);
void _ot_pop(int *mark);
int _ot_enter(int fn, int line, int end);
void _ot_call(void);
void _ot_leave(int *frame);

/* The line running in the current frame: set before each statement, so a
   call made from it knows the line it was called from. */
extern int *_ot_here;
#define _ot_at(line) (*_ot_here = (line))

void _ot_step(int line);
int _ot_cond(int cid, int line, int result, int *iterations);
void _ot_note(int cid, int k, int kind, int size, const void *at, _ot_dump dump);
void _ot_ret(int line, int kind, int size, const void *at, _ot_dump dump);
void _ot_ret_void(int line);

/* A condition's operand, recorded as the program computes it — once. */
#define _OT_V(cid, k, e) ({ __auto_type _ot_t = (e); _ot_note(cid, k, _OT_KIND(_ot_t), (int)sizeof(_ot_t), &_ot_t, 0); _ot_t; })
#define _OT_RET(line, x, dump) _ot_ret(line, _OT_KIND(x), (int)sizeof(x), &(x), dump)

/* Writing a struct's fields, for the functions instrument-c.ts generates. */
void _ot_object(const char *cls);
void _ot_field(const char *name, const void *at, int kind, int size, int n1, int n2, _ot_dump dump);
void _ot_end_object(void);
void _ot_enum(const char *name, long long value);
#define _OT_FIELD0(p, f, dump) _ot_field(#f, &(p)->f, _OT_KIND((p)->f), (int)sizeof((p)->f), 0, 0, dump)
#define _OT_FIELD1(p, f, dump) _ot_field(#f, (p)->f, _OT_KIND((p)->f[0]), (int)sizeof((p)->f[0]), \
  (int)(sizeof((p)->f) / sizeof((p)->f[0])), 0, dump)
