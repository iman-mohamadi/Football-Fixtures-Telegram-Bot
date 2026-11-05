import type { Fixture, FixtureStatus, MatchEvent } from '../../../types/fixture.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** OpenLigaDB league shortcut -> canonical code + display name */
export const OPENLIGA_LEAGUES: Record<string, { code: string; name: string }> = {
  bl1: { code: 'BL1', name: 'Bundesliga' },
  bl2: { code: 'BL2', name: '2. Bundesliga' },
  dfb: { code: 'DFB', name: 'DFB-Pokal' },
};

/**
 * Maps one OpenLigaDB match. OpenLigaDB has NO live flag: an unfinished match whose kickoff is in the
 * past is reported as `unknown`, never `live`. Scores of unfinished matches are discarded.
 */
export function mapOpenLigaMatch(raw: any, now: number = Date.now()): Fixture | null {
  if (!raw || raw.matchID == null) return null;
  const shortcut = str(raw.leagueShortcut)?.toLowerCase();
  const league = shortcut ? OPENLIGA_LEAGUES[shortcut] : undefined;
  const home = str(raw.team1?.teamName);
  const away = str(raw.team2?.teamName);
  if (!league || !home || !away) return null;

  let kickoffUtc: string | null = null;
  if (typeof raw.matchDateTimeUTC === 'string') {
    const ms = Date.parse(raw.matchDateTimeUTC);
    if (!Number.isNaN(ms)) kickoffUtc = new Date(ms).toISOString();
  }
  const finished = raw.matchIsFinished === true;
  const kickMs = kickoffUtc ? Date.parse(kickoffUtc) : null;

  let status: FixtureStatus;
  if (finished) status = 'finished';
  else if (kickMs == null) status = 'unknown';
  else if (kickMs > now) status = 'scheduled';
  else status = 'unknown';

  let homeScore: number | null = null;
  let awayScore: number | null = null;
  if (finished && Array.isArray(raw.matchResults)) {
    const final = raw.matchResults.find((r: any) => r?.resultTypeID === 2) ?? raw.matchResults.at(-1);
    homeScore = num(final?.pointsTeam1);
    awayScore = num(final?.pointsTeam2);
    if (homeScore == null || awayScore == null) {
      homeScore = null;
      awayScore = null;
    }
  }

  const events: MatchEvent[] = finished && Array.isArray(raw.goals)
    ? raw.goals.map((g: any) => ({
        type: 'goal' as const,
        minute: num(g.matchMinute),
        player: str(g.goalGetterName),
        team: g.scoringTeamId === raw.team1?.teamId ? ('home' as const) : g.scoringTeamId === raw.team2?.teamId ? ('away' as const) : null,
        detail: g.isPenalty ? ('penalty' as const) : g.isOwnGoal ? ('own_goal' as const) : null,
        homeScore: num(g.scoreTeam1),
        awayScore: num(g.scoreTeam2),
      }))
    : [];

  return {
    id: `ol:${raw.matchID}`,
    provider: 'openligadb',
    providerMatchId: String(raw.matchID),
    competitionCode: league.code,
    competitionId: `ol:${shortcut}`,
    competitionName: league.name,
    competitionLogo: null,
    homeTeam: home,
    awayTeam: away,
    homeTeamKey: raw.team1?.teamId != null ? `ol:${raw.team1.teamId}` : null,
    awayTeamKey: raw.team2?.teamId != null ? `ol:${raw.team2.teamId}` : null,
    homeLogo: str(raw.team1?.teamIconUrl),
    awayLogo: str(raw.team2?.teamIconUrl),
    kickoffUtc,
    status,
    minute: null,
    homeScore,
    awayScore,
    venue: str(raw.location?.locationStadium),
    events,
    updatedAt: str(raw.lastUpdateDateTime),
  };
}

export function mapOpenLigaMatches(raw: any, now: number = Date.now()): Fixture[] {
  if (!Array.isArray(raw)) return [];
  const out: Fixture[] = [];
  for (const m of raw) {
    const f = mapOpenLigaMatch(m, now);
    if (f) out.push(f);
  }
  return out;
}
