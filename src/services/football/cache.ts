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

/** Second-level cache that survives restarts (PostgreSQL or a JSON file). Values must be JSON-serializable. */
export interface PersistentStore {
  get(key: string): Promise<{ value: unknown; fetchedAt: number } | null>;
  set(key: string, value: unknown, fetchedAt: number): Promise<void>;
}

/**
 * TTL cache with:
 *  - request de-duplication (concurrent callers share one loader call)
 *  - optional persistent L2 store: a restart (or a second replica) re-uses fresh data instead of calling the API
 *  - stale-on-error (if refresh fails, serve the old value, memory or persisted, up to maxStaleMs)
 */
export class TtlCache<T> {
  private entries = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<CacheHit<T>>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxStaleMs = 6 * 60 * 60 * 1000,
    private readonly maxEntries = 500,
    private readonly store: PersistentStore | null = null,
  ) {}

  async get(key: string, loader: () => Promise<T>, ttl: number | ((v: T) => number)): Promise<CacheHit<T>> {
    const t = this.now();
    const e = this.entries.get(key);
    if (e && e.expiresAt > t) return { value: e.value, fetchedAt: e.fetchedAt, stale: false };

    const running = this.inflight.get(key);
    if (running) return running;

    const ttlOf = (v: T) => (typeof ttl === 'function' ? ttl(v) : ttl);
    const p = (async (): Promise<CacheHit<T>> => {
      let fallback: { value: T; fetchedAt: number } | undefined = e;
      if (!e && this.store) {
        const s = await this.store.get(key).catch(() => null);
        if (s) {
          const value = s.value as T;
          if (s.fetchedAt + ttlOf(value) > this.now()) {
            // Fresh enough: no API call needed.
            this.entries.set(key, { value, fetchedAt: s.fetchedAt, expiresAt: s.fetchedAt + ttlOf(value) });
            return { value, fetchedAt: s.fetchedAt, stale: false };
          }
          fallback = { value, fetchedAt: s.fetchedAt };
        }
      }
      try {
        const value = await loader();
        const fetchedAt = this.now();
        this.entries.set(key, { value, fetchedAt, expiresAt: fetchedAt + ttlOf(value) });
        this.evict();
        if (this.store) await this.store.set(key, value, fetchedAt).catch(() => undefined);
        return { value, fetchedAt, stale: false };
      } catch (err) {
        if (fallback && this.now() - fallback.fetchedAt <= this.maxStaleMs) {
          return { value: fallback.value, fetchedAt: fallback.fetchedAt, stale: true };
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
