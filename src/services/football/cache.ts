export interface CacheHit<T> {
  value: T;
  fetchedAt: number;
  stale: boolean;
}

interface Entry<T> {
  value: T;
  fetchedAt: number;
  expiresAt: number;
}

/**
 * TTL cache with:
 *  - request de-duplication (concurrent callers share one loader call)
 *  - stale-on-error (if refresh fails, serve old value up to maxStaleMs)
 */
export class TtlCache<T> {
  private entries = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<CacheHit<T>>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxStaleMs = 6 * 60 * 60 * 1000,
    private readonly maxEntries = 500,
  ) {}

  async get(key: string, loader: () => Promise<T>, ttl: number | ((v: T) => number)): Promise<CacheHit<T>> {
    const t = this.now();
    const e = this.entries.get(key);
    if (e && e.expiresAt > t) return { value: e.value, fetchedAt: e.fetchedAt, stale: false };

    const running = this.inflight.get(key);
    if (running) return running;

    const p = (async (): Promise<CacheHit<T>> => {
      try {
        const value = await loader();
        const fetchedAt = this.now();
        const ms = typeof ttl === 'function' ? ttl(value) : ttl;
        this.entries.set(key, { value, fetchedAt, expiresAt: fetchedAt + ms });
        this.evict();
        return { value, fetchedAt, stale: false };
      } catch (err) {
        if (e && this.now() - e.fetchedAt <= this.maxStaleMs) {
          return { value: e.value, fetchedAt: e.fetchedAt, stale: true };
        }
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  peek(key: string): Entry<T> | undefined {
    return this.entries.get(key);
  }

  values(): T[] {
    return [...this.entries.values()].map((e) => e.value);
  }

  clear(): void {
    this.entries.clear();
  }

  private evict(): void {
    if (this.entries.size <= this.maxEntries) return;
    const sorted = [...this.entries.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [k] of sorted.slice(0, this.entries.size - this.maxEntries)) this.entries.delete(k);
  }
}
