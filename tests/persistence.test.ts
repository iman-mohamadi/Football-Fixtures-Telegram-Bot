import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FixtureService } from '../src/services/fixtures/fixtureService.js';
import { TtlCache } from '../src/services/football/cache.js';
import { FileCacheStore } from '../src/services/football/cacheStores.js';
import { FakeProvider, fx } from './helpers.js';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const clock = () => {
  let t = NOW;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};
const memStore = () => {
  const m = new Map<string, { value: unknown; fetchedAt: number }>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    // JSON round trip proves the cached values are serializable like in PostgreSQL / the file store
    set: async (k: string, value: unknown, fetchedAt: number) => void m.set(k, JSON.parse(JSON.stringify({ value, fetchedAt }))),
  };
};

describe('adaptive TTL (saves API quota)', () => {
  it('idle day is cached 20 min; a match starting within 30 min refreshes every 5 min', async () => {
    const c = clock();
    const idle = new FakeProvider('footballdata', ['PL'], [fx({ id: 'fd:1', kickoffUtc: '2026-11-07T18:00:00Z' })]);
    const s = new FixtureService([idle], { now: c.now });
    await s.getUtcDay('2026-11-07');
    c.advance(19 * 60_000);
    await s.getUtcDay('2026-11-07');
    expect(idle.calls).toBe(1);
    c.advance(2 * 60_000);
    await s.getUtcDay('2026-11-07');
    expect(idle.calls).toBe(2);
  });

  it('a past day where everything is settled is cached for 12 hours', async () => {
    const c = clock();
    const p = new FakeProvider('footballdata', ['PL'], [fx({ id: 'fd:1', kickoffUtc: '2026-11-06T15:00:00Z', status: 'finished', homeScore: 1, awayScore: 0 })]);
    const s = new FixtureService([p], { now: c.now });
    await s.getUtcDay('2026-11-06');
    c.advance(11 * 3600_000);
    await s.getUtcDay('2026-11-06');
    expect(p.calls).toBe(1);
  });
});

describe('persistent cache (restarts do not re-spend quota)', () => {
  it('a restart re-uses persisted data without any provider call', async () => {
    const store = memStore();
    const c = clock();
    const data = [fx({ id: 'fd:1', kickoffUtc: '2026-11-07T18:00:00Z' })];
    const first = new FakeProvider('footballdata', ['PL'], data);
    await new FixtureService([first], { now: c.now, store }).getUtcDay('2026-11-07');
    expect(first.calls).toBe(1);

    c.advance(5 * 60_000); // "restart": new service, empty memory, same store
    const second = new FakeProvider('footballdata', ['PL'], data);
    const r = await new FixtureService([second], { now: c.now, store }).getUtcDay('2026-11-07');
    expect(second.calls).toBe(0);
    expect(r.data.map((f) => f.id)).toEqual(['fd:1']);
    expect(r.stale).toBe(false);
  });

  it('expired persisted data is refreshed when the API works', async () => {
    const store = memStore();
    const c = clock();
    const data = [fx({ id: 'fd:1', kickoffUtc: '2026-11-07T18:00:00Z' })];
    await new FixtureService([new FakeProvider('footballdata', ['PL'], data)], { now: c.now, store }).getUtcDay('2026-11-07');
    c.advance(30 * 60_000);
    const second = new FakeProvider('footballdata', ['PL'], data);
    await new FixtureService([second], { now: c.now, store }).getUtcDay('2026-11-07');
    expect(second.calls).toBe(1);
  });

  it('with the API down, expired persisted data is served and flagged stale', async () => {
    const store = memStore();
    const c = clock();
    const data = [fx({ id: 'fd:1', kickoffUtc: '2026-11-07T18:00:00Z' })];
    await new FixtureService([new FakeProvider('footballdata', ['PL'], data)], { now: c.now, store }).getUtcDay('2026-11-07');
    c.advance(3 * 3600_000);
    const down = new FakeProvider('footballdata', ['PL'], data);
    down.fail = true;
    const r = await new FixtureService([down], { now: c.now, store }).getUtcDay('2026-11-07');
    expect(r.stale).toBe(true);
    expect(r.data).toHaveLength(1);
  });

  it('competition lists are persisted too', async () => {
    const store = memStore();
    const c = clock();
    await new FixtureService([new FakeProvider('footballdata', ['PL'], [fx({ id: 'fd:1' })])], { now: c.now, store }).getCompetition('PL');
    const b = new FakeProvider('footballdata', ['PL'], [fx({ id: 'fd:1' })]);
    await new FixtureService([b], { now: c.now, store }).getCompetition('PL');
    expect(b.calls).toBe(0);
  });
});

describe('FileCacheStore', () => {
  it('round-trips through a file and survives a new instance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-'));
    const path = join(dir, 'c.json');
    try {
      const a = new FileCacheStore(path);
      await a.set('day:2026-11-07', { list: [{ id: 'fd:1' }], partial: false }, 1000);
      a.flush();
      expect(JSON.parse(readFileSync(path, 'utf8'))['day:2026-11-07'].fetchedAt).toBe(1000);
      const b = new FileCacheStore(path, 10 ** 15, () => 2000);
      expect(await b.get('day:2026-11-07')).toEqual({ value: { list: [{ id: 'fd:1' }], partial: false }, fetchedAt: 1000 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('drops entries older than max age and ignores a corrupt file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-'));
    const path = join(dir, 'c.json');
    try {
      const a = new FileCacheStore(path);
      await a.set('old', 1, 0);
      a.flush();
      expect(await new FileCacheStore(path, 1000, () => 10_000).get('old')).toBeNull();
      writeFileSync(path, '{not json');
      expect(await new FileCacheStore(path).get('x')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('TtlCache keeps working if the store throws', async () => {
    const bad = { get: async () => { throw new Error('db down'); }, set: async () => { throw new Error('db down'); } };
    const c = new TtlCache<number>(Date.now, 1000, 10, bad);
    expect((await c.get('k', async () => 5, 1000)).value).toBe(5);
  });
});
