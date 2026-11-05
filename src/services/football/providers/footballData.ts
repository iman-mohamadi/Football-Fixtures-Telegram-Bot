import type { Fixture, StandingRow } from '../../../types/fixture.js';
import { addDays } from '../../../utils/time.js';
import { mapFootballDataMatch, mapFootballDataMatches, mapFootballDataStandings } from '../adapters/footballData.js';
import { getJson, RateLimiter, UsageTracker, type HttpOptions } from '../http.js';
import type { FootballProvider } from './interface.js';

/**
 * Competitions in the free tier according to https://www.football-data.org/coverage (checked 2026-11-06).
 * The API itself only returns subscribed competitions; this list drives which ones the UI offers.
 * Europa League and the Persian Gulf Pro League are NOT in the free tier.
 */
export const FOOTBALL_DATA_FREE_COMPETITIONS = [
  'CL', 'PPL', 'PL', 'DED', 'BL1', 'FL1', 'SA', 'PD', 'ELC', 'BSA', 'WC', 'EC',
] as const;

const MAX_RANGE_DAYS = 10;

export class FootballDataProvider implements FootballProvider {
  readonly name = 'footballdata' as const;
  readonly competitions: readonly string[] = FOOTBALL_DATA_FREE_COMPETITIONS;
  private readonly limiter: RateLimiter;
  private readonly http: Omit<HttpOptions, 'headers'>;

  constructor(
    private readonly token: string,
    opts: { baseUrl?: string; usage?: UsageTracker; fetchImpl?: typeof fetch; limiter?: RateLimiter; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.base = opts.baseUrl ?? 'https://api.football-data.org/v4';
    // Free plan: 10 requests / minute. Stay one below to leave headroom for health checks.
    this.limiter = opts.limiter ?? new RateLimiter(9, 60_000);
    this.http = {
      provider: this.name,
      limiter: this.limiter,
      usage: opts.usage,
      fetchImpl: opts.fetchImpl,
      sleep: opts.sleep,
      remainingHeader: 'x-requests-available-minute',
    };
  }
  private readonly base: string;

  private get<T>(path: string): Promise<T> {
    return getJson<T>(`${this.base}${path}`, { ...this.http, headers: { 'X-Auth-Token': this.token } });
  }

  async getFixturesBetween(fromDate: string, toDateExclusive: string): Promise<Fixture[]> {
    const out = new Map<string, Fixture>();
    const fromMs = Date.parse(`${fromDate}T00:00:00Z`);
    const toMs = Date.parse(`${toDateExclusive}T00:00:00Z`);
    let cursor = fromDate;
    while (cursor < toDateExclusive) {
      // dateTo semantics are ambiguous across docs/versions, so we request one day beyond and filter locally.
      const chunkEnd = addDays(cursor, MAX_RANGE_DAYS - 1) < toDateExclusive ? addDays(cursor, MAX_RANGE_DAYS - 1) : toDateExclusive;
      const raw = await this.get(`/matches?dateFrom=${cursor}&dateTo=${chunkEnd}`);
      for (const f of mapFootballDataMatches(raw)) {
        if (!f.kickoffUtc) continue;
        const k = Date.parse(f.kickoffUtc);
        if (k >= fromMs && k < toMs) out.set(f.id, f);
      }
      cursor = chunkEnd;
    }
    return [...out.values()];
  }

  async getCompetitionFixtures(code: string): Promise<Fixture[]> {
    if (!this.competitions.includes(code)) return [];
    const raw = await this.get(`/competitions/${encodeURIComponent(code)}/matches`);
    return mapFootballDataMatches(raw);
  }

  supportsStandings(code: string): boolean {
    return this.competitions.includes(code) && !['WC', 'EC'].includes(code);
  }

  async getStandings(code: string): Promise<StandingRow[]> {
    const raw = await this.get<unknown>(`/competitions/${encodeURIComponent(code)}/standings`);
    return mapFootballDataStandings(raw);
  }

  async getFixtureById(id: string): Promise<Fixture | null> {
    if (!id.startsWith('fd:')) return null;
    try {
      const raw = await this.get(`/matches/${encodeURIComponent(id.slice(3))}`);
      return mapFootballDataMatch(raw);
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.get('/competitions/PL');
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
