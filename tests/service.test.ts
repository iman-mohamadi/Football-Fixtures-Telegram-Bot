import { describe, expect, it } from 'vitest';
import { FixtureService } from '../src/services/fixtures/fixtureService.js';
import { dayRangeUtc, utcDatesCovering } from '../src/utils/time.js';
import { FakeProvider, fx } from './helpers.js';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const clock = (start = NOW) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe('FixtureService', () => {
  it('filters a Tehran local day across the UTC midnight boundary and sorts by kickoff', async () => {
    const c = clock();
    const p = new FakeProvider('footballdata', ['PL'], [
      fx({ id: 'fd:1', kickoffUtc: '2026-11-07T20:00:00Z' }), // 23:30 Tehran on 7th
      fx({ id: 'fd:2', kickoffUtc: '2026-11-07T21:00:00Z' }), // 00:30 Tehran on 8th
      fx({ id: 'fd:3', kickoffUtc: '2026-11-08T19:00:00Z' }), // 22:30 Tehran on 8th
      fx({ id: 'fd:4', kickoffUtc: '2026-11-08T21:00:00Z' }), // 00:30 Tehran on 9th
    ]);
    const s = new FixtureService([p], { now: c.now });
    const { startMs, endMs } = dayRangeUtc('2026-11-08', 'Asia/Tehran');
    const r = await s.getRange(startMs, endMs, utcDatesCovering(startMs, endMs));
    expect(r.data.map((f) => f.id)).toEqual(['fd:2', 'fd:3']);
  });

  it('excludes fixtures without kickoff (never fabricates a time)', async () => {
    const p = new FakeProvider('footballdata', ['PL'], [fx({ id: 'fd:1', kickoffUtc: null })]);
    const s = new FixtureService([p], { now: clock().now });
    const r = await s.getRange(0, Date.now() * 2, ['2026-11-07']);
    expect(r.data).toEqual([]);
  });

  it('caches day requests and de-duplicates concurrent users', async () => {
    const p = new FakeProvider('footballdata', ['PL'], [fx({ id: 'fd:1' })]);
    const s = new FixtureService([p], { now: clock().now });
    await Promise.all(Array.from({ length: 20 }, () => s.getUtcDay('2026-11-07')));
    await s.getUtcDay('2026-11-07');
    expect(p.calls).toBe(1);
  });

  it('refreshes after TTL expiry', async () => {
    const c = clock();
    const p = new FakeProvider('footballdata', ['PL'], [fx({ id: 'fd:1' })]);
    const s = new FixtureService([p], { now: c.now });
    await s.getUtcDay('2026-11-07');
    c.advance(6 * 60_000); // > today TTL (5 min)
    await s.getUtcDay('2026-11-07');
    expect(p.calls).toBe(2);
  });

  it('uses short TTL while a match is live', async () => {
    const c = clock(Date.parse('2026-11-07T15:30:00Z'));
    const p = new FakeProvider('footballdata', ['PL'], [fx({ id: 'fd:1', status: 'live', kickoffUtc: '2026-11-07T15:00:00Z' })]);
    const s = new FixtureService([p], { now: c.now });
    await s.getUtcDay('2026-11-07');
    c.advance(61_000);
    await s.getUtcDay('2026-11-07');
    expect(p.calls).toBe(2);
  });

  it('falls back to the secondary provider when primary fails', async () => {
    const p = new FakeProvider('footballdata', ['BL1'], []);
    p.fail = true;
    const sec = new FakeProvider('openligadb', ['BL1'], [fx({ id: 'ol:1', provider: 'openligadb', competitionCode: 'BL1' })]);
    const s = new FixtureService([p, sec], { now: clock().now });
    const r = await s.getUtcDay('2026-11-07');
    expect(r.data.map((f) => f.id)).toEqual(['ol:1']);
    expect(r.sources).toEqual(['openligadb']);
  });

  it('supplements primary with secondary-only competitions, without duplicating shared ones', async () => {
    const p = new FakeProvider('footballdata', ['BL1', 'PL'], [fx({ id: 'fd:1', competitionCode: 'BL1', homeTeam: 'A', awayTeam: 'B' })]);
    const sec = new FakeProvider('openligadb', ['BL1', 'BL2'], [
      fx({ id: 'ol:1', provider: 'openligadb', competitionCode: 'BL1', homeTeam: 'A', awayTeam: 'B' }),
      fx({ id: 'ol:2', provider: 'openligadb', competitionCode: 'BL2', homeTeam: 'C', awayTeam: 'D' }),
    ]);
    const s = new FixtureService([p, sec], { now: clock().now });
    const r = await s.getUtcDay('2026-11-07');
    expect(r.data.map((f) => f.id).sort()).toEqual(['fd:1', 'ol:2']);
  });

  it('a failing secondary does not break the primary result', async () => {
    const p = new FakeProvider('footballdata', ['PL'], [fx({ id: 'fd:1' })]);
    const sec = new FakeProvider('openligadb', ['BL2'], []);
    sec.fail = true;
    const s = new FixtureService([p, sec], { now: clock().now });
    expect((await s.getUtcDay('2026-11-07')).data).toHaveLength(1);
  });

  it('serves stale cache with stale=true when all providers are down', async () => {
    const c = clock();
    const p = new FakeProvider('footballdata', ['PL'], [fx({ id: 'fd:1' })]);
    const s = new FixtureService([p], { now: c.now });
    const first = await s.getUtcDay('2026-11-07');
    expect(first.stale).toBe(false);
    p.fail = true;
    c.advance(10 * 60_000);
    const second = await s.getUtcDay('2026-11-07');
    expect(second.stale).toBe(true);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.data).toHaveLength(1);
  });

  it('throws when nothing is cached and everything fails', async () => {
    const p = new FakeProvider('footballdata', ['PL'], []);
    p.fail = true;
    await expect(new FixtureService([p], { now: clock().now }).getUtcDay('2026-11-07')).rejects.toThrow();
  });

  it('empty provider response yields an empty (not failed) result', async () => {
    const r = await new FixtureService([new FakeProvider('footballdata', ['PL'], [])], { now: clock().now }).getUtcDay('2026-11-07');
    expect(r.data).toEqual([]);
    expect(r.stale).toBe(false);
  });

  it('live list only contains genuinely live matches', async () => {
    const c = clock(Date.parse('2026-11-07T15:30:00Z'));
    const p = new FakeProvider('footballdata', ['PL'], [
      fx({ id: 'fd:1', status: 'live', kickoffUtc: '2026-11-07T15:00:00Z' }),
      fx({ id: 'fd:2', status: 'live', kickoffUtc: '2026-11-07T20:00:00Z' }), // bad data: future match flagged live
      fx({ id: 'fd:3', status: 'finished', kickoffUtc: '2026-11-07T12:00:00Z' }),
      fx({ id: 'fd:4', status: 'scheduled', kickoffUtc: '2026-11-07T16:00:00Z' }),
    ]);
    const live = await new FixtureService([p], { now: c.now }).getLive();
    expect(live.data.map((f) => f.id)).toEqual(['fd:1']);
  });

  it('team search works on normalized names, accents and Persian aliases', async () => {
    const p = new FakeProvider('footballdata', ['PL'], [
      fx({ id: 'fd:1', homeTeam: 'Arsenal FC', homeTeamKey: 'fd:57', awayTeam: 'Real Madrid CF', awayTeamKey: 'fd:86' }),
    ]);
    const s = new FixtureService([p], { now: clock().now });
    expect((await s.searchTeams('arsenal')).data.map((t) => t.key)).toEqual(['tc:arsenal']);
    expect((await s.searchTeams('آرسنال')).data.map((t) => t.key)).toEqual(['tc:arsenal']);
    expect((await s.searchTeams('REAL')).data.map((t) => t.key)).toEqual(['tc:real-madrid']);
    expect((await s.searchTeams('zzz')).data).toEqual([]);
    expect((await s.searchTeams('  ')).data).toEqual([]);
  });

  it('upcoming fixtures for favorite teams', async () => {
    const p = new FakeProvider('footballdata', ['PL'], [
      fx({ id: 'fd:1', homeTeamKey: 'fd:57', awayTeamKey: 'fd:61', kickoffUtc: '2026-11-08T15:00:00Z' }),
      fx({ id: 'fd:2', homeTeamKey: 'fd:70', awayTeamKey: 'fd:71', homeTeam: 'X', awayTeam: 'Y', kickoffUtc: '2026-11-08T15:00:00Z' }),
    ]);
    const s = new FixtureService([p], { now: clock().now });
    const r = await s.upcomingForTeams([{ key: 'fd:57', name: 'Arsenal' }]);
    expect(r.data.map((f) => f.id)).toEqual(['fd:1']);
  });

  it('only advertises competitions a provider really supports', () => {
    const s = new FixtureService([new FakeProvider('footballdata', ['PL', 'PD']), new FakeProvider('openligadb', ['BL1'])]);
    expect(s.supportedCompetitions().sort()).toEqual(['BL1', 'PD', 'PL']);
    expect(s.supportedCompetitions()).not.toContain('IR1');
  });
});
