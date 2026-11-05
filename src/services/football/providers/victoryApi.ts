import type { Fixture, StandingRow } from '../../../types/fixture.js';
import { log } from '../../../utils/logger.js';
import {
  discoverCompetitions, leagueIdName, mapVictoryFixture, mapVictoryFixtures, mapVictoryStandings, victoryErrors,
} from '../adapters/victoryApi.js';
import { TtlCache } from '../cache.js';
import { getJson, ProviderError, RateLimiter, UsageTracker, type HttpOptions } from '../http.js';
import type { FootballProvider } from './interface.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Victory API (Iranian provider): the only candidate found that lists the Persian Gulf Pro League,
 * Azadegan League, Hazfi Cup, Super Cup and AFC competitions with an official, documented API.
 * Iranian leagues are on PAID plans (free test plan = 300 req/day, English league only), so this
 * provider is OFF unless VICTORYAPI_KEY is set, and every competition is verified at runtime
 * by `init()` before it is offered to users.
 */
export class VictoryApiProvider implements FootballProvider {
  readonly name = 'victoryapi' as const;
  private leagueByCode = new Map<string, number>();
  private codeByLeague = new Map<number, string>();
  private initialised = false;
  private readonly seasons: TtlCache<Fixture[]>;
  private readonly http: HttpOptions;
  private readonly base: string;
  private readonly now: () => number;
  private readonly seasonTtlMs: number;

  constructor(
    key: string,
    opts: { baseUrl?: string; usage?: UsageTracker; fetchImpl?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; seasonTtlMs?: number; perMinute?: number } = {},
  ) {
    this.base = opts.baseUrl ?? 'https://api.v1.victoryapi.ir';
    this.now = opts.now ?? Date.now;
    this.seasonTtlMs = opts.seasonTtlMs ?? 30 * 60_000;
    this.seasons = new TtlCache<Fixture[]>(this.now);
    this.http = {
      provider: this.name,
      headers: { 'x-vapi-key': key },
      limiter: new RateLimiter(opts.perMinute ?? 20, 60_000),
      usage: opts.usage,
      fetchImpl: opts.fetchImpl,
      sleep: opts.sleep,
      timeoutMs: 10_000,
    };
  }

  get competitions(): readonly string[] {
    return [...this.leagueByCode.keys()];
  }

  get ready(): boolean {
    return this.initialised;
  }

  leagueIdFor(code: string): number | undefined {
    return this.leagueByCode.get(code);
  }

  static seasonFor(ms: number): number {
    const d = new Date(ms);
    return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  }

  private async get<T = any>(path: string): Promise<T> {
    const raw = await getJson<any>(`${this.base}${path}`, this.http);
    const err = victoryErrors(raw);
    if (err) throw new ProviderError(`victoryapi: ${err}`, false);
    return raw as T;
  }

  /**
   * Discovers real league IDs. Iran: country lookup → its leagues. AFC: best-effort name search.
   * Codes with zero or multiple matches are skipped (never guessed).
   */
  async init(): Promise<void> {
    const found = new Map<string, number>();
    const country = await this.get(`/countries?name=Iran`);
    const iran = (country.response ?? []).find((c: any) => String(c?.name).toLowerCase() === 'iran');
    if (iran?.id != null) {
      const res = await this.get(`/leagues?countryId=${encodeURIComponent(iran.id)}`);
      const leagues = (res.response ?? []).map(leagueIdName).filter(Boolean);
      const d = discoverCompetitions(leagues, 'iran');
      d.codes.forEach((v, k) => found.set(k, v));
      if (d.ambiguous.length) log.warn('victoryapi: ambiguous league names skipped', { codes: d.ambiguous });
    } else {
      log.warn('victoryapi: Iran not found in /countries');
    }
    try {
      const afc = await this.get(`/leagues?name=${encodeURIComponent('AFC Champions League')}`);
      const d = discoverCompetitions((afc.response ?? []).map(leagueIdName).filter(Boolean), 'afc');
      d.codes.forEach((v, k) => found.set(k, v));
    } catch (e) {
      log.warn('victoryapi: AFC league discovery unavailable', { err: e as Error });
    }
    this.leagueByCode = found;
    this.codeByLeague = new Map([...found.entries()].map(([c, id]) => [id, c]));
    this.initialised = true;
    log.info('victoryapi competitions verified', { codes: [...found.keys()] });
  }

  private mapRaw(raw: any): Fixture[] {
    return mapVictoryFixtures(raw, (id) => this.codeByLeague.get(id) ?? null);
  }

  private async seasonFixtures(code: string): Promise<Fixture[]> {
    const leagueId = this.leagueByCode.get(code);
    if (leagueId == null) return [];
    const season = VictoryApiProvider.seasonFor(this.now());
    const hit = await this.seasons.get(
      `${code}:${season}`,
      async () => this.mapRaw(await this.get(`/fixtures?leagueId=${leagueId}&season=${season}`)),
      this.seasonTtlMs,
    );
    return hit.value;
  }

  async getFixturesBetween(fromDate: string, toDateExclusive: string): Promise<Fixture[]> {
    const a = Date.parse(`${fromDate}T00:00:00Z`);
    const b = Date.parse(`${toDateExclusive}T00:00:00Z`);
    const lists = await Promise.all(this.competitions.map((c) => this.seasonFixtures(c)));
    return lists.flat().filter((f) => f.kickoffUtc && Date.parse(f.kickoffUtc) >= a && Date.parse(f.kickoffUtc) < b);
  }

  getCompetitionFixtures(code: string): Promise<Fixture[]> {
    return this.seasonFixtures(code);
  }

  async getFixtureById(id: string): Promise<Fixture | null> {
    if (!id.startsWith('va:')) return null;
    const raw = await this.get(`/fixtures?id=${encodeURIComponent(id.slice(3))}`);
    const first = (raw.response ?? [])[0];
    return first ? mapVictoryFixture(first, (lid) => this.codeByLeague.get(lid) ?? null) : null;
  }

  async getLive(): Promise<Fixture[]> {
    return this.mapRaw(await this.get('/fixtures?live=all'));
  }

  supportsStandings(code: string): boolean {
    return this.leagueByCode.has(code);
  }

  async getStandings(code: string): Promise<StandingRow[]> {
    const leagueId = this.leagueByCode.get(code);
    if (leagueId == null) return [];
    return mapVictoryStandings(await this.get(`/standings?leagueId=${leagueId}&season=${VictoryApiProvider.seasonFor(this.now())}`));
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.get('/status');
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
