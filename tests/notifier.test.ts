import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../src/database/repositories/memory.js';
import { FixtureService } from '../src/services/fixtures/fixtureService.js';
import { Notifier, UnreachableUserError } from '../src/services/notifications/notifier.js';
import { FakeProvider, fx } from './helpers.js';

const DEFAULTS = { lang: 'fa' as const, timezone: 'Asia/Tehran' };

function setup(now: { t: number }, fixtures = [] as ReturnType<typeof fx>[]) {
  const repo = new MemoryRepository();
  const provider = new FakeProvider('victoryapi', ['IR1', 'PL'], fixtures);
  const svc = new FixtureService([provider], { now: () => now.t, ttl: { today: 1, live: 1, future: 1, window: 1 } });
  const sent: { to: number; html: string }[] = [];
  let failNext: Error | null = null;
  const notifier = new Notifier(repo, svc, async (to, html) => {
    if (failNext) {
      const e = failNext;
      failNext = null;
      throw e;
    }
    sent.push({ to, html });
  }, () => now.t);
  return { repo, provider, svc, sent, notifier, failWith: (e: Error) => (failNext = e) };
}

const derby = (kick: string, over = {}) =>
  fx({ id: 'va:10', provider: 'victoryapi', competitionCode: 'IR1', competitionName: 'Persian Gulf Pro League', homeTeam: 'Esteghlal FC', awayTeam: 'Persepolis FC', homeTeamKey: 'va:1', awayTeamKey: 'va:2', kickoffUtc: kick, ...over });

describe('reminders', () => {
  const now = { t: Date.parse('2026-11-06T14:10:00Z') };

  it('sends nothing unless the user opted in', async () => {
    now.t = Date.parse('2026-11-06T14:10:00Z');
    const { repo, notifier, sent } = setup(now, [derby('2026-11-06T14:30:00Z')]);
    await repo.getOrCreateUser(1, DEFAULTS);
    await repo.addFavorite(1, { key: 'tc:esteghlal', name: 'Esteghlal' });
    await notifier.tick();
    expect(sent).toEqual([]);
  });

  it('Persian user gets a Persian reminder, English user an English one, once each', async () => {
    now.t = Date.parse('2026-11-06T14:10:00Z');
    const { repo, notifier, sent } = setup(now, [derby('2026-11-06T14:30:00Z')]);
    for (const [id, lang] of [[1, 'fa'], [2, 'en']] as const) {
      await repo.getOrCreateUser(id, DEFAULTS);
      await repo.updateUser(id, { lang, langSelected: true, timezone: 'Asia/Tehran' });
      await repo.setNotif(id, 'reminders', true);
      await repo.addFavorite(id, { key: 'tc:esteghlal', name: 'Esteghlal' });
    }
    await notifier.tick();
    await notifier.tick(); // duplicate tick
    now.t += 60_000;
    await notifier.tick();
    expect(sent).toHaveLength(2);
    const fa = sent.find((s) => s.to === 1)!.html;
    const en = sent.find((s) => s.to === 2)!.html;
    expect(fa).toContain('یادآوری مسابقه');
    expect(fa).toContain('استقلال × پرسپولیس');
    expect(fa).toContain('۲۰ دقیقه');
    expect(fa).toContain('۱۸:۰۰'); // user's timezone, Persian digits
    expect(en).toContain('Match Reminder');
    expect(en).toContain('Esteghlal vs Persepolis');
    expect(en).toContain('kicks off in 20 minutes');
    expect(en).toContain('18:00');
  });

  it('does not remind about matches outside the window or not involving the user', async () => {
    now.t = Date.parse('2026-11-06T14:10:00Z');
    const { repo, notifier, sent } = setup(now, [
      derby('2026-11-06T16:00:00Z'),
      fx({ id: 'fd:3', provider: 'victoryapi', competitionCode: 'PL', homeTeam: 'Everton FC', awayTeam: 'Burnley FC', homeTeamKey: 'x:1', awayTeamKey: 'x:2', kickoffUtc: '2026-11-06T14:25:00Z' }),
    ]);
    await repo.getOrCreateUser(1, DEFAULTS);
    await repo.setNotif(1, 'reminders', true);
    await repo.addFavorite(1, { key: 'tc:esteghlal', name: 'Esteghlal' });
    await notifier.tick();
    expect(sent).toEqual([]);
  });

  it('explicit per-match "Remind me" works without the general switch and obeys language', async () => {
    now.t = Date.parse('2026-11-06T14:10:00Z');
    const { repo, svc, notifier, sent } = setup(now, [derby('2026-11-06T14:30:00Z')]);
    await repo.getOrCreateUser(1, DEFAULTS);
    await repo.updateUser(1, { lang: 'en', langSelected: true });
    await notifier.tick();
    expect(sent).toEqual([]); // nothing requested yet
    await svc.getWindow();
    await repo.setMatchReminder(1, 'va:10', true);
    await notifier.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain('Match Reminder');
  });

  it('a rescheduled match is reminded again at its new time (dedupe key includes kickoff)', async () => {
    now.t = Date.parse('2026-11-06T14:10:00Z');
    const { repo, provider, notifier, sent } = setup(now, [derby('2026-11-06T14:30:00Z')]);
    await repo.getOrCreateUser(1, DEFAULTS);
    await repo.updateUser(1, { langSelected: true });
    await repo.setNotif(1, 'reminders', true);
    await repo.addFavorite(1, { key: 'tc:esteghlal', name: 'Esteghlal' });
    await notifier.tick();
    expect(sent).toHaveLength(1);
    provider.fixtures = [derby('2026-11-06T15:00:00Z')];
    now.t = Date.parse('2026-11-06T14:40:00Z');
    await notifier.tick();
    expect(sent).toHaveLength(2);
  });

  it('postponed matches are never reminded; an explicit reminder gets one postponement notice then is cleared', async () => {
    now.t = Date.parse('2026-11-06T14:10:00Z');
    const { repo, provider, svc, notifier, sent } = setup(now, [derby('2026-11-06T14:30:00Z', { status: 'postponed' })]);
    await repo.getOrCreateUser(1, DEFAULTS);
    await repo.updateUser(1, { langSelected: true });
    await repo.setNotif(1, 'reminders', true);
    await repo.addFavorite(1, { key: 'tc:esteghlal', name: 'Esteghlal' });
    await repo.setMatchReminder(1, 'va:10', true);
    await svc.getWindow(); // warm cache so the fixture is known
    await notifier.tick();
    await notifier.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain('تعویق');
    expect(await repo.hasMatchReminder(1, 'va:10')).toBe(false);
    void provider;
  });

  it('a failed send is released and retried; an unreachable user is paused', async () => {
    now.t = Date.parse('2026-11-06T14:10:00Z');
    const { repo, notifier, sent, failWith } = setup(now, [derby('2026-11-06T14:30:00Z')]);
    await repo.getOrCreateUser(1, DEFAULTS);
    await repo.updateUser(1, { langSelected: true });
    await repo.setNotif(1, 'reminders', true);
    await repo.addFavorite(1, { key: 'tc:esteghlal', name: 'Esteghlal' });
    failWith(new Error('network'));
    await notifier.tick();
    expect(sent).toHaveLength(0);
    await notifier.tick();
    expect(sent).toHaveLength(1); // retried
    await repo.getOrCreateUser(2, DEFAULTS);
    await repo.setNotif(2, 'reminders', true);
    await repo.addFavorite(2, { key: 'tc:persepolis', name: 'Persepolis' });
    failWith(new UnreachableUserError('blocked'));
    await notifier.tick();
    expect((await repo.getUser(2))?.blocked).toBe(true);
  });
});

describe('daily schedule', () => {
  it('is sent once at 08:00 in the user timezone, in the user language', async () => {
    const now = { t: Date.parse('2026-11-06T04:30:00Z') }; // 08:00 Tehran
    const { repo, notifier, sent } = setup(now, [derby('2026-11-06T14:30:00Z')]);
    await repo.getOrCreateUser(1, DEFAULTS);
    await repo.updateUser(1, { lang: 'fa', langSelected: true });
    await repo.setNotif(1, 'daily', true);
    await repo.getOrCreateUser(2, DEFAULTS);
    await repo.updateUser(2, { lang: 'en', langSelected: true, timezone: 'UTC' });
    await repo.setNotif(2, 'daily', true);

    await notifier.tick();
    expect(sent.map((s) => s.to)).toEqual([1]); // user 2 is at 04:30 UTC — not due
    expect(sent[0].html).toContain('برنامه امروز');
    expect(sent[0].html).toContain('۱۵ آبان');
    await notifier.tick();
    expect(sent).toHaveLength(1);

    now.t = Date.parse('2026-11-06T08:00:00Z');
    await notifier.tick();
    expect(sent.map((s) => s.to)).toEqual([1, 2]);
    expect(sent[1].html).toContain("Today's schedule");
  });

  it('sends nothing when there are no matches', async () => {
    const now = { t: Date.parse('2026-11-06T04:30:00Z') };
    const { repo, notifier, sent } = setup(now, []);
    await repo.getOrCreateUser(1, DEFAULTS);
    await repo.setNotif(1, 'daily', true);
    await notifier.tick();
    expect(sent).toEqual([]);
  });
});
