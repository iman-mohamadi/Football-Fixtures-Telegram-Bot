import { describe, expect, it } from 'vitest';
import { mapFootballDataMatch, mapFootballDataMatches } from '../src/services/football/adapters/footballData.js';
import { mapOpenLigaMatch, mapOpenLigaMatches } from '../src/services/football/adapters/openLiga.js';

const fdMatch = (over: Record<string, unknown> = {}) => ({
  id: 5001,
  utcDate: '2026-11-07T15:00:00Z',
  status: 'TIMED',
  competition: { id: 2021, name: 'Premier League', code: 'PL', emblem: 'https://x/pl.png' },
  homeTeam: { id: 57, name: 'Arsenal FC', crest: 'https://x/ars.png' },
  awayTeam: { id: 61, name: 'Chelsea FC', crest: 'https://x/che.png' },
  score: { fullTime: { home: null, away: null } },
  venue: 'Emirates Stadium',
  ...over,
});

describe('football-data adapter', () => {
  it('maps a scheduled match', () => {
    const f = mapFootballDataMatch(fdMatch())!;
    expect(f).toMatchObject({
      id: 'fd:5001', provider: 'footballdata', competitionCode: 'PL', homeTeam: 'Arsenal FC', awayTeam: 'Chelsea FC',
      status: 'scheduled', kickoffUtc: '2026-11-07T15:00:00.000Z', homeScore: null, awayScore: null, venue: 'Emirates Stadium',
      homeTeamKey: 'fd:57', homeLogo: 'https://x/ars.png',
    });
  });
  it('null score is NOT 0-0', () => {
    const f = mapFootballDataMatch(fdMatch({ score: { fullTime: { home: null, away: null } } }))!;
    expect(f.homeScore).toBeNull();
    expect(f.awayScore).toBeNull();
  });
  it('half-filled score is treated as missing', () => {
    const f = mapFootballDataMatch(fdMatch({ score: { fullTime: { home: 1, away: null } } }))!;
    expect(f.homeScore).toBeNull();
  });
  it('real 0-0 is kept', () => {
    const f = mapFootballDataMatch(fdMatch({ status: 'FINISHED', score: { fullTime: { home: 0, away: 0 } } }))!;
    expect([f.homeScore, f.awayScore]).toEqual([0, 0]);
    expect(f.status).toBe('finished');
  });
  it.each([
    ['IN_PLAY', 'live'], ['PAUSED', 'paused'], ['POSTPONED', 'postponed'], ['CANCELLED', 'cancelled'],
    ['SUSPENDED', 'suspended'], ['AWARDED', 'finished'], ['WEIRD', 'unknown'],
  ])('status %s -> %s', (raw, expected) => {
    expect(mapFootballDataMatch(fdMatch({ status: raw }))!.status).toBe(expected);
  });
  it('drops matches missing required fields', () => {
    expect(mapFootballDataMatch(fdMatch({ id: undefined }))).toBeNull();
    expect(mapFootballDataMatch(fdMatch({ homeTeam: { id: 1, name: null } }))).toBeNull();
    expect(mapFootballDataMatch(fdMatch({ competition: {} }))).toBeNull();
    expect(mapFootballDataMatch(null)).toBeNull();
  });
  it('invalid / missing utcDate gives null kickoff, not a fabricated one', () => {
    expect(mapFootballDataMatch(fdMatch({ utcDate: 'garbage' }))!.kickoffUtc).toBeNull();
    expect(mapFootballDataMatch(fdMatch({ utcDate: undefined }))!.kickoffUtc).toBeNull();
  });
  it('tolerates empty / malformed envelopes', () => {
    expect(mapFootballDataMatches({})).toEqual([]);
    expect(mapFootballDataMatches({ matches: null })).toEqual([]);
    expect(mapFootballDataMatches({ matches: [fdMatch(), { bad: true }] })).toHaveLength(1);
  });
});

const olMatch = (over: Record<string, unknown> = {}) => ({
  matchID: 9001,
  matchDateTimeUTC: '2026-11-07T14:30:00Z',
  leagueShortcut: 'bl1',
  team1: { teamId: 40, teamName: 'FC Bayern München', teamIconUrl: 'https://x/b.svg' },
  team2: { teamId: 16, teamName: 'VfB Stuttgart', teamIconUrl: null },
  matchIsFinished: false,
  matchResults: [],
  goals: [],
  location: null,
  ...over,
});

describe('OpenLigaDB adapter', () => {
  const now = Date.parse('2026-11-07T10:00:00Z');
  it('maps upcoming match with canonical competition code', () => {
    const f = mapOpenLigaMatch(olMatch(), now)!;
    expect(f).toMatchObject({ id: 'ol:9001', competitionCode: 'BL1', status: 'scheduled', homeScore: null, kickoffUtc: '2026-11-07T14:30:00.000Z' });
  });
  it('never reports live: unfinished past kickoff is unknown', () => {
    const f = mapOpenLigaMatch(olMatch(), Date.parse('2026-11-07T15:00:00Z'))!;
    expect(f.status).toBe('unknown');
    expect(f.homeScore).toBeNull();
  });
  it('maps finished match with final result and goals', () => {
    const f = mapOpenLigaMatch(
      olMatch({
        matchIsFinished: true,
        matchResults: [
          { resultTypeID: 1, pointsTeam1: 1, pointsTeam2: 0 },
          { resultTypeID: 2, pointsTeam1: 5, pointsTeam2: 1 },
        ],
        goals: [{ matchMinute: 21, goalGetterName: 'D. Upamecano', scoringTeamId: 40, scoreTeam1: 1, scoreTeam2: 0, isPenalty: false, isOwnGoal: false }],
      }),
      now,
    )!;
    expect([f.homeScore, f.awayScore, f.status]).toEqual([5, 1, 'finished']);
    expect(f.events[0]).toMatchObject({ minute: 21, player: 'D. Upamecano', team: 'home' });
  });
  it('finished without results has null score (not 0-0)', () => {
    const f = mapOpenLigaMatch(olMatch({ matchIsFinished: true, matchResults: [] }), now)!;
    expect(f.homeScore).toBeNull();
  });
  it('rejects unknown leagues and incomplete rows', () => {
    expect(mapOpenLigaMatch(olMatch({ leagueShortcut: 'xyz' }), now)).toBeNull();
    expect(mapOpenLigaMatch(olMatch({ team1: {} }), now)).toBeNull();
    expect(mapOpenLigaMatches('nope' as never, now)).toEqual([]);
  });
});
