import type { Fixture, ProviderName, StandingRow } from '../../../types/fixture.js';

export interface FootballProvider {
  readonly name: ProviderName;
  /**
   * Canonical competition codes this provider can serve RIGHT NOW with its plan.
   * May be dynamic (e.g. discovered at `init()`), and is empty until the provider is ready.
   */
  readonly competitions: readonly string[];
  /** One-time/periodic setup (e.g. discovering real league IDs). Idempotent. */
  init?(): Promise<void>;
  /** true once `init()` succeeded (skipped by periodic re-init). */
  readonly ready?: boolean;
  /** Fixtures with kickoff in [fromDate 00:00Z, toDateExclusive 00:00Z). Dates are YYYY-MM-DD (UTC). */
  getFixturesBetween(fromDate: string, toDateExclusive: string): Promise<Fixture[]>;
  /** All fixtures of the current season of one competition (any status). */
  getCompetitionFixtures(code: string): Promise<Fixture[]>;
  /** `id` is the bot-wide id (`fd:123`). Returns null when not found. */
  getFixtureById(id: string): Promise<Fixture | null>;
  /** Optional: matches in play right now (fresher than season/day listings). */
  getLive?(): Promise<Fixture[]>;
  /** Optional league table. */
  supportsStandings?(code: string): boolean;
  getStandings?(code: string): Promise<StandingRow[]>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}
