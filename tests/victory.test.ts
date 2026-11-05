import { describe, expect, it, vi } from 'vitest';
import { mapFootballDataStandings } from '../src/services/football/adapters/footballData.js';
import {
  discoverCompetitions, mapVictoryFixture, mapVictoryStandings, mapVictoryStatus, victoryErrors,
} from '../src/services/football/adapters/victoryApi.js';
import { VictoryApiProvider } from '../src/services/football/providers/victoryApi.js';

/** Shape copied from the sample response in https://www.victoryapi.ir/home/documentation (fixtures). */
const docSample = {
  fixture: { id: 3310, referee: 'x', timezone: 'UTC', date: '2019-02-09T21:00:00+03:30', timestamp: 1549733400, venue: { id: null, name: 'Polman Stadion', city: 'Almelo' }, status: { long: 'Match Finished', short: 'FT', elapsed: 90, extra: null } },
  league: { id: 88, name: 'Eredivisie', country: 'Netherlands', logo: 'https://l/88.png', season: 2018, round: 'Regular Season - 21' },
  teams: { home: { id: 206, name: 'Heracles', logo: 'https://t/206.png', winner: true }, away: { id: 194, name: 'Ajax', logo: 'https://t/194.png', winner: false } },
  goals: { home: 4, away: 2 },
};
const code = (id: number) => (id === 88 ? 'IR1' : null);

describe('Victory API adapter (mocked, shape from official docs)', () => {
  it('maps the documented fixture sample; epoch timestamp is the UTC source of truth', () => {
    const f = mapVictoryFixture(docSample, code)!;
    expect(f).toMatchObject({
      id: 'va:3310', provider: 'victoryapi', competitionCode: 'IR1', homeTeam: 'Heracles', awayTeam: 'Ajax', status: 'finished',
      homeScore: 4, awayScore: 2, venue: 'Polman Stadion', homeTeamKey: 'va:206', kickoffUtc: '2019-02-09T17:30:00.000Z',
    });
  });
  it('falls back to the offset date when timestamp is missing, null otherwise', () => {
    const noTs = { ...docSample, fixture: { ...docSample.fixture, timestamp: null } };
    expect(mapVictoryFixture(noTs, code)!.kickoffUtc).toBe('2019-02-09T17:30:00.000Z');
    const none = { ...docSample, fixture: { ...docSample.fixture, timestamp: null, date: null } };
    expect(mapVictoryFixture(none, code)!.kickoffUtc).toBeNull();
  });
  it('null goals are not 0-0; unknown leagues and missing teams are dropped', () => {
    const ns = { ...docSample, fixture: { ...docSample.fixture, status: { short: 'NS', elapsed: null } }, goals: { home: null, away: null } };
    const f = mapVictoryFixture(ns, code)!;
    expect([f.status, f.homeScore, f.awayScore, f.minute]).toEqual(['scheduled', null, null, null]);
    expect(mapVictoryFixture(docSample, () => null)).toBeNull();
    expect(mapVictoryFixture({ ...docSample, teams: { home: { id: 1, name: null }, away: docSample.teams.away } }, code)).toBeNull();
  });
  it('live status exposes the elapsed minute', () => {
    const live = { ...docSample, fixture: { ...docSample.fixture, status: { short: '2H', elapsed: 63 } } };
    const f = mapVictoryFixture(live, code)!;
    expect([f.status, f.minute]).toEqual(['live', 63]);
  });
  it.each([['PST', 'postponed'], ['CANC', 'cancelled'], ['HT', 'paused'], ['AET', 'finished'], ['SUSP', 'suspended'], ['???', 'unknown']])('status %s -> %s', (s, e) => {
    expect(mapVictoryStatus(s)).toBe(e);
  });
  it('detects error envelopes', () => {
    expect(victoryErrors({ errors: [] })).toBeNull();
    expect(victoryErrors({ errors: { plan: 'Free plans do not have access to this league' } })).toMatch(/Free plans/);
  });
  it('maps standings (API-Football-compatible layout)', () => {
    const rows = mapVictoryStandings({ response: [{ league: { standings: [[{ rank: 1, team: { id: 2, name: 'Persepolis', logo: null }, points: 23, goalsDiff: 14, all: { played: 11, win: 7, draw: 2, lose: 2, goals: { for: 20, against: 6 } } }]] } }] });
    expect(rows[0]).toMatchObject({ rank: 1, team: 'Persepolis', points: 23, goalDiff: 14, played: 11, goalsFor: 20 });
    expect(mapVictoryStandings({})).toEqual([]);
  });
});

describe('Victory competition discovery (IDs are never hardcoded)', () => {
  const leagues = [
    { id: 1, name: 'Persian Gulf Pro League' }, { id: 2, name: 'Azadegan League' }, { id: 3, name: 'Hazfi Cup' },
    { id: 4, name: 'Super Cup' }, { id: 5, name: 'Super Cup Women' }, { id: 6, name: 'Women Premier League' },
  ];
  it('maps each real league once; women cups are not mistaken for men competitions', () => {
    const d = discoverCompetitions(leagues, 'iran');
    expect(Object.fromEntries(d.codes)).toEqual({ IR1: 1, IR2: 2, IRC: 3, IRS: 4, IRW: 6 });
    expect(d.ambiguous).toEqual([]);
  });
  it('skips a code when two leagues match instead of guessing', () => {
    const d = discoverCompetitions([{ id: 1, name: 'Hazfi Cup' }, { id: 2, name: 'Iran Hazfi Cup' }], 'iran');
    expect(d.codes.has('IRC')).toBe(false);
    expect(d.ambiguous).toEqual(['IRC']);
  });
  it('AFC scope', () => {
    const d = discoverCompetitions([{ id: 10, name: 'AFC Champions League Elite' }, { id: 11, name: 'AFC Champions League Two' }], 'afc');
    expect(Object.fromEntries(d.codes)).toEqual({ AFCE: 10, AFC2: 11 });
  });
});

describe('VictoryApiProvider with mocked HTTP', () => {
  function mockFetch(routes: Record<string, unknown>) {
    return vi.fn(async (url: string) => {
      const path = url.replace('https://api.v1.victoryapi.ir', '');
      const hit = Object.entries(routes).find(([k]) => path.startsWith(k));
      if (!hit) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(hit[1]), { status: 200 });
    });
  }
  const routes = {
    '/countries?name=Iran': { errors: [], response: [{ id: 412, name: 'Iran' }] },
    '/leagues?countryId=412': { errors: [], response: [{ league: { id: 290, name: 'Persian Gulf Pro League' } }, { league: { id: 291, name: 'Azadegan League' } }] },
    '/leagues?name=AFC': { errors: [], response: [] },
    '/fixtures?leagueId=290': { errors: [], response: [{ ...docSample, league: { ...docSample.league, id: 290, name: 'Persian Gulf Pro League' } }] },
    '/fixtures?leagueId=291': { errors: [], response: [] },
  };

  it('init discovers league IDs from the API and exposes only verified codes', async () => {
    const f = mockFetch(routes);
    const p = new VictoryApiProvider('KEY', { fetchImpl: f as never, sleep: async () => undefined });
    expect(p.competitions).toEqual([]);
    await p.init();
    expect(p.competitions.sort()).toEqual(['IR1', 'IR2']);
    expect(p.leagueIdFor('IR1')).toBe(290);
    // key is sent in the documented header and never in the URL
    const [, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers['x-vapi-key']).toBe('KEY');
    expect(f.mock.calls.every((c) => !String(c[0]).includes('KEY'))).toBe(true);
  });
  it('fetches fixtures per verified league and filters by UTC range', async () => {
    const p = new VictoryApiProvider('KEY', { fetchImpl: mockFetch(routes) as never, sleep: async () => undefined, now: () => Date.parse('2019-02-01T00:00:00Z') });
    await p.init();
    const inRange = await p.getFixturesBetween('2019-02-09', '2019-02-10');
    expect(inRange.map((x) => x.id)).toEqual(['va:3310']);
    expect(await p.getFixturesBetween('2019-03-01', '2019-03-02')).toEqual([]);
  });
  it('a plan/permission error from the API surfaces as an error (not silently empty)', async () => {
    const f = mockFetch({ ...routes, '/fixtures?leagueId=290': { errors: { plan: 'Not allowed on your plan' }, response: [] } });
    const p = new VictoryApiProvider('KEY', { fetchImpl: f as never, sleep: async () => undefined });
    await p.init();
    await expect(p.getCompetitionFixtures('IR1')).rejects.toThrow(/Not allowed/);
  });
});

describe('football-data standings mapping', () => {
  it('uses the TOTAL table and tolerates missing numbers', () => {
    const rows = mapFootballDataStandings({
      standings: [
        { type: 'HOME', table: [{ position: 9, team: { id: 1, name: 'X' } }] },
        { type: 'TOTAL', table: [{ position: 1, team: { id: 57, name: 'Arsenal FC', crest: 'c' }, playedGames: 10, won: 8, draw: 1, lost: 1, goalsFor: 20, goalsAgainst: 5, goalDifference: 15, points: 25 }, { position: 2, team: { id: 61, name: 'Chelsea FC' } }, { team: { name: 'no position' } }] },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ rank: 1, team: 'Arsenal FC', points: 25, goalDiff: 15 });
    expect(rows[1].points).toBeNull();
    expect(mapFootballDataStandings(null)).toEqual([]);
  });
});
