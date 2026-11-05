import type { Fixture } from '../src/types/fixture.js';
import type { FootballProvider } from '../src/services/football/providers/interface.js';
import type { User } from '../src/database/repositories/types.js';

export function fx(over: Partial<Fixture> = {}): Fixture {
  const id = over.id ?? `fd:${Math.floor(Math.random() * 1e9)}`;
  return {
    id,
    provider: 'footballdata',
    providerMatchId: id.split(':')[1],
    competitionCode: 'PL',
    competitionId: 'fd:2021',
    competitionName: 'Premier League',
    competitionLogo: null,
    homeTeam: 'Alpha FC',
    awayTeam: 'Beta United',
    homeTeamKey: 'fd:1',
    awayTeamKey: 'fd:2',
    homeLogo: null,
    awayLogo: null,
    kickoffUtc: '2026-11-07T15:00:00.000Z',
    status: 'scheduled',
    minute: null,
    homeScore: null,
    awayScore: null,
    venue: null,
    events: [],
    updatedAt: null,
    ...over,
  };
}

export function user(over: Partial<User> = {}): User {
  return {
    telegramId: 1,
    lang: 'en',
    timezone: 'UTC',
    defaultView: 'grouped',
    notif: { daily: false, favorites: false, reminders: false, competitions: false },
    blocked: false,
    langSelected: true,
    ...over,
  };
}

export class FakeProvider implements FootballProvider {
  calls = 0;
  fail = false;
  constructor(
    public readonly name: 'footballdata' | 'openligadb',
    public readonly competitions: readonly string[],
    public fixtures: Fixture[] = [],
  ) {}
  async getFixturesBetween(from: string, to: string): Promise<Fixture[]> {
    this.calls++;
    if (this.fail) throw new Error('boom');
    const a = Date.parse(`${from}T00:00:00Z`);
    const b = Date.parse(`${to}T00:00:00Z`);
    return this.fixtures.filter((f) => f.kickoffUtc && Date.parse(f.kickoffUtc) >= a && Date.parse(f.kickoffUtc) < b);
  }
  async getCompetitionFixtures(code: string): Promise<Fixture[]> {
    this.calls++;
    if (this.fail) throw new Error('boom');
    return this.fixtures.filter((f) => f.competitionCode === code);
  }
  async getFixtureById(id: string): Promise<Fixture | null> {
    this.calls++;
    if (this.fail) throw new Error('boom');
    return this.fixtures.find((f) => f.id === id) ?? null;
  }
  async health() {
    return { ok: !this.fail };
  }
}
