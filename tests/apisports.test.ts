import { describe, expect, it, vi } from 'vitest';
import { ApiSportsProvider } from '../src/services/football/providers/apiSports.js';

const league = (id: number, name: string, country: string, current = true) => ({
  league: { id, name, type: 'Cup' }, country: { name: country }, seasons: [{ year: 2026, current }, { year: 2025, current: false }],
});
const fixture = (id: number, leagueId: number, ts: number) => ({
  fixture: { id, timestamp: ts, status: { short: 'NS', elapsed: null }, venue: { name: null } },
  league: { id: leagueId, name: 'x' },
  teams: { home: { id: 1, name: 'A', logo: null }, away: { id: 2, name: 'B', logo: null } },
  goals: { home: null, away: null },
});

function mock(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const path = url.replace('https://v3.football.api-sports.io', '');
    const hit = Object.entries(routes).find(([k]) => path.startsWith(k));
    return new Response(JSON.stringify(hit ? hit[1] : { errors: [], response: [] }), { status: 200 });
  });
}
const opts = (f: unknown) => ({ fetchImpl: f as never, sleep: async () => undefined, now: () => Date.parse('2026-11-06T12:00:00Z') });

describe('ApiSportsProvider (mocked HTTP)', () => {
  const routes = {
    '/leagues?search=Europa': { errors: [], response: [league(3, 'UEFA Europa League', 'World'), league(99, 'UEFA Europa Conference League', 'World')] },
    '/leagues?search=Conference': { errors: [], response: [league(848, 'UEFA Europa Conference League', 'World')] },
    '/leagues?search=Persian': { errors: [], response: [league(290, 'Persian Gulf Pro League', 'Iran', false)] },
    '/fixtures?league=3&season=2026': { errors: [], response: [fixture(7, 3, 1794000000)] },
  };

  it('enables only competitions found exactly once WITH a current season', async () => {
    const f = mock(routes);
    const p = new ApiSportsProvider('SECRETKEY', opts(f));
    await p.init();
    expect(p.competitions.sort()).toEqual(['EL', 'UECL']); // Persian Gulf has no current season on this plan → not offered
    expect(p.ready).toBe(true);
    const first = f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(first[1].headers['x-apisports-key']).toBe('SECRETKEY');
    expect(f.mock.calls.every((c) => !String(c[0]).includes('SECRETKEY'))).toBe(true); // key only in the header
  });

  it('maps fixtures with the "as:" id prefix and its own provider name', async () => {
    const p = new ApiSportsProvider('K', opts(mock(routes)));
    await p.init();
    const list = await p.getCompetitionFixtures('EL');
    expect(list[0]).toMatchObject({ id: 'as:7', provider: 'apisports', competitionCode: 'EL', homeTeamKey: 'as:1', status: 'scheduled', homeScore: null });
    expect(await p.getFixtureById('va:1')).toBeNull();
  });

  it('stops calling the API when the daily budget is used up', async () => {
    const p = new ApiSportsProvider('K', { ...opts(mock(routes)), dailyBudget: 7, seasonTtlMs: 0 });
    await p.init(); // 6 discovery requests
    await p.getCompetitionFixtures('EL'); // 7th
    await expect(p.getStandings('EL')).rejects.toThrow(/budget/); // uncached call is refused
    expect((await p.getCompetitionFixtures('EL')).length).toBe(1); // cached data keeps being served (stale-on-error)
    expect(p.requestsToday).toBe(7);
  });

  it('a plan restriction is an error, never an empty list', async () => {
    const p = new ApiSportsProvider('K', opts(mock({ '/fixtures?league=3&season': { errors: { plan: 'Free plans do not have access to this season' }, response: [] }, ...routes })));
    await p.init();
    await expect(p.getCompetitionFixtures('EL')).rejects.toThrow(/Free plans/);
  });
});
