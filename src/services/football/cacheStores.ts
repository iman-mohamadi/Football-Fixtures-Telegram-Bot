import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type pg from 'pg';
import { log } from '../../utils/logger.js';
import type { PersistentStore } from './cache.js';

/** JSON file store for development without a database. Debounced atomic writes, entries older than `maxAgeMs` are dropped on load. */
export class FileCacheStore implements PersistentStore {
  private data = new Map<string, { value: unknown; fetchedAt: number }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly path: string,
    maxAgeMs = 3 * 24 * 3600_000,
    private readonly now: () => number = Date.now,
  ) {
    try {
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { value: unknown; fetchedAt: number }>;
        for (const [k, v] of Object.entries(raw)) if (v && typeof v.fetchedAt === 'number' && this.now() - v.fetchedAt <= maxAgeMs) this.data.set(k, v);
      }
    } catch (e) {
      log.warn('cache file unreadable; starting empty', { err: e as Error });
    }
  }

  async get(key: string) {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: unknown, fetchedAt: number): Promise<void> {
    this.data.set(key, { value, fetchedAt });
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 500);
    this.timer.unref();
  }

  flush(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.data)));
      renameSync(tmp, this.path);
    } catch (e) {
      log.warn('could not write cache file', { err: e as Error });
    }
  }
}

/** PostgreSQL store (table `fixture_cache`, migration 003). Shared by all replicas. */
export class PostgresCacheStore implements PersistentStore {
  constructor(private readonly pool: pg.Pool) {}

  async get(key: string) {
    const r = await this.pool.query('SELECT payload, extract(epoch from fetched_at) * 1000 AS ms FROM fixture_cache WHERE key=$1', [key]);
    return r.rows[0] ? { value: r.rows[0].payload as unknown, fetchedAt: Math.round(Number(r.rows[0].ms)) } : null;
  }

  async set(key: string, value: unknown, fetchedAt: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO fixture_cache (key, payload, fetched_at) VALUES ($1, $2::jsonb, to_timestamp($3 / 1000.0))
       ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
      [key, JSON.stringify(value), fetchedAt],
    );
  }

  async prune(olderThanMs: number): Promise<void> {
    await this.pool.query("DELETE FROM fixture_cache WHERE fetched_at < now() - ($1 || ' milliseconds')::interval", [String(olderThanMs)]);
  }
}
