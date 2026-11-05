import { ID_PREFIX, LIVE_STATUSES, type Fixture, type Result, type StandingRow } from '../../types/fixture.js';
import { addDays, utcDateString } from '../../utils/time.js';
import { log } from '../../utils/logger.js';
import { normalizeName } from '../../utils/text.js';
import { TtlCache } from '../football/cache.js';
import type { FootballProvider } from '../football/providers/interface.js';
import { catalogKey, lookupTeam, teamMatchesQuery } from '../teams/catalog.js';
import { isLiveNow } from './status.js';

const MIN = 60_000;

export interface TtlPolicy {
  today: number;
  live: number;
  future: number;
  liveList: number;
  competition: number;
  window: number;
  fixtureDetail: number;
  standings: number;
}

export const DEFAULT_TTL: TtlPolicy = {
  today: 5 * MIN,
  live: 60_000,
  future: 20 * MIN,
  liveList: 60_000,
  competition: 20 * MIN,
  window: 20 * MIN,
  fixtureDetail: 60_000,
  standings: 30 * MIN,
};

export interface TeamRef {
  key: string;
  name: string;
  logo: string | null;
}

export const WINDOW_DAYS = 10;

/** A cached list plus whether a provider that owns some of its competitions failed. */
interface Bundle {
  list: Fixture[];
  partial: boolean;
}

/**
 * Provider routing rules (explicit — nothing is ever merged or averaged):
 *  1. `providers` is ordered by priority (e.g. Iranian provider, then international, then fallback).
 *  2. Each competition code is OWNED by the first provider that currently declares it.
 *     Fixtures of that competition come only from its owner, so two providers can never
 *     produce duplicates or conflicting copies of the same match.
 *  3. If the owner fails, the next provider that declares the same code is used as a fallback for
 *     that code only (its data keeps its own provider id and provenance).
 *  4. If no provider can serve a code, it is omitted and the result is flagged `partial`.
 *     If every provider fails and nothing is cached, the call throws.
 */
export class FixtureService {
  private day: TtlCache<Bundle>;
  private windowCache: TtlCache<Bundle>;
  private liveCache: TtlCache<Bundle>;
  private compCache: TtlCache<Bundle>;
  private detailCache: TtlCache<Fixture | null>;
  private standingsCache: TtlCache<StandingRow[]>;
  private readonly ttl: TtlPolicy;

  constructor(
    private readonly providers: FootballProvider[],
    private readonly opts: { now?: () => number; ttl?: Partial<TtlPolicy> } = {},
  ) {
    this.ttl = { ...DEFAULT_TTL, ...opts.ttl };
    const now = () => this.now();
    this.day = new TtlCache(now);
    this.windowCache = new TtlCache(now);
    this.liveCache = new TtlCache(now);
    this.compCache = new TtlCache(now);
    this.detailCache = new TtlCache(now);
    this.standingsCache = new TtlCache(now);
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  /** (Re)initializes providers that need discovery. Safe to call periodically. */
  async initProviders(): Promise<void> {
    for (const p of this.providers) {
      if (!p.init) continue;
      try {
        await p.init();
      } catch (e) {
        log.warn('provider init failed; will retry later', { provider: p.name, err: e as Error });
      }
    }
  }

  /** Codes actually available: union of what configured providers serve right now. */
  supportedCompetitions(): string[] {
    return [...new Set(this.providers.flatMap((p) => [...p.competitions]))];
  }

  /** Codes in priority order with the providers able to serve each. */
  private candidates(code: string): FootballProvider[] {
    return this.providers.filter((p) => p.competitions.includes(code));
  }

  private async fetchRange(from: string, toExcl: string): Promise<Bundle & { sources: string[] }> {
    const owned = new Map<FootballProvider, Set<string>>();
    for (const code of this.supportedCompetitions()) {
      const owner = this.candidates(code)[0];
      if (!owner) continue;
      const set = owned.get(owner) ?? new Set<string>();
      set.add(code);
      owned.set(owner, set);
    }
    const jobs = [...owned.entries()];
    const settled = await Promise.allSettled(jobs.map(([p]) => p.getFixturesBetween(from, toExcl)));
    const out: Fixture[] = [];
    const sources = new Set<string>();
    let partial = false;
    let firstErr: unknown;
    const retry: { code: string; failed: FootballProvider }[] = [];
    const failedProviders = new Set<FootballProvider>();

    settled.forEach((r, i) => {
      const [p, codes] = jobs[i];
      if (r.status === 'fulfilled') {
        const mine = r.value.filter((f) => codes.has(f.competitionCode));
        if (mine.length) sources.add(p.name);
        out.push(...mine);
      } else {
        firstErr ??= r.reason;
        failedProviders.add(p);
        log.warn('provider failed; trying fallbacks per competition', { provider: p.name, err: r.reason as Error });
        for (const c of codes) retry.push({ code: c, failed: p });
      }
    });

    // Fallback: group failed codes by the next candidate provider.
    const fb = new Map<FootballProvider, Set<string>>();
    for (const { code } of retry) {
      const next = this.candidates(code).find((p) => !failedProviders.has(p));
      if (!next) {
        partial = true;
        continue;
      }
      const s = fb.get(next) ?? new Set<string>();
      s.add(code);
      fb.set(next, s);
    }
    for (const [p, codes] of fb) {
      try {
        const rows = (await p.getFixturesBetween(from, toExcl)).filter((f) => codes.has(f.competitionCode));
        // A fallback only fills codes whose owner failed, so duplicates are impossible by construction.
        out.push(...rows);
        sources.add(p.name);
      } catch (e) {
        firstErr ??= e;
        partial = true;
        log.warn('fallback provider failed', { provider: p.name, err: e as Error });
      }
    }
    if (jobs.length && jobs.every((_, i) => settled[i].status === 'rejected') && !out.length) throw firstErr;
    if (!jobs.length) throw new Error('No football provider is ready');
    return { list: out, partial, sources: [...sources] };
  }

  private wrap<T, V>(hit: { value: V; fetchedAt: number; stale: boolean }, data: T, sources: string[], partial = false): Result<T> {
    return { data, fetchedAt: hit.fetchedAt, stale: hit.stale, sources, partial };
  }

  private sourcesOf(list: Fixture[]): string[] {
    return [...new Set(list.map((f) => f.provider))];
  }

  /** All fixtures whose kickoff falls on the UTC calendar date. */
  async getUtcDay(date: string): Promise<Result<Fixture[]>> {
    const today = utcDateString(this.now());
    const hit = await this.day.get(
      `day:${date}`,
      async () => {
        const r = await this.fetchRange(date, addDays(date, 1));
        return { list: r.list, partial: r.partial };
      },
      (v) => {
        if (date === today && v.list.some((f) => LIVE_STATUSES.includes(f.status) || isLiveNow(f, this.now()))) return this.ttl.live;
        return date <= today ? this.ttl.today : this.ttl.future;
      },
    );
    return this.wrap(hit, hit.value.list, this.sourcesOf(hit.value.list), hit.value.partial);
  }

  /** Fixtures within [startMs, endMs) merged from the UTC-day caches, sorted by kickoff. */
  async getRange(startMs: number, endMs: number, utcDates: string[]): Promise<Result<Fixture[]>> {
    const results = await Promise.all(utcDates.map((d) => this.getUtcDay(d)));
    const seen = new Map<string, Fixture>();
    for (const r of results) {
      for (const f of r.data) {
        if (!f.kickoffUtc) continue;
        const k = Date.parse(f.kickoffUtc);
        if (k >= startMs && k < endMs) seen.set(f.id, f);
      }
    }
    return {
      data: sortFixtures([...seen.values()]),
      fetchedAt: Math.min(...results.map((r) => r.fetchedAt)),
      stale: results.some((r) => r.stale),
      sources: [...new Set(results.flatMap((r) => r.sources))],
      partial: results.some((r) => r.partial),
    };
  }

  /** Next WINDOW_DAYS UTC days starting today. One provider call per owning provider. */
  async getWindow(): Promise<Result<Fixture[]>> {
    const from = utcDateString(this.now());
    const hit = await this.windowCache.get(
      `win:${from}`,
      async () => {
        const r = await this.fetchRange(from, addDays(from, WINDOW_DAYS));
        return { list: r.list, partial: r.partial };
      },
      this.ttl.window,
    );
    return this.wrap(hit, sortFixtures(hit.value.list), this.sourcesOf(hit.value.list), hit.value.partial);
  }

  /** Live matches. Only fixtures that pass the clock sanity check are returned. */
  async getLive(): Promise<Result<Fixture[]>> {
    const today = utcDateString(this.now());
    const hit = await this.liveCache.get(
      'live',
      async () => {
        const base = await this.fetchRange(addDays(today, -1), addDays(today, 1));
        const byId = new Map(base.list.map((f) => [f.id, f]));
        // Providers with a dedicated live endpoint overlay fresher data (only for codes they own).
        for (const p of this.providers) {
          if (!p.getLive) continue;
          try {
            for (const f of await p.getLive()) {
              if (this.candidates(f.competitionCode)[0] === p || !byId.has(f.id)) {
                if (p.competitions.includes(f.competitionCode)) byId.set(f.id, f);
              }
            }
          } catch (e) {
            log.warn('live overlay failed', { provider: p.name, err: e as Error });
          }
        }
        return { list: [...byId.values()], partial: base.partial };
      },
      this.ttl.liveList,
    );
    const now = this.now();
    return this.wrap(hit, sortFixtures(hit.value.list.filter((f) => isLiveNow(f, now))), this.sourcesOf(hit.value.list), hit.value.partial);
  }

  /** Whole current season of a competition, from its owner (fallback if the owner fails). */
  async getCompetition(code: string): Promise<Result<Fixture[]>> {
    const cands = this.candidates(code);
    if (!cands.length) return { data: [], fetchedAt: this.now(), stale: false, sources: [] };
    const hit = await this.compCache.get(
      `comp:${code}`,
      async () => {
        let lastErr: unknown;
        for (const p of cands) {
          try {
            return { list: await p.getCompetitionFixtures(code), partial: false };
          } catch (e) {
            lastErr = e;
            log.warn('competition fetch failed', { provider: p.name, code, err: e as Error });
          }
        }
        throw lastErr;
      },
      this.ttl.competition,
    );
    return this.wrap(hit, sortFixtures(hit.value.list), this.sourcesOf(hit.value.list));
  }

  async getCompetitionUpcoming(code: string): Promise<Result<Fixture[]>> {
    const r = await this.getCompetition(code);
    const now = this.now();
    return { ...r, data: r.data.filter((f) => f.status !== 'finished' && f.status !== 'cancelled' && (!f.kickoffUtc || Date.parse(f.kickoffUtc) > now - 3 * 3600_000 || f.status === 'postponed')) };
  }

  /** Most recent finished matches first. */
  async getCompetitionResults(code: string, limit = 40): Promise<Result<Fixture[]>> {
    const r = await this.getCompetition(code);
    const done = r.data.filter((f) => f.status === 'finished' && f.kickoffUtc).sort((a, b) => Date.parse(b.kickoffUtc!) - Date.parse(a.kickoffUtc!));
    return { ...r, data: done.slice(0, limit) };
  }

  async getCompetitionRange(code: string, startMs: number, endMs: number): Promise<Result<Fixture[]>> {
    const r = await this.getCompetition(code);
    return { ...r, data: r.data.filter((f) => f.kickoffUtc && Date.parse(f.kickoffUtc) >= startMs && Date.parse(f.kickoffUtc) < endMs) };
  }

  supportsStandings(code: string): boolean {
    return this.candidates(code).some((p) => p.getStandings && (p.supportsStandings?.(code) ?? true));
  }

  async getStandings(code: string): Promise<Result<StandingRow[]>> {
    const cands = this.candidates(code).filter((p) => p.getStandings && (p.supportsStandings?.(code) ?? true));
    if (!cands.length) return { data: [], fetchedAt: this.now(), stale: false, sources: [] };
    const hit = await this.standingsCache.get(
      `st:${code}`,
      async () => {
        let lastErr: unknown;
        for (const p of cands) {
          try {
            return await p.getStandings!(code);
          } catch (e) {
            lastErr = e;
            log.warn('standings fetch failed', { provider: p.name, code, err: e as Error });
          }
        }
        throw lastErr;
      },
      this.ttl.standings,
    );
    return this.wrap(hit, hit.value, [cands[0].name]);
  }

  private providerFor(id: string): FootballProvider | undefined {
    return this.providers.find((p) => id.startsWith(`${ID_PREFIX[p.name]}:`));
  }

  /** Cache-only lookup: never calls a provider. */
  peekFixture(id: string): Fixture | null {
    const d = this.detailCache.peek(`fx:${id}`);
    if (d?.value) return d.value;
    for (const c of [this.day, this.windowCache, this.liveCache, this.compCache]) {
      for (const b of c.values()) {
        const f = b.list.find((x) => x.id === id);
        if (f) return f;
      }
    }
    return null;
  }

  /** Looks in every cache first (no API call), then asks the owning provider. */
  async findFixture(id: string): Promise<Result<Fixture | null>> {
    for (const c of [this.day, this.windowCache, this.liveCache, this.compCache]) {
      for (const b of c.values()) {
        const f = b.list.find((x) => x.id === id);
        if (f) {
          const e = this.detailCache.peek(`fx:${id}`);
          return { data: e?.value ?? f, fetchedAt: e?.fetchedAt ?? this.now(), stale: false, sources: [f.provider] };
        }
      }
    }
    const provider = this.providerFor(id);
    if (!provider) return { data: null, fetchedAt: this.now(), stale: false, sources: [] };
    const hit = await this.detailCache.get(`fx:${id}`, () => provider.getFixtureById(id), this.ttl.fixtureDetail);
    return this.wrap(hit, hit.value, [provider.name]);
  }

  /** Detail refresh: re-asks the owning provider (1 API call); serves cache if that fails. */
  async refreshFixture(id: string): Promise<Result<Fixture | null>> {
    const provider = this.providerFor(id);
    if (!provider) return this.findFixture(id);
    const hit = await this.detailCache.get(`fx:${id}`, () => provider.getFixtureById(id), this.ttl.fixtureDetail);
    return this.wrap(hit, hit.value, [provider.name]);
  }

  /**
   * Team search over teams playing in the window. Query may be Persian or English.
   * Catalog teams are returned with a provider-independent `tc:` key; others keep the provider key.
   */
  async searchTeams(query: string, limit = 12): Promise<Result<TeamRef[]>> {
    const w = await this.getWindow();
    const q = query.trim();
    if (!q) return { ...w, data: [] };
    const teams = new Map<string, TeamRef>();
    for (const f of w.data) {
      for (const side of [
        { key: f.homeTeamKey, name: f.homeTeam, logo: f.homeLogo },
        { key: f.awayTeamKey, name: f.awayTeam, logo: f.awayLogo },
      ]) {
        if (!teamMatchesQuery(side.name, q)) continue;
        const entry = lookupTeam(side.name);
        const key = entry ? catalogKey(entry) : side.key;
        if (!key || teams.has(key)) continue;
        teams.set(key, { key, name: entry ? entry.en : side.name, logo: side.logo });
      }
    }
    return { ...w, data: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit) };
  }

  /** Fixtures of the given favorite teams in the next WINDOW_DAYS days. */
  async upcomingForTeams(teams: { key: string; name: string }[]): Promise<Result<Fixture[]>> {
    const w = await this.getWindow();
    const now = this.now();
    const data = w.data.filter(
      (f) => f.kickoffUtc && Date.parse(f.kickoffUtc) > now - 3 * 3600_000 && (isFavorite(teams, f.homeTeam, f.homeTeamKey) || isFavorite(teams, f.awayTeam, f.awayTeamKey)),
    );
    return { ...w, data };
  }

  async health(): Promise<Record<string, { ok: boolean; detail?: string }>> {
    const out: Record<string, { ok: boolean; detail?: string }> = {};
    for (const p of this.providers) out[p.name] = await p.health();
    return out;
  }
}

/** Favorite match rules: same provider team key, or same catalog team, or identical normalized name. */
export function isFavorite(favs: { key: string; name: string }[], teamName: string, teamKey: string | null): boolean {
  const entry = lookupTeam(teamName);
  const n = normalizeName(teamName);
  return favs.some(
    (f) => (teamKey && f.key === teamKey) || (entry && f.key === catalogKey(entry)) || (!f.key.startsWith('tc:') && normalizeName(f.name) === n),
  );
}

export function sortFixtures(list: Fixture[]): Fixture[] {
  return [...list].sort((a, b) => {
    const ka = a.kickoffUtc ? Date.parse(a.kickoffUtc) : Number.MAX_SAFE_INTEGER;
    const kb = b.kickoffUtc ? Date.parse(b.kickoffUtc) : Number.MAX_SAFE_INTEGER;
    return ka - kb || a.competitionName.localeCompare(b.competitionName) || a.homeTeam.localeCompare(b.homeTeam);
  });
}
