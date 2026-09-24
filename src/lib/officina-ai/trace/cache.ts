/**
 * Trace caching, keyed by exactly what determines a trace.
 *
 * The key is a hash of the language, the code, stdin and the limits — every
 * input the engine reads. Change any of them and it is a different key, so
 * there is no invalidation to get wrong: a cached trace is always the trace
 * that program produces.
 */
export async function traceKey(parts: {
  language: string;
  code: string;
  stdin: string;
  limits: object;
}): Promise<string> {
  const text = JSON.stringify([parts.language, parts.code, parts.stdin, parts.limits]);
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A small least-recently-used map. Traces are large; a handful is enough. */
export class LRU<V> {
  private map = new Map<string, V>();
  private readonly size: number;
  constructor(size: number) {
    this.size = size;
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.size) {
      this.map.delete(this.map.keys().next().value!);
    }
  }

  delete(key: string) {
    this.map.delete(key);
  }
}
