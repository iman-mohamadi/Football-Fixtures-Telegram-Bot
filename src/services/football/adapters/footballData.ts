import type { Fixture, FixtureStatus, StandingRow } from '../../../types/fixture.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS: Record<string, FixtureStatus> = {
  SCHEDULED: 'scheduled',
  TIMED: 'scheduled',
  IN_PLAY: 'live',
  LIVE: 'live',
  PAUSED: 'paused',
  FINISHED: 'finished',
  AWARDED: 'finished',
  POSTPONED: 'postponed',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
};

export function mapFootballDataStatus(s: unknown): FixtureStatus {
  return typeof s === 'string' ? (STATUS[s] ?? 'unknown') : 'unknown';
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Maps one football-data.org v4 match. Returns null if it lacks the minimum (id, competition, both teams). */
export function mapFootballDataMatch(raw: any): Fixture | null {
  if (!raw || raw.id == null) return null;
  const comp = raw.competition;
  const home = str(raw.homeTeam?.name) ?? str(raw.homeTeam?.shortName);
  const away = str(raw.awayTeam?.name) ?? str(raw.awayTeam?.shortName);
  const code = str(comp?.code);
  if (!code || !home || !away) return null;

  const ft = raw.score?.fullTime;
  let homeScore = num(ft?.home);
  let awayScore = num(ft?.away);
  // Only trust a score if BOTH sides are numbers; a half-filled score is treated as missing.
  if (homeScore == null || awayScore == null) {
    homeScore = null;
    awayScore = null;
  }

  const events = Array.isArray(raw.goals)
    ? raw.goals
        .filter((g: any) => g && (g.minute != null || g.scorer))
        .map((g: any) => ({
          type: 'goal' as const,
          minute: num(g.minute),
          player: str(g.scorer?.name),
          team: g.team?.id === raw.homeTeam?.id ? ('home' as const) : g.team?.id === raw.awayTeam?.id ? ('away' as const) : null,
          detail: g.type === 'PENALTY' ? ('penalty' as const) : g.type === 'OWN' ? ('own_goal' as const) : null,
          homeScore: num(g.score?.home),
          awayScore: num(g.score?.away),
        }))
    : [];

  return {
    id: `fd:${raw.id}`,
    provider: 'footballdata',
    providerMatchId: String(raw.id),
    competitionCode: code,
    competitionId: `fd:${comp.id ?? code}`,
    competitionName: str(comp?.name) ?? code,
    competitionLogo: str(comp?.emblem),
    homeTeam: home,
    awayTeam: away,
    homeTeamKey: raw.homeTeam?.id != null ? `fd:${raw.homeTeam.id}` : null,
    awayTeamKey: raw.awayTeam?.id != null ? `fd:${raw.awayTeam.id}` : null,
    homeLogo: str(raw.homeTeam?.crest),
    awayLogo: str(raw.awayTeam?.crest),
    kickoffUtc: isoOrNull(raw.utcDate),
    status: mapFootballDataStatus(raw.status),
    minute: num(raw.minute),
    homeScore,
    awayScore,
    venue: str(raw.venue),
    events,
    updatedAt: isoOrNull(raw.lastUpdated),
  };
}

export function mapFootballDataMatches(raw: any): Fixture[] {
  const list = Array.isArray(raw?.matches) ? raw.matches : [];
  const out: Fixture[] = [];
  for (const m of list) {
    const f = mapFootballDataMatch(m);
    if (f) out.push(f);
  }
  return out;
}

/** football-data.org v4 `/competitions/{code}/standings` → first TOTAL table. */
export function mapFootballDataStandings(raw: any): StandingRow[] {
  const groups: any[] = Array.isArray(raw?.standings) ? raw.standings : [];
  const total = groups.find((g) => g?.type === 'TOTAL') ?? groups[0];
  const table: any[] = Array.isArray(total?.table) ? total.table : [];
  const out: StandingRow[] = [];
  for (const r of table) {
    const name = str(r?.team?.name) ?? str(r?.team?.shortName);
    const rank = num(r?.position);
    if (!name || rank == null) continue;
    out.push({
      rank,
      team: name,
      teamKey: r.team?.id != null ? `fd:${r.team.id}` : null,
      logo: str(r.team?.crest),
      played: num(r.playedGames),
      won: num(r.won),
      draw: num(r.draw),
      lost: num(r.lost),
      goalsFor: num(r.goalsFor),
      goalsAgainst: num(r.goalsAgainst),
      goalDiff: num(r.goalDifference),
      points: num(r.points),
    });
  }
  return out;
}
