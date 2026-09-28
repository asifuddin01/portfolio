/*
 * Officina's Java tracer: the runtime.
 *
 * Compiled beside every traced Java program. instrument-java.ts puts calls to
 * this class into the program, on the lines they belong to, and this class
 * turns them into trace steps — the same JSON python/tracer.py produces —
 * written to the original System.out, one line per step, which the page reads.
 *
 * Java cannot name a local variable from outside its method, so each step
 * passes the values of the variables in scope there (a "site" says which
 * names they are). A step carries only what changed: each value is rendered
 * as JSON and compared with its last rendering. Arrays and objects a waiting
 * caller holds are rendered again at every step, because a method it called
 * can change them in place.
 *
 * Values are read without running any of the program's code: fields by
 * reflection, never toString(); the JDK's own collections are the only
 * things iterated.
 */
public final class OfficinaTrace {
  // Filled in by the generated runner before main runs.
  static String[] names = {}, types = {}, functions = {}, classes = {};
  static int[][] sites = {};
  static int[] functionClass = {};
  static int entryClass;
  static long maxSteps = 50000, maxNanos = 5000000000L;
  static int maxOutput = 262144;

  static final int MAX_ITEMS = 50, MAX_STR = 200, MAX_NEST = 3, MAX_DEPTH = 1000;

  static final class Stop extends Error {
    Stop() { super("trace stopped", null, false, false); }
  }

  static final class Capture extends java.io.OutputStream {
    byte[] bytes = new byte[1024];
    int count, sent;
    public void write(int b) { write(new byte[] { (byte) b }, 0, 1); }
    public void write(byte[] b, int off, int len) {
      written += len;
      int take = Math.max(0, Math.min(len, maxOutput - (int) Math.min(Integer.MAX_VALUE, written - len)));
      if (take < len) overflowed = true;
      if (count + take > bytes.length) bytes = java.util.Arrays.copyOf(bytes, Math.max(bytes.length * 2, count + take));
      System.arraycopy(b, off, bytes, count, take);
      count += take;
    }
    String pending() {
      if (count == sent) return null;
      String s = new String(bytes, sent, count - sent, java.nio.charset.StandardCharsets.UTF_8);
      sent = count;
      return s;
    }
  }

  static final class Frame {
    int fn, fid, line, end, site = -1;
    boolean returned, unwinding;
    Object[] values;
    int[] loops = new int[8];
    final java.util.HashMap<String, String> shown = new java.util.HashMap<>();
    final java.util.HashMap<String, String> typed = new java.util.HashMap<>();
  }

  static java.io.PrintStream wire;
  static final StringBuilder buf = new StringBuilder();
  static final Capture out = new Capture(), err = new Capture();
  static long written;
  static boolean overflowed, stopped, finished;
  static long count, started, flushedAt;
  static final Frame[] stack = new Frame[MAX_DEPTH + 2];
  static int depth = -1, nextFid;
  static final StringBuilder conds = new StringBuilder();
  static int nconds;
  static final java.util.ArrayList<Object[]> notes = new java.util.ArrayList<>();
  static Throwable reported;
  static int errorLine = -1;
  static long errorStep = -1;
  static final java.util.IdentityHashMap<Object, String> memo = new java.util.IdentityHashMap<>();
  static final java.util.LinkedHashSet<Integer> active = new java.util.LinkedHashSet<>();
  static final java.util.HashMap<Class<?>, java.lang.reflect.Field[]> fieldCache = new java.util.HashMap<>();

  // ── Start and end ────────────────────────────────────────────────────

  /** args: input, step limit, seconds, output limit, and instrument-java.ts's tables. */
  public static void main(String[] args) throws Throwable {
    maxSteps = Long.parseLong(args[1]);
    maxNanos = (long) (Double.parseDouble(args[2]) * 1e9);
    maxOutput = Math.min(262144, Integer.parseInt(args[3]));
    String[] t = args[4].split("\u0002", -1);
    names = split(t[1]);
    types = split(t[2]);
    functions = split(t[3]);
    classes = split(t[4]);
    String[] owners = split(t[5]);
    functionClass = new int[owners.length];
    for (int i = 0; i < owners.length; i++) functionClass[i] = Integer.parseInt(owners[i]);
    String[] all = split(t[6]);
    sites = new int[all.length][];
    for (int i = 0; i < all.length; i++) {
      String[] pairs = all[i].isEmpty() ? new String[0] : all[i].split(",");
      sites[i] = new int[pairs.length];
      for (int j = 0; j < pairs.length; j++) sites[i][j] = Integer.parseInt(pairs[j]);
    }
    entryClass = Integer.parseInt(t[7]);
    start(args[0]);
    java.lang.reflect.Method main = Class.forName(t[0]).getMethod("main", String[].class);
    main.setAccessible(true);
    try {
      main.invoke(null, (Object) new String[0]);
      end();
    } catch (java.lang.reflect.InvocationTargetException e) {
      uncaught(e.getCause());
      System.exit(1);
    }
  }

  static String[] split(String s) { return s.isEmpty() ? new String[0] : s.split("\u0001", -1); }

  static void start(String input) throws Exception {
    wire = System.out;
    System.setOut(new java.io.PrintStream(out, true, "UTF-8"));
    System.setErr(new java.io.PrintStream(err, true, "UTF-8"));
    System.setIn(new java.io.ByteArrayInputStream(input.getBytes("UTF-8")));
    Runtime.getRuntime().addShutdownHook(new Thread(OfficinaTrace::exited));
    started = flushedAt = System.nanoTime();
    Frame top = new Frame();
    top.fn = -1;
    top.fid = nextFid++;
    stack[depth = 0] = top;
    active.add(entryClass);
    begin("call", 0);
    finish();
  }

  static void end() {
    if (stopped) return;
    begin("return", 0);
    finish();
    finished = true;
    send("{\"done\":0}");
  }

  /** An exception nothing caught: the program ends on it. */
  static void uncaught(Throwable e) {
    if (e instanceof Stop || stopped) return;
    if (e != reported) { reported = e; exception(e); }
    finished = true;
    send("{\"error\":{\"line\":" + errorLine + ",\"step\":" + errorStep + "}}");
  }

  /** System.exit from inside the program: what it printed last still counts. */
  static void exited() {
    if (finished || stopped) return;
    String o = out.pending(), e = err.pending();
    if (o != null || e != null) {
      begin("line", stack[depth].line);
      buf.append(",\"partial\":true");
      stream("stdout", o);
      stream("stderr", e);
      buf.append("}\n");
      count++;
    }
    send("{\"exit\":true}");
  }

  static void send(String line) {
    buf.append(line).append('\n');
    flush();
  }

  static void flush() {
    wire.print(buf);
    wire.flush();
    buf.setLength(0);
    flushedAt = System.nanoTime();
  }

  static void stop(String reason) {
    if (stopped) throw new Stop();
    stopped = true;
    send("{\"stop\":\"" + reason + "\",\"step\":" + (count - 1) + "}");
    Runtime.getRuntime().halt(0);
    throw new Stop();
  }

  // ── Rendering values ─────────────────────────────────────────────────

  static void quote(StringBuilder b, String s) {
    b.append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c == '"' || c == '\\') b.append('\\').append(c);
      else if (c == '\n') b.append("\\n");
      else if (c == '\t') b.append("\\t");
      else if (c < 0x20 || c == 0x7F || c == ' ' || c == ' ') b.append(String.format("\\u%04x", (int) c));
      else b.append(c);
    }
    b.append('"');
  }

  static String simple(String type) {
    return type.replaceAll("\\b(?:[a-z_$][\\w$]*\\.)+(?=[A-Z])", "").replace('$', '.');
  }

  static boolean jdk(Class<?> c) {
    String n = c.getName();
    return n.startsWith("java.") || n.startsWith("javax.") || n.startsWith("sun.") || n.startsWith("jdk.");
  }

  static String render(Object o) {
    if (o == null) return "null";
    if (o instanceof String || o instanceof Number || o instanceof Boolean || o instanceof Character) {
      StringBuilder b = new StringBuilder();
      value(b, o, 0, null);
      return b.toString();
    }
    String hit = memo.get(o);
    if (hit != null) return hit;
    StringBuilder b = new StringBuilder();
    value(b, o, 0, new java.util.IdentityHashMap<Object, Boolean>());
    hit = b.toString();
    memo.put(o, hit);
    return hit;
  }

  static void value(StringBuilder b, Object o, int nest, java.util.IdentityHashMap<Object, Boolean> seen) {
    if (o == null) { b.append("null"); return; }
    if (o instanceof String) {
      String s = (String) o;
      if (s.length() <= MAX_STR) quote(b, s);
      else { b.append("{\"t\":\"str\",\"v\":"); quote(b, s.substring(0, MAX_STR)); b.append(",\"n\":").append(s.length()).append('}'); }
      return;
    }
    if (o instanceof Boolean) { b.append(o); return; }
    if (o instanceof Character) {
      char c = (Character) o;
      String shown = c == '\n' ? "\\n" : c == '\t' ? "\\t" : c == 0 ? "\\0" : c == '\'' || c == '\\' ? "\\" + c : c < 0x20 ? null : String.valueOf(c);
      b.append("{\"t\":\"other\",\"cls\":\"char\",\"r\":");
      quote(b, shown == null ? String.valueOf((int) c) : (int) c + " '" + shown + "'");
      b.append('}');
      return;
    }
    if (o instanceof Byte || o instanceof Short || o instanceof Integer) { b.append(o); return; }
    if (o instanceof Long) {
      long v = (Long) o;
      if (Math.abs(v) <= 9007199254740991L) b.append(v);
      else b.append("{\"t\":\"int\",\"r\":\"").append(v).append("\"}");
      return;
    }
    if (o instanceof Float || o instanceof Double) {
      b.append("{\"t\":\"float\",\"r\":");
      quote(b, o.toString());
      b.append('}');
      return;
    }
    Class<?> c = o.getClass();
    if (o instanceof java.math.BigInteger || o instanceof java.math.BigDecimal) {
      b.append("{\"t\":\"").append(o instanceof java.math.BigInteger ? "int" : "float").append("\",\"r\":");
      quote(b, o.toString());
      b.append('}');
      return;
    }
    if (o instanceof Throwable) {
      String m = ((Throwable) o).getMessage();
      b.append("{\"t\":\"exception\",\"cls\":");
      quote(b, o.getClass().getSimpleName());
      b.append(",\"r\":");
      quote(b, m == null ? "" : m);
      b.append('}');
      return;
    }
    if (o instanceof Enum) {
      b.append("{\"t\":\"other\",\"cls\":\"enum\",\"r\":");
      quote(b, ((Enum<?>) o).name());
      b.append('}');
      return;
    }
    if (nest >= MAX_NEST) { b.append("{\"t\":\"more\",\"cls\":"); quote(b, simple(c.getName())); b.append('}'); return; }
    if (seen.containsKey(o)) { b.append("{\"t\":\"cycle\",\"cls\":"); quote(b, simple(c.getSimpleName())); b.append('}'); return; }
    seen.put(o, true);
    try {
      if (c.isArray()) {
        int n = java.lang.reflect.Array.getLength(o);
        b.append("{\"t\":\"list\",\"items\":[");
        for (int i = 0; i < n && i < MAX_ITEMS; i++) {
          if (i > 0) b.append(',');
          value(b, java.lang.reflect.Array.get(o, i), nest + 1, seen);
        }
        b.append("],\"n\":").append(n).append('}');
      } else if (jdk(c) && o instanceof java.util.Map) {
        java.util.Map<?, ?> m = (java.util.Map<?, ?>) o;
        b.append("{\"t\":\"dict\",\"items\":[");
        int i = 0;
        for (java.util.Map.Entry<?, ?> e : m.entrySet()) {
          if (i == MAX_ITEMS) break;
          if (i++ > 0) b.append(',');
          b.append('[');
          value(b, e.getKey(), nest + 1, seen);
          b.append(',');
          value(b, e.getValue(), nest + 1, seen);
          b.append(']');
        }
        b.append("],\"n\":").append(m.size()).append(",\"cls\":");
        quote(b, c.getSimpleName());
        b.append('}');
      } else if (jdk(c) && o instanceof java.util.Collection) {
        java.util.Collection<?> m = (java.util.Collection<?>) o;
        b.append("{\"t\":\"list\",\"items\":[");
        int i = 0;
        for (Object e : m) {
          if (i == MAX_ITEMS) break;
          if (i++ > 0) b.append(',');
          value(b, e, nest + 1, seen);
        }
        b.append("],\"n\":").append(m.size()).append(",\"cls\":");
        quote(b, c.getSimpleName());
        b.append('}');
      } else if (jdk(c) && o instanceof CharSequence) {
        b.append("{\"t\":\"other\",\"cls\":");
        quote(b, c.getSimpleName());
        b.append(",\"r\":");
        StringBuilder inner = new StringBuilder();
        String s = o.toString();
        quote(inner, s.length() > MAX_STR ? s.substring(0, MAX_STR) + "…" : s);
        quote(b, inner.toString());
        b.append('}');
      } else if (jdk(c) || c.isSynthetic() || c.getSimpleName().isEmpty() || c.getName().contains("$$Lambda")) {
        String name = c.getName().contains("$$Lambda") ? "lambda" : c.getSimpleName().isEmpty() ? simple(c.getName()) : c.getSimpleName();
        b.append("{\"t\":\"other\",\"cls\":");
        quote(b, name);
        b.append(",\"r\":");
        quote(b, name);
        b.append('}');
      } else {
        b.append("{\"t\":\"object\",\"cls\":");
        quote(b, c.getSimpleName());
        b.append(",\"attrs\":[");
        boolean first = true;
        for (java.lang.reflect.Field f : fields(c, false)) {
          if (!first) b.append(',');
          first = false;
          b.append('[');
          quote(b, f.getName());
          b.append(',');
          Object v;
          try { v = f.get(o); } catch (Exception e) { v = null; }
          value(b, v, nest + 1, seen);
          b.append(']');
        }
        b.append("]}");
      }
    } finally {
      seen.remove(o);
    }
  }

  /** A class's own fields — instance or static — its superclasses' first. */
  static java.lang.reflect.Field[] fields(Class<?> c, boolean statics) {
    java.lang.reflect.Field[] all = fieldCache.get(c);
    if (all == null) {
      java.util.ArrayList<java.lang.reflect.Field> list = new java.util.ArrayList<>();
      for (Class<?> k = c; k != null && !jdk(k); k = k.getSuperclass()) {
        java.util.ArrayList<java.lang.reflect.Field> own = new java.util.ArrayList<>();
        for (java.lang.reflect.Field f : k.getDeclaredFields()) {
          if (f.isSynthetic() || f.getName().contains("$") || f.getName().startsWith("_ot")) continue;
          try { f.setAccessible(true); } catch (RuntimeException e) { continue; }
          own.add(f);
        }
        list.addAll(0, own);
      }
      all = list.toArray(new java.lang.reflect.Field[0]);
      fieldCache.put(c, all);
    }
    java.util.ArrayList<java.lang.reflect.Field> out = new java.util.ArrayList<>();
    for (java.lang.reflect.Field f : all) {
      boolean isStatic = java.lang.reflect.Modifier.isStatic(f.getModifiers());
      if (isStatic == statics && (!statics || f.getDeclaringClass() == c)) out.add(f);
    }
    return out.toArray(new java.lang.reflect.Field[0]);
  }

  static boolean mutable(Object o) {
    return o != null && !(o instanceof String || o instanceof Number || o instanceof Boolean || o instanceof Character || o instanceof Enum);
  }

  // ── Steps ────────────────────────────────────────────────────────────

  static String functionName(Frame f) { return f.fn < 0 ? "<module>" : functions[f.fn]; }

  static void begin(String event, int line) {
    Frame f = stack[depth];
    buf.append("{\"step\":").append(count).append(",\"event\":\"").append(event).append("\",\"line\":").append(line)
      .append(",\"fid\":").append(f.fid).append(",\"function\":");
    quote(buf, functionName(f));
    buf.append(",\"depth\":").append(depth);
  }

  static final StringBuilder changes = new StringBuilder(), declared = new StringBuilder();

  static void change(Frame f, String name, String json, String type) {
    String old = f.shown.get(name);
    if (json.equals(old)) return;
    changes.append(changes.length() == 0 ? "" : ",").append('[').append(f.fid).append(',');
    quote(changes, name);
    changes.append(',').append(json).append(']');
    f.shown.put(name, json);
    if (type != null && !type.equals(f.typed.get(name))) {
      f.typed.put(name, type);
      declared.append(declared.length() == 0 ? "" : ",").append('[').append(f.fid).append(',');
      quote(declared, name);
      declared.append(',');
      quote(declared, type);
      declared.append(']');
    }
  }

  static void remove(Frame f, String name) {
    f.shown.remove(name);
    f.typed.remove(name);
    changes.append(changes.length() == 0 ? "" : ",").append('[').append(f.fid).append(',');
    quote(changes, name);
    changes.append(']');
  }

  /** The variables a site names, with the values the program passed for them. */
  static void locals(Frame f, int site, Object[] values) {
    f.site = site;
    f.values = values;
    int[] s = sites[site];
    java.util.HashSet<String> present = new java.util.HashSet<>();
    for (int i = 0; i < values.length; i++) {
      String name = names[s[2 * i]];
      present.add(name);
      change(f, name, render(values[i]), types[s[2 * i + 1]]);
    }
    for (String name : new java.util.ArrayList<>(f.shown.keySet())) if (!present.contains(name)) remove(f, name);
  }

  static final java.util.HashMap<Integer, Class<?>> loaded = new java.util.HashMap<>();

  static void statics() {
    Frame g = stack[0];
    for (int k : active) {
      Class<?> c = loaded.get(k);
      if (c == null) {
        try { c = Class.forName(classes[k]); } catch (ClassNotFoundException e) { continue; }
        loaded.put(k, c);
      }
      for (java.lang.reflect.Field f : fields(c, true)) {
        if (f.isEnumConstant()) continue;
        Object v;
        try { v = f.get(null); } catch (Exception e) { continue; }
        String name = k == entryClass ? f.getName() : c.getSimpleName() + "." + f.getName();
        change(g, name, render(v), simple(f.getGenericType().getTypeName()));
      }
    }
  }

  static void finish() {
    memo.clear();
    statics();
    for (int d = 1; d < depth; d++) {
      Frame f = stack[d];
      if (f.site < 0) continue;
      int[] s = sites[f.site];
      for (int i = 0; i < f.values.length; i++) {
        if (mutable(f.values[i])) change(f, names[s[2 * i]], render(f.values[i]), null);
      }
    }
    close();
    long now = System.nanoTime();
    if (count <= 64 || buf.length() > 32768 || now - flushedAt > 50000000L) flush();
    if (overflowed) stop("output");
    if (count >= maxSteps) stop("steps");
    if (now - started > maxNanos) stop("time");
  }

  static void close() {
    if (changes.length() > 0) { buf.append(",\"changes\":[").append(changes).append(']'); changes.setLength(0); }
    if (declared.length() > 0) { buf.append(",\"declared\":[").append(declared).append(']'); declared.setLength(0); }
    if (nconds > 0) { buf.append(",\"c\":[").append(conds).append(']'); conds.setLength(0); nconds = 0; }
    stream("stdout", out.pending());
    stream("stderr", err.pending());
    if (overflowed) buf.append(",\"partial\":true");
    buf.append("}\n");
    count++;
  }

  static void stream(String key, String text) {
    if (text == null) return;
    buf.append(",\"").append(key).append("\":");
    quote(buf, text);
  }

  // ── Called by the instrumented program ───────────────────────────────

  /** Before each statement: the line a call made from it came from. */
  static int at(int line) {
    if (stopped) throw new Stop();
    stack[depth].line = line;
    return line;
  }

  static int enter(int fn, int line, int end, int site, Object[] args) {
    if (stopped) throw new Stop();
    if (depth + 1 >= MAX_DEPTH) {
      Frame f = stack[depth];
      exception("StackOverflowError", "More than 1,000 calls were waiting to return. On a real machine this "
        + "ends in a StackOverflowError: check the recursion stops.");
      reported = new StackOverflowError();
      errorLine = f.line;
      finished = true;
      send("{\"error\":{\"line\":" + errorLine + ",\"step\":" + errorStep + "}}");
      stopped = true;
      Runtime.getRuntime().halt(1);
    }
    Frame caller = stack[depth];
    Frame f = new Frame();
    f.fn = fn;
    f.fid = nextFid++;
    f.line = line;
    f.end = end;
    stack[++depth] = f;
    active.add(functionClass[fn]);
    begin("call", line);
    buf.append(",\"parent\":").append(caller.fid).append(",\"callerLine\":").append(caller.line).append(",\"args\":[");
    int[] s = sites[site];
    memo.clear();
    for (int i = 0; i < args.length; i++) {
      if (i > 0) buf.append(',');
      buf.append('[');
      quote(buf, names[s[2 * i]]);
      buf.append(',').append(render(args[i])).append(']');
    }
    buf.append(']');
    locals(f, site, args);
    finish();
    return f.fid;
  }

  static void step(int line, int site, Object[] values) {
    if (stopped) throw new Stop();
    memo.clear();
    begin("line", line);
    locals(stack[depth], site, values);
    finish();
  }

  static boolean cond(int at, int cid, boolean result, int site, int loop, Object[] values) {
    if (stopped) throw new Stop();
    condition(cid, result);
    memo.clear();
    begin("line", at);
    if (loop >= 0) {
      Frame f = stack[depth];
      if (loop >= f.loops.length) f.loops = java.util.Arrays.copyOf(f.loops, loop + 8);
      if (result) buf.append(",\"loop\":{\"line\":").append(at).append(",\"iteration\":").append(++f.loops[loop]).append('}');
      else buf.append(",\"loop\":{\"line\":").append(at).append(",\"done\":").append(f.loops[loop]).append('}');
    }
    locals(stack[depth], site, values);
    finish();
    return result;
  }

  /** A loop about to start: its iterations count from here. */
  static void loop(int loop, int first) {
    Frame f = stack[depth];
    if (loop >= f.loops.length) f.loops = java.util.Arrays.copyOf(f.loops, loop + 8);
    f.loops[loop] = first;
  }

  /** One pass of a for-each: the header runs again, with the next element. */
  static void each(int line, int loop, int site, Object[] values) {
    if (stopped) throw new Stop();
    Frame f = stack[depth];
    if (loop >= f.loops.length) f.loops = java.util.Arrays.copyOf(f.loops, loop + 8);
    memo.clear();
    begin("line", line);
    buf.append(",\"loop\":{\"line\":").append(line).append(",\"iteration\":").append(++f.loops[loop]).append('}');
    locals(f, site, values);
    finish();
  }

  static void eachDone(int line, int loop, int site, Object[] values) {
    if (stopped) throw new Stop();
    Frame f = stack[depth];
    memo.clear();
    begin("line", line);
    buf.append(",\"loop\":{\"line\":").append(line).append(",\"done\":").append(loop < f.loops.length ? f.loops[loop] : 0).append('}');
    locals(f, site, values);
    finish();
  }

  /** A ?: test: recorded with its statement's step. */
  static boolean test(int cid, boolean result) {
    if (stopped) throw new Stop();
    condition(cid, result);
    return result;
  }

  static void condition(int cid, boolean result) {
    int fid = stack[depth].fid;
    conds.append(nconds++ == 0 ? "" : ",").append('[').append(cid).append(',').append(result).append(",[");
    boolean first = true;
    for (java.util.Iterator<Object[]> it = notes.iterator(); it.hasNext();) {
      Object[] n = it.next();
      if ((Integer) n[0] != fid || (Integer) n[1] != cid) continue;
      conds.append(first ? "" : ",").append('[').append(n[2]).append(',').append(n[3]).append(']');
      first = false;
      it.remove();
    }
    conds.append("]]");
  }

  static void note(int cid, int k, Object v) {
    if (stopped || notes.size() > 256) return;
    notes.add(new Object[] { stack[depth].fid, cid, k, render(v) });
  }

  // A condition's operands, recorded as the program computes them — once.
  static int v(int cid, int k, int x) { note(cid, k, x); return x; }
  static long v(int cid, int k, long x) { note(cid, k, x); return x; }
  static double v(int cid, int k, double x) { note(cid, k, x); return x; }
  static float v(int cid, int k, float x) { note(cid, k, x); return x; }
  static char v(int cid, int k, char x) { note(cid, k, x); return x; }
  static boolean v(int cid, int k, boolean x) { note(cid, k, x); return x; }
  static <T> T v(int cid, int k, T x) { note(cid, k, x); return x; }

  // A switch's selector, and the step for its line.
  static int sw(int at, int x, int line, int site, Object[] values) { step(line, site, values); return x; }
  static String sw(int at, String x, int line, int site, Object[] values) { step(line, site, values); return x; }
  static <T> T sw(int at, T x, int line, int site, Object[] values) { step(line, site, values); return x; }

  /** `return x;`: the line's step, then the return with its value. */
  static <T> T ret(int line, int site, Object[] values, T result) {
    step(line, site, values);
    Frame f = stack[depth];
    f.returned = true;
    memo.clear();
    begin("return", line);
    buf.append(",\"returnValue\":").append(render(result));
    finish();
    return result;
  }

  static void ret(int line, int site, Object[] values) {
    step(line, site, values);
    stack[depth].returned = true;
    begin("return", line);
    finish();
  }

  /** In the method's own catch: an exception is leaving it. */
  static void raise(Throwable e) {
    if (stopped || e instanceof Stop) return;
    stack[depth].unwinding = true;
    if (e != reported) { reported = e; exception(e); }
  }

  /** First thing in a catch block the program wrote. */
  static void caught(Throwable e) {
    if (stopped) throw new Stop();
    stack[depth].unwinding = false;
    if (e != reported) { reported = e; exception(e); }
  }

  static void exception(Throwable e) {
    String message = e.getMessage();
    exception(e.getClass().getSimpleName(), message == null ? "" : message);
  }

  static void exception(String type, String message) {
    Frame f = stack[depth];
    begin("exception", f.line);
    buf.append(",\"exception\":{\"type\":");
    quote(buf, type);
    buf.append(",\"message\":");
    quote(buf, message);
    buf.append('}');
    errorLine = f.line;
    errorStep = count;
    close();
    flush();
  }

  static void leave(int fid, int end) {
    if (stopped) return;
    Frame f = stack[depth];
    if (f.fid != fid) return;
    if (!f.returned) {
      begin("return", f.unwinding ? f.line : end);
      if (f.unwinding) buf.append(",\"unwinding\":true");
      finish();
    }
    stack[depth--] = null;
  }
}
