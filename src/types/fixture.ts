export type ProviderName = 'footballdata' | 'openligadb' | 'victoryapi';

/** Prefix of bot-wide fixture/team ids per provider, e.g. fd:123 */
export const ID_PREFIX: Record<ProviderName, string> = { footballdata: 'fd', openligadb: 'ol', victoryapi: 'va' };

export type FixtureStatus =
  | 'scheduled'
  | 'live'
  | 'paused' // half-time / break while match is in progress
  | 'finished'
  | 'postponed'
  | 'suspended'
  | 'cancelled'
  | 'unknown';

export interface MatchEvent {
  type: 'goal';
  minute: number | null;
  player: string | null;
  team: 'home' | 'away' | null;
  detail: 'penalty' | 'own_goal' | null;
  homeScore: number | null;
  awayScore: number | null;
}

/** Provider-independent fixture. Null means "provider did not supply it" — never a default. */
export interface Fixture {
  /** Stable bot-wide id: `<prefix>:<providerMatchId>` e.g. `fd:123456` */
  id: string;
  provider: ProviderName;
  providerMatchId: string;
  /** Canonical competition code shared across providers, e.g. PL, BL1 */
  competitionCode: string;
  competitionId: string;
  competitionName: string;
  competitionLogo: string | null;
  homeTeam: string;
  awayTeam: string;
  homeTeamKey: string | null;
  awayTeamKey: string | null;
  homeLogo: string | null;
  awayLogo: string | null;
  /** ISO-8601 UTC, or null when the provider has no kickoff. Never invented. */
  kickoffUtc: string | null;
  status: FixtureStatus;
  minute: number | null;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  events: MatchEvent[];
  updatedAt: string | null;
}

export interface StandingRow {
  rank: number;
  team: string;
  teamKey: string | null;
  logo: string | null;
  played: number | null;
  won: number | null;
  draw: number | null;
  lost: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalDiff: number | null;
  points: number | null;
}

export const LIVE_STATUSES: FixtureStatus[] = ['live', 'paused'];

export interface Result<T> {
  data: T;
  /** epoch ms when the data was fetched from the provider */
  fetchedAt: number;
  /** true when a refresh failed and older cached data is being served */
  stale: boolean;
  /** providers that contributed */
  sources: string[];
  /** true when at least one provider that owns requested competitions failed (results may be incomplete) */
  partial?: boolean;
}
