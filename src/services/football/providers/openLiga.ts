import type { Fixture } from '../../../types/fixture.js';
import { mapOpenLigaMatches, OPENLIGA_LEAGUES } from '../adapters/openLiga.js';
import { TtlCache } from '../cache.js';
import { getJson, UsageTracker, type HttpOptions } from '../http.js';
import type { FootballProvider } from './interface.js';

/** OpenLigaDB: keyless, German football only (Bundesliga, 2. Bundesliga, DFB-Pokal). */
export class OpenLigaProvider implements FootballProvider {
  readonly name = 'openligadb' as const;
  readonly competitions: readonly string[] = Object.values(OPENLIGA_LEAGUES).map((l) => l.code);
  private readonly seasons = new TtlCache<Fixture[]>();
  private readonly http: HttpOptions;
  private readonly base: string;
  private readonly now: () => number;
  private readonly seasonTtlMs: number;

  constructor(opts: { baseUrl?: string; usage?: UsageTracker; fetchImpl?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; seasonTtlMs?: number } = {}) {
    this.base = opts.baseUrl ?? 'https://api.openligadb.de';
    this.now = opts.now ?? Date.now;
    this.seasonTtlMs = opts.seasonTtlMs ?? 10 * 60_000;
    this.http = { provider: this.name, usage: opts.usage, fetchImpl: opts.fetchImpl, sleep: opts.sleep, timeoutMs: 10_000 };
  }

  /** Season year: season 2026 runs Jul 2026 – Jun 2027 */
  static seasonFor(ms: number): number {
    const d = new Date(ms);
    return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  }

  private async season(shortcut: string, year: number): Promise<Fixture[]> {
    const hit = await this.seasons.get(
      `${shortcut}:${year}`,
      async () => mapOpenLigaMatches(await getJson<unknown>(`${this.base}/getmatchdata/${shortcut}/${year}`, this.http), this.now()),
      this.seasonTtlMs,
    );
    return hit.value;
  }

  private async allSeasons(years: number[]): Promise<Fixture[]> {
    const out: Fixture[] = [];
    for (const y of new Set(years)) {
      const lists = await Promise.all(Object.keys(OPENLIGA_LEAGUES).map((s) => this.season(s, y)));
      out.push(...lists.flat());
    }
    return out;
  }

  async getFixturesBetween(fromDate: string, toDateExclusive: string): Promise<Fixture[]> {
    const fromMs = Date.parse(`${fromDate}T00:00:00Z`);
    const toMs = Date.parse(`${toDateExclusive}T00:00:00Z`);
    const all = await this.allSeasons([OpenLigaProvider.seasonFor(fromMs), OpenLigaProvider.seasonFor(toMs - 1)]);
    return all.filter((f) => f.kickoffUtc && Date.parse(f.kickoffUtc) >= fromMs && Date.parse(f.kickoffUtc) < toMs);
  }

  async getCompetitionFixtures(code: string): Promise<Fixture[]> {
    const entry = Object.entries(OPENLIGA_LEAGUES).find(([, v]) => v.code === code);
    if (!entry) return [];
    return this.season(entry[0], OpenLigaProvider.seasonFor(this.now()));
  }

  async getFixtureById(id: string): Promise<Fixture | null> {
    if (!id.startsWith('ol:')) return null;
    const year = OpenLigaProvider.seasonFor(this.now());
    const all = await this.allSeasons([year]);
    return all.find((f) => f.id === id) ?? null;
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await getJson<unknown>(`${this.base}/getavailableleagues`, { ...this.http, maxAttempts: 1 });
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
