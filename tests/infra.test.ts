import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../src/services/football/cache.js';
import { getJson, ProviderError, RateLimiter, UsageTracker } from '../src/services/football/http.js';
import { paginate, clampPage, clampText } from '../src/utils/pagination.js';
import { effectiveStatus, sectionOf } from '../src/services/fixtures/status.js';
import { fx } from './helpers.js';

const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const noSleep = () => Promise.resolve();

describe('http client', () => {
  it('retries 5xx with exponential backoff then succeeds', async () => {
    const sleeps: number[] = [];
    const f = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(500)).mockResolvedValueOnce(res(200, { ok: 1 }));
    const out = await getJson<{ ok: number }>('http://x', { provider: 'p', fetchImpl: f as never, baseDelayMs: 100, sleep: async (ms) => void sleeps.push(ms) });
    expect(out.ok).toBe(1);
    expect(sleeps).toEqual([100, 200]);
  });
  it('honours Retry-After on 429', async () => {
    const sleeps: number[] = [];
    const usage = new UsageTracker();
    const f = vi.fn().mockResolvedValueOnce(res(429, {}, { 'retry-after': '7' })).mockResolvedValueOnce(res(200, { a: 1 }));
    await getJson('http://x', { provider: 'p', fetchImpl: f as never, sleep: async (ms) => void sleeps.push(ms), usage });
    expect(sleeps[0]).toBe(7000);
    expect(usage.snapshot()[0]).toMatchObject({ requests: 2, rateLimited: 1 });
  });
  it('does not retry 4xx (bad token) and throws non-retryable', async () => {
    const f = vi.fn().mockResolvedValue(res(403));
    await expect(getJson('http://x', { provider: 'p', fetchImpl: f as never, sleep: noSleep })).rejects.toMatchObject({ retryable: false, status: 403 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('gives up after max attempts', async () => {
    const f = vi.fn().mockResolvedValue(res(500));
    await expect(getJson('http://x', { provider: 'p', fetchImpl: f as never, sleep: noSleep, maxAttempts: 3 })).rejects.toBeInstanceOf(ProviderError);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('times out hung requests', async () => {
    const f = vi.fn((_u: string, init: { signal: AbortSignal }) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))));
    await expect(getJson('http://x', { provider: 'p', fetchImpl: f as never, sleep: noSleep, timeoutMs: 20, maxAttempts: 2 })).rejects.toThrow(/timeout/);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('invalid JSON is a retryable error', async () => {
    const f = vi.fn().mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(getJson('http://x', { provider: 'p', fetchImpl: f as never, sleep: noSleep, maxAttempts: 2 })).rejects.toThrow(/invalid JSON/);
  });
  it('rate limiter blocks the 3rd call within the window', async () => {
    let t = 0;
    const waits: number[] = [];
    const lim = new RateLimiter(2, 1000, () => t, async (ms) => { waits.push(ms); t += ms; });
    await lim.acquire();
    await lim.acquire();
    await lim.acquire();
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeGreaterThanOrEqual(1000);
  });
});

describe('ttl cache', () => {
  it('serves from cache until expiry, then reloads', async () => {
    let t = 0;
    const c = new TtlCache<number>(() => t);
    const loader = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect((await c.get('k', loader, 1000)).value).toBe(1);
    t = 999;
    expect((await c.get('k', loader, 1000)).value).toBe(1);
    t = 1001;
    expect((await c.get('k', loader, 1000)).value).toBe(2);
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it('deduplicates concurrent loads', async () => {
    const c = new TtlCache<number>();
    const loader = vi.fn(() => new Promise<number>((r) => setTimeout(() => r(7), 10)));
    const all = await Promise.all([c.get('k', loader, 1000), c.get('k', loader, 1000), c.get('k', loader, 1000)]);
    expect(all.every((x) => x.value === 7)).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it('serves stale data on refresh failure, flagged stale', async () => {
    let t = 0;
    const c = new TtlCache<number>(() => t);
    await c.get('k', async () => 5, 100);
    t = 500;
    const hit = await c.get('k', async () => { throw new Error('down'); }, 100);
    expect(hit).toMatchObject({ value: 5, stale: true, fetchedAt: 0 });
  });
  it('throws when there is no cached value to fall back on', async () => {
    const c = new TtlCache<number>();
    await expect(c.get('k', async () => { throw new Error('down'); }, 100)).rejects.toThrow('down');
  });
  it('drops data older than maxStale', async () => {
    let t = 0;
    const c = new TtlCache<number>(() => t, 1000);
    await c.get('k', async () => 5, 100);
    t = 5000;
    await expect(c.get('k', async () => { throw new Error('down'); }, 100)).rejects.toThrow();
  });
  it('dynamic ttl function', async () => {
    let t = 0;
    const c = new TtlCache<number>(() => t);
    const loader = vi.fn().mockResolvedValue(1);
    await c.get('k', loader, (v) => (v === 1 ? 10 : 1000));
    t = 11;
    await c.get('k', loader, () => 10);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('pagination', () => {
  it('splits by item count and char budget', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(paginate(items, { maxItems: 4, maxChars: 1e9, size: () => 1 }).map((p) => p.length)).toEqual([4, 4, 2]);
    expect(paginate(items, { maxItems: 100, maxChars: 30, size: () => 10 }).map((p) => p.length)).toEqual([3, 3, 3, 1]);
  });
  it('oversize single item still gets a page; empty gives no pages', () => {
    expect(paginate([1], { maxItems: 5, maxChars: 1, size: () => 99 })).toEqual([[1]]);
    expect(paginate([], { maxItems: 5, maxChars: 1, size: () => 1 })).toEqual([]);
  });
  it('clamps out-of-range pages', () => {
    expect(clampPage(99, 3)).toBe(2);
    expect(clampPage(-4, 3)).toBe(0);
    expect(clampPage(NaN, 3)).toBe(0);
    expect(clampPage(5, 0)).toBe(0);
  });
  it('clampText respects Telegram limit', () => {
    expect(clampText('a\n'.repeat(5000)).length).toBeLessThanOrEqual(4096);
  });
});

describe('status sanity', () => {
  const now = Date.parse('2026-11-07T15:30:00Z');
  it('live within window stays live', () => {
    expect(effectiveStatus(fx({ status: 'live', kickoffUtc: '2026-11-07T15:00:00Z' }), now)).toBe('live');
  });
  it('"live" for a match kicking off in 2 hours is unknown, never live', () => {
    expect(effectiveStatus(fx({ status: 'live', kickoffUtc: '2026-11-07T17:30:00Z' }), now)).toBe('unknown');
  });
  it('"live" for a match from 6 hours ago is unknown', () => {
    expect(effectiveStatus(fx({ status: 'live', kickoffUtc: '2026-11-07T09:00:00Z' }), now)).toBe('unknown');
  });
  it('live without kickoff is unknown', () => {
    expect(effectiveStatus(fx({ status: 'live', kickoffUtc: null }), now)).toBe('unknown');
  });
  it('scheduled long past kickoff is not shown as upcoming', () => {
    expect(sectionOf(fx({ status: 'scheduled', kickoffUtc: '2026-11-07T10:00:00Z' }), now)).toBe('other');
  });
  it('finished and postponed pass through', () => {
    expect(effectiveStatus(fx({ status: 'finished' }), now)).toBe('finished');
    expect(sectionOf(fx({ status: 'postponed' }), now)).toBe('other');
  });
});

