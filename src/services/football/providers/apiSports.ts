import type { Fixture, StandingRow } from '../../../types/fixture.js';
import { log } from '../../../utils/logger.js';
import { leagueIdName, mapVictoryFixture, mapVictoryFixtures, mapVictoryStandings, victoryErrors, type ApiSource } from '../adapters/victoryApi.js';
import { TtlCache } from '../cache.js';
import { getJson, ProviderError, RateLimiter, UsageTracker, type HttpOptions } from '../http.js';
import type { FootballProvider } from './interface.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SRC: ApiSource = { provider: 'apisports', prefix: 'as' };

/** What we try to find on the account. Each rule must match EXACTLY ONE league that has a current season. */
export const APISPORTS_WANTED: { code: string; search: string; name: RegExp; country?: RegExp }[] = [
  { code: 'EL', search: 'Europa League', name: /^uefa europa league$/i },
  { code: 'UECL', search: 'Conference League', name: /^uefa (europa )?conference league$/i },
  { code: 'IR1', search: 'Persian Gulf', name: /^persian gulf pro league$/i, country: /^iran$/i },
  { code: 'IR2', search: 'Azadegan', name: /^azadegan league$/i, country: /^iran$/i },
  { code: 'IRC', search: 'Hazfi', name: /^(iran )?hazfi cup$/i, country: /^iran$/i },
  { code: 'IRS', search: 'Super Cup', name: /^(iran )?super cup$/i, country: /^iran$/i },
];

/**
 * API-Football (api-sports.io) – free plan: 100 requests/day. It is the only other credible free source found,
 * but whether the free plan serves the CURRENT season cannot be known without a key. So `init()` verifies, per
 * competition, that the league exists with a current season, and a plan restriction at fetch time surfaces as an
 * error (never as "no matches"). A hard daily budget stops calls before the quota is exhausted; the persistent
 * cache keeps serving older data after that.
 */
export class ApiSportsProvider implements FootballProvider {
  readonly name = 'apisports' as const;
  private leagues = new Map<string, { id: number; season: number }>();
  private codeByLeague = new Map<number, string>();
  private initialised = false;
  private used = 0;
  private usedDay = '';
  private readonly seasons: TtlCache<Fixture[]>;
  private readonly http: HttpOptions;
  private readonly base: string;
  private readonly now: () => number;
  private readonly seasonTtlMs: number;
  private readonly dailyBudget: number;

  constructor(
    key: string,
    opts: { baseUrl?: string; usage?: UsageTracker; fetchImpl?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; seasonTtlMs?: number; dailyBudget?: number } = {},
  ) {
    this.base = opts.baseUrl ?? 'https://v3.football.api-sports.io';
    this.now = opts.now ?? Date.now;
    this.seasonTtlMs = opts.seasonTtlMs ?? 3 * 3600_000;
    this.dailyBudget = opts.dailyBudget ?? 90; // free plan = 100/day; keep headroom
    this.seasons = new TtlCache<Fixture[]>(this.now);
    this.http = {
      provider: this.name,
      headers: { 'x-apisports-key': key },
      limiter: new RateLimiter(8, 60_000),
      usage: opts.usage,
      fetchImpl: opts.fetchImpl,
      sleep: opts.sleep,
      timeoutMs: 10_000,
      remainingHeader: 'x-ratelimit-requests-remaining',
    };
  }

  get competitions(): readonly string[] {
    return [...this.leagues.keys()];
  }
  get ready(): boolean {
    return this.initialised;
  }
  /** requests spent today (UTC) – exposed for tests/health */
  get requestsToday(): number {
    return this.used;
  }

  private spend(): void {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.usedDay) {
      this.usedDay = day;
      this.used = 0;
    }
    if (this.used >= this.dailyBudget) throw new ProviderError('apisports daily request budget exhausted', false);
    this.used++;
  }

  private async get<T = any>(path: string): Promise<T> {
    this.spend();
    const raw = await getJson<any>(`${this.base}${path}`, this.http);
    const err = victoryErrors(raw);
    if (err) throw new ProviderError(`apisports: ${err}`, false);
    return raw as T;
  }

  /** Looks the wanted competitions up and enables only those found exactly once with a current season. */
  async init(): Promise<void> {
    const found = new Map<string, { id: number; season: number }>();
    for (const w of APISPORTS_WANTED) {
      try {
        const res = await this.get(`/leagues?search=${encodeURIComponent(w.search)}&current=true`);
        const hits = (res.response ?? []).filter((it: any) => {
          const l = leagueIdName(it);
          if (!l || !w.name.test(l.name)) return false;
          return w.country ? w.country.test(String(it?.country?.name ?? '')) : true;
        });
        if (hits.length !== 1) {
          if (hits.length > 1) log.warn('apisports: ambiguous league, skipped', { code: w.code });
          continue;
        }
        const cur = (hits[0].seasons ?? []).find((s: any) => s?.current === true && typeof s?.year === 'number');
        const l = leagueIdName(hits[0])!;
        if (cur) found.set(w.code, { id: l.id, season: cur.year });
        else log.info('apisports: league found but no current season on this plan', { code: w.code });
      } catch (e) {
        log.warn('apisports: discovery failed for competition', { code: w.code, err: e as Error });
      }
    }
    this.leagues = found;
    this.codeByLeague = new Map([...found.entries()].map(([c, v]) => [v.id, c]));
    this.initialised = true;
    log.info('apisports competitions verified', { codes: [...found.keys()] });
  }

  private async seasonFixtures(code: string): Promise<Fixture[]> {
    const l = this.leagues.get(code);
    if (!l) return [];
    const hit = await this.seasons.get(
      `${code}:${l.season}`,
      async () => mapVictoryFixtures(await this.get(`/fixtures?league=${l.id}&season=${l.season}`), (id) => this.codeByLeague.get(id) ?? null, SRC),
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
    if (!id.startsWith('as:')) return null;
    const raw = await this.get(`/fixtures?id=${encodeURIComponent(id.slice(3))}`);
    const first = (raw.response ?? [])[0];
    return first ? mapVictoryFixture(first, (lid) => this.codeByLeague.get(lid) ?? null, SRC) : null;
  }

  supportsStandings(code: string): boolean {
    return this.leagues.has(code);
  }

  async getStandings(code: string): Promise<StandingRow[]> {
    const l = this.leagues.get(code);
    if (!l) return [];
    return mapVictoryStandings(await this.get(`/standings?league=${l.id}&season=${l.season}`), 'as');
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
