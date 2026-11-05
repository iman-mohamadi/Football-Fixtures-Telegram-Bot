import type { Fixture, FixtureStatus, StandingRow } from '../../../types/fixture.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Adapter for Victory API v1 (https://www.victoryapi.ir/home/documentation).
 * Response shape taken from the sample responses in the official documentation
 * (fixture / league / teams / goals blocks, status.short codes, epoch `timestamp`).
 * NOT verified against a live key (the account/plan needed for Iranian leagues is paid).
 */

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const STATUS: Record<string, FixtureStatus> = {
  TBD: 'scheduled', NS: 'scheduled',
  '1H': 'live', '2H': 'live', ET: 'live', P: 'live', LIVE: 'live',
  HT: 'paused', BT: 'paused',
  FT: 'finished', AET: 'finished', PEN: 'finished', AWD: 'finished', WO: 'finished',
  PST: 'postponed', CANC: 'cancelled', ABD: 'cancelled', SUSP: 'suspended', INT: 'suspended',
};

export function mapVictoryStatus(short: unknown): FixtureStatus {
  return typeof short === 'string' ? (STATUS[short] ?? 'unknown') : 'unknown';
}

export function mapVictoryFixture(raw: any, codeForLeague: (leagueId: number) => string | null): Fixture | null {
  const id = raw?.fixture?.id;
  const leagueId = num(raw?.league?.id);
  const home = str(raw?.teams?.home?.name);
  const away = str(raw?.teams?.away?.name);
  if (id == null || leagueId == null || !home || !away) return null;
  const code = codeForLeague(leagueId);
  if (!code) return null;

  // `timestamp` is epoch seconds (unambiguous UTC). `date` carries an offset and is only a fallback.
  let kickoffUtc: string | null = null;
  const ts = num(raw.fixture.timestamp);
  if (ts != null && ts > 0) kickoffUtc = new Date(ts * 1000).toISOString();
  else if (typeof raw.fixture.date === 'string' && !Number.isNaN(Date.parse(raw.fixture.date))) kickoffUtc = new Date(raw.fixture.date).toISOString();

  let homeScore = num(raw.goals?.home);
  let awayScore = num(raw.goals?.away);
  if (homeScore == null || awayScore == null) {
    homeScore = null;
    awayScore = null;
  }
  const status = mapVictoryStatus(raw.fixture.status?.short);

  return {
    id: `va:${id}`,
    provider: 'victoryapi',
    providerMatchId: String(id),
    competitionCode: code,
    competitionId: `va:${leagueId}`,
    competitionName: str(raw.league?.name) ?? code,
    competitionLogo: str(raw.league?.logo),
    homeTeam: home,
    awayTeam: away,
    homeTeamKey: raw.teams.home.id != null ? `va:${raw.teams.home.id}` : null,
    awayTeamKey: raw.teams.away.id != null ? `va:${raw.teams.away.id}` : null,
    homeLogo: str(raw.teams.home.logo),
    awayLogo: str(raw.teams.away.logo),
    kickoffUtc,
    status,
    minute: status === 'live' ? num(raw.fixture.status?.elapsed) : null,
    homeScore,
    awayScore,
    venue: str(raw.fixture.venue?.name),
    events: [],
    updatedAt: null,
  };
}

export function mapVictoryFixtures(raw: any, codeForLeague: (leagueId: number) => string | null): Fixture[] {
  const list = Array.isArray(raw?.response) ? raw.response : [];
  const out: Fixture[] = [];
  for (const r of list) {
    const f = mapVictoryFixture(r, codeForLeague);
    if (f) out.push(f);
  }
  return out;
}

/** `errors` is [] when fine; a non-empty array/object means the plan or request was rejected. */
export function victoryErrors(raw: any): string | null {
  const e = raw?.errors;
  if (Array.isArray(e) && e.length) return e.map(String).join('; ');
  if (e && typeof e === 'object' && !Array.isArray(e) && Object.keys(e).length) return Object.values(e).map(String).join('; ');
  return null;
}

export function mapVictoryStandings(raw: any): StandingRow[] {
  const table: any[] = raw?.response?.[0]?.league?.standings?.[0] ?? [];
  const out: StandingRow[] = [];
  for (const r of Array.isArray(table) ? table : []) {
    const name = str(r?.team?.name);
    const rank = num(r?.rank);
    if (!name || rank == null) continue;
    out.push({
      rank,
      team: name,
      teamKey: r.team?.id != null ? `va:${r.team.id}` : null,
      logo: str(r.team?.logo),
      played: num(r.all?.played),
      won: num(r.all?.win),
      draw: num(r.all?.draw),
      lost: num(r.all?.lose),
      goalsFor: num(r.all?.goals?.for),
      goalsAgainst: num(r.all?.goals?.against),
      goalDiff: num(r.goalsDiff),
      points: num(r.points),
    });
  }
  return out;
}

/** Tolerant league extraction: `{league:{id,name}}` or flat `{id,name}`. */
export function leagueIdName(item: any): { id: number; name: string } | null {
  const id = num(item?.league?.id) ?? num(item?.id);
  const name = str(item?.league?.name) ?? str(item?.name);
  return id != null && name ? { id, name } : null;
}

/**
 * Competition discovery rules. The league IDs are NEVER hardcoded: they are looked up from
 * the provider at runtime and a code is only enabled when exactly one league matches its pattern.
 */
export const VICTORY_COMPETITION_PATTERNS: { code: string; pattern: RegExp; scope: 'iran' | 'afc' }[] = [
  { code: 'IR1', pattern: /persian gulf pro league|iran pro league/i, scope: 'iran' },
  { code: 'IR2', pattern: /azadegan/i, scope: 'iran' },
  { code: 'IRC', pattern: /^(?!.*women).*hazfi/i, scope: 'iran' },
  { code: 'IRS', pattern: /^(?!.*women)(iran(ian)? )?super cup$/i, scope: 'iran' },
  { code: 'IR3', pattern: /^(?!.*women).*(league 2|2nd division|division 2)/i, scope: 'iran' },
  { code: 'IRW', pattern: /^(?=.*women)(?!.*cup).*(league|premier)/i, scope: 'iran' },
  { code: 'AFCE', pattern: /afc champions league.*elite/i, scope: 'afc' },
  { code: 'AFC2', pattern: /afc champions league two|afc champions league 2/i, scope: 'afc' },
];

export function discoverCompetitions(
  leagues: { id: number; name: string }[],
  scope: 'iran' | 'afc',
): { codes: Map<string, number>; ambiguous: string[] } {
  const codes = new Map<string, number>();
  const ambiguous: string[] = [];
  for (const rule of VICTORY_COMPETITION_PATTERNS.filter((r) => r.scope === scope)) {
    const hits = leagues.filter((l) => rule.pattern.test(l.name));
    if (hits.length === 1) codes.set(rule.code, hits[0].id);
    else if (hits.length > 1) ambiguous.push(rule.code);
  }
  return { codes, ambiguous };
}
