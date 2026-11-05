import { log } from '../../utils/logger.js';

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Sliding-window limiter: at most `max` acquisitions per `windowMs`. */
export class RateLimiter {
  private stamps: number[] = [];
  private chain: Promise<void> = Promise.resolve();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  acquire(): Promise<void> {
    const next = this.chain.then(async () => {
      for (;;) {
        const t = this.now();
        this.stamps = this.stamps.filter((s) => t - s < this.windowMs);
        if (this.stamps.length < this.max) {
          this.stamps.push(t);
          return;
        }
        await this.sleep(this.windowMs - (t - this.stamps[0]) + 5);
      }
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}

export interface UsageSnapshot {
  provider: string;
  day: string;
  requests: number;
  errors: number;
  rateLimited: number;
  remainingMinute: number | null;
}

export class UsageTracker {
  private data = new Map<string, UsageSnapshot>();
  constructor(private readonly now: () => number = Date.now) {}

  private entry(provider: string): UsageSnapshot {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    let e = this.data.get(provider);
    if (!e || e.day !== day) {
      e = { provider, day, requests: 0, errors: 0, rateLimited: 0, remainingMinute: e?.remainingMinute ?? null };
      this.data.set(provider, e);
    }
    return e;
  }
  record(provider: string, status: number | 'network', remaining?: number | null): void {
    const e = this.entry(provider);
    e.requests++;
    if (status === 429) e.rateLimited++;
    if (status === 'network' || (typeof status === 'number' && status >= 400)) e.errors++;
    if (remaining != null && !Number.isNaN(remaining)) e.remainingMinute = remaining;
  }
  snapshot(): UsageSnapshot[] {
    return [...this.data.keys()].map((k) => ({ ...this.entry(k) }));
  }
}

export interface HttpOptions {
  provider: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** total attempts including the first */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxRetryAfterMs?: number;
  limiter?: RateLimiter;
  usage?: UsageTracker;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** header carrying remaining requests per minute, if any */
  remainingHeader?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * GET JSON with timeout, rate limiting, 429 Retry-After handling and
 * exponential backoff on 5xx / network errors. 4xx (except 429) fail immediately.
 */
export async function getJson<T>(url: string, o: HttpOptions): Promise<T> {
  const attempts = o.maxAttempts ?? 3;
  const base = o.baseDelayMs ?? 500;
  const sleep = o.sleep ?? defaultSleep;
  const f = o.fetchImpl ?? fetch;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    await o.limiter?.acquire();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 8000);
    try {
      const res = await f(url, { headers: { Accept: 'application/json', ...o.headers }, signal: ctl.signal });
      const remaining = o.remainingHeader ? Number(res.headers.get(o.remainingHeader)) : null;
      o.usage?.record(o.provider, res.status, Number.isFinite(remaining) ? remaining : null);

      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after'));
        const wait = Math.min((Number.isFinite(ra) && ra > 0 ? ra * 1000 : base * 2 ** i * 4), o.maxRetryAfterMs ?? 15000);
        lastErr = new ProviderError('rate limited (429)', true, 429);
        log.warn('provider rate limited', { provider: o.provider, waitMs: wait });
        if (i < attempts - 1) await sleep(wait);
        continue;
      }
      if (res.status >= 500) {
        lastErr = new ProviderError(`server error ${res.status}`, true, res.status);
      } else if (res.status >= 400) {
        throw new ProviderError(`client error ${res.status}`, false, res.status);
      } else {
        try {
          return (await res.json()) as T;
        } catch {
          throw new ProviderError('invalid JSON', true, res.status);
        }
      }
    } catch (e) {
      if (e instanceof ProviderError && !e.retryable) throw e;
      if (!(e instanceof ProviderError)) {
        o.usage?.record(o.provider, 'network');
        lastErr = new ProviderError(ctl.signal.aborted ? 'timeout' : `network error: ${(e as Error).message}`, true);
      } else {
        lastErr = e;
      }
    } finally {
      clearTimeout(timer);
    }
    if (i < attempts - 1) {
      const delay = base * 2 ** i;
      log.debug('provider retry', { provider: o.provider, attempt: i + 1, delay });
      await sleep(delay);
    }
  }
  log.error('provider request failed', { provider: o.provider, err: lastErr as Error });
  throw lastErr instanceof Error ? lastErr : new ProviderError('request failed', true);
}
