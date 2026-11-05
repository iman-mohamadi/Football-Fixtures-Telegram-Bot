import { describe, expect, it } from 'vitest';
import type { InlineKeyboard } from 'grammy';
import { LANGUAGE_PICKER_TEXT, t } from '../src/i18n/index.js';
import { MemoryRepository } from '../src/database/repositories/memory.js';
import { FixtureService } from '../src/services/fixtures/fixtureService.js';
import {
  entryView, handleText, route, type Deps, type Session,
} from '../src/bot/views.js';
import type { StandingRow } from '../src/types/fixture.js';
import { FakeProvider, fx } from './helpers.js';

const NOW = Date.parse('2026-11-06T12:00:00Z'); // Friday 15 Aban 1405
const DEFAULTS = { lang: 'fa' as const, timezone: 'Asia/Tehran' };

function setup(opts: { iran?: boolean } = {}) {
  const repo = new MemoryRepository();
  const intl = new FakeProvider('footballdata', ['PL', 'BL1'], [
    fx({ id: 'fd:1', homeTeam: 'Arsenal FC', awayTeam: 'Chelsea FC', homeTeamKey: 'fd:57', awayTeamKey: 'fd:61', kickoffUtc: '2026-11-06T17:00:00Z', venue: 'Emirates Stadium' }),
    fx({ id: 'fd:2', homeTeam: 'Everton FC', awayTeam: 'Burnley FC', homeTeamKey: 'fd:62', awayTeamKey: 'fd:328', kickoffUtc: '2026-11-07T15:00:00Z' }),
  ]);
  const iran = new FakeProvider('victoryapi', ['IR1', 'IR2'], [
    fx({
      id: 'va:10', provider: 'victoryapi', competitionCode: 'IR1', competitionName: 'Persian Gulf Pro League', homeTeam: 'Esteghlal FC', awayTeam: 'Persepolis FC',
      homeTeamKey: 'va:1', awayTeamKey: 'va:2', kickoffUtc: '2026-11-06T14:30:00Z', venue: 'Azadi Stadium',
    }),
    fx({
      id: 'va:11', provider: 'victoryapi', competitionCode: 'IR1', competitionName: 'Persian Gulf Pro League', homeTeam: 'Sepahan SC', awayTeam: 'Tractor SC',
      homeTeamKey: 'va:3', awayTeamKey: 'va:4', kickoffUtc: '2026-11-06T12:30:00Z', venue: null,
    }),
  ]) as FakeProvider & { getStandings?: () => Promise<StandingRow[]>; supportsStandings?: (c: string) => boolean };
  iran.supportsStandings = (c) => c === 'IR1';
  iran.getStandings = async () => [
    { rank: 1, team: 'Persepolis FC', teamKey: 'va:2', logo: null, played: 11, won: 7, draw: 2, lost: 2, goalsFor: 20, goalsAgainst: 6, goalDiff: 14, points: 23 },
    { rank: 2, team: 'Sepahan SC', teamKey: 'va:3', logo: null, played: 11, won: 6, draw: 5, lost: 0, goalsFor: 15, goalsAgainst: 3, goalDiff: 12, points: 23 },
  ];
  const providers = opts.iran === false ? [intl] : [iran, intl];
  const fixtures = new FixtureService(providers, { now: () => NOW });
  const deps: Deps = { repo, fixtures, sessions: new Map<number, Session>(), defaults: DEFAULTS, now: () => NOW };
  return { repo, deps, fixtures };
}

async function fresh(deps: Deps, id = 1) {
  return deps.repo.getOrCreateUser(id, deps.defaults);
}
function buttons(kb: InlineKeyboard): { text: string; data: string }[] {
  return kb.inline_keyboard.flat().map((b) => ({ text: b.text, data: (b as { callback_data?: string }).callback_data ?? '' }));
}
async function pick(deps: Deps, id: number, data: string) {
  const user = (await deps.repo.getUser(id))!;
  return route(data, user, deps);
}

describe('first-time language selection', () => {
  it('a new user sees ONLY the language picker — never the main menu', async () => {
    const { deps } = setup();
    const user = await fresh(deps);
    expect(user.langSelected).toBe(false);
    const v = entryView(user);
    expect(v.text).toBe(LANGUAGE_PICKER_TEXT);
    const b = buttons(v.kb);
    expect(b.map((x) => x.data)).toEqual(['ln:fa', 'ln:en']);
    expect(b.map((x) => x.text)).toEqual(['🇮🇷 فارسی', '🇬🇧 English']);
  });
  it('every other action is blocked behind the picker until a language is chosen', async () => {
    const { deps } = setup();
    await fresh(deps);
    for (const data of ['menu', 'today', 'lv', 'ir', 'wd', 'st', 'fv:0', 'nt', 'wk']) {
      const r = await pick(deps, 1, data);
      expect(r?.view.text, data).toBe(LANGUAGE_PICKER_TEXT);
    }
    const txt = await handleText('hello', (await deps.repo.getUser(1))!, deps);
    expect(txt?.view.text).toBe(LANGUAGE_PICKER_TEXT);
  });
  it('choosing فارسی persists fa + Tehran timezone and opens the Persian menu', async () => {
    const { deps, repo } = setup();
    await fresh(deps);
    const r = await pick(deps, 1, 'ln:fa');
    expect(r?.onboarded).toBe(true);
    expect(r?.view.text).toContain('فوتبال سنتر');
    const stored = await repo.getUser(1);
    expect(stored).toMatchObject({ lang: 'fa', langSelected: true, timezone: 'Asia/Tehran' });
  });
  it('choosing English persists en + UTC initial timezone and opens the English menu', async () => {
    const { deps, repo } = setup();
    await fresh(deps);
    const r = await pick(deps, 1, 'ln:en');
    expect(r?.view.text).toContain('Football Center');
    expect(await repo.getUser(1)).toMatchObject({ lang: 'en', langSelected: true, timezone: 'UTC' });
  });
  it('returning users are not asked again — also after a "restart" (new sessions, same database)', async () => {
    const { deps, repo } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:fa');
    const restarted: Deps = { ...deps, sessions: new Map(), fixtures: new FixtureService([new FakeProvider('footballdata', ['PL'])], { now: () => NOW }) };
    const user = await repo.getOrCreateUser(1, DEFAULTS);
    const v = entryView(user);
    expect(v.text).toContain('فوتبال سنتر');
    expect(buttons(v.kb).some((b) => b.data.startsWith('ln:'))).toBe(false);
    expect((await route('menu', user, restarted))?.view.text).toContain('فوتبال سنتر');
  });
  it('a bogus language code is rejected', async () => {
    const { deps } = setup();
    await fresh(deps);
    expect(await pick(deps, 1, 'ln:de')).toBeNull();
  });
});

describe('main menu', () => {
  it('matches the spec in both languages and keeps identical navigation', async () => {
    const { deps } = setup();
    const u = await fresh(deps);
    const fa = buttons((await route('ln:fa', u, deps))!.view.kb);
    const en = buttons((await route('ln:en', { ...u, langSelected: false }, deps))!.view.kb);
    expect(fa.map((b) => b.data)).toEqual(en.map((b) => b.data));
    expect(fa.map((b) => b.text)).toEqual([
      '🇮🇷 فوتبال ایران', '🌍 فوتبال جهان', '🔴 مسابقات زنده', '📅 بازی‌های امروز', '⏭ بازی‌های فردا', '📆 تقویم مسابقات', '⭐ تیم‌های محبوب', '🔔 اعلان‌ها', '⚙️ تنظیمات',
    ]);
    expect(en.map((b) => b.text)).toEqual([
      '🇮🇷 Iranian Football', '🌍 World Football', '🔴 Live Matches', "📅 Today's Matches", "⏭ Tomorrow's Matches", '📆 Match Calendar', '⭐ Favorite Teams', '🔔 Notifications', '⚙️ Settings',
    ]);
  });
});

describe('language switching keeps everything else', () => {
  it('favorites, timezone, display and notification preferences survive fa → en → fa', async () => {
    const { deps, repo } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:fa');
    await repo.addFavorite(1, { key: 'tc:esteghlal', name: 'Esteghlal' });
    await pick(deps, 1, 'st:z:7'); // Berlin
    await pick(deps, 1, 'st:v:t');
    await repo.setNotif(1, 'daily', true);
    await repo.setNotifCompetition(1, 'PL', true);
    await repo.setMatchReminder(1, 'fd:1', true);

    const toEn = await pick(deps, 1, 'st:l:en');
    expect(toEn?.user.lang).toBe('en');
    expect(toEn?.view.text).toContain('Settings');
    let u = (await repo.getUser(1))!;
    expect(u).toMatchObject({ lang: 'en', timezone: 'Europe/Berlin', defaultView: 'by_time', langSelected: true });
    expect(u.notif.daily).toBe(true);
    expect(await repo.listFavorites(1)).toEqual([{ key: 'tc:esteghlal', name: 'Esteghlal' }]);
    expect(await repo.listNotifCompetitions(1)).toEqual(['PL']);
    expect(await repo.hasMatchReminder(1, 'fd:1')).toBe(true);

    const back = await pick(deps, 1, 'st:l:fa');
    expect(back?.view.text).toContain('تنظیمات');
    u = (await repo.getUser(1))!;
    expect(u).toMatchObject({ lang: 'fa', timezone: 'Europe/Berlin' });
    expect(await repo.listFavorites(1)).toHaveLength(1);
  });
  it('the interface updates immediately and favorites are displayed in the new language', async () => {
    const { deps, repo } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:fa');
    await repo.addFavorite(1, { key: 'tc:esteghlal', name: 'Esteghlal' });
    expect((await pick(deps, 1, 'fv:m'))?.view.kb.inline_keyboard.flat().map((b) => b.text)).toContain('🗑 استقلال');
    await pick(deps, 1, 'st:l:en');
    expect((await pick(deps, 1, 'fv:m'))?.view.kb.inline_keyboard.flat().map((b) => b.text)).toContain('🗑 Esteghlal');
  });
  it('language and timezone are independent in both directions', async () => {
    const { deps, repo } = setup();
    await fresh(deps, 1);
    await pick(deps, 1, 'ln:fa');
    await pick(deps, 1, 'st:z:7'); // Persian speaker living in Berlin
    expect((await repo.getUser(1))).toMatchObject({ lang: 'fa', timezone: 'Europe/Berlin' });
    await fresh(deps, 2);
    await pick(deps, 2, 'ln:en');
    await pick(deps, 2, 'st:z:0'); // English speaker in Tehran
    expect((await repo.getUser(2))).toMatchObject({ lang: 'en', timezone: 'Asia/Tehran' });
  });
  it('typed IANA timezone is validated', async () => {
    const { deps, repo } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:en');
    await pick(deps, 1, 'st:z:o');
    const bad = await handleText('Mars/Base', (await repo.getUser(1))!, deps);
    expect(bad?.view.text).toContain('not valid');
    await pick(deps, 1, 'st:z:o');
    await handleText('Asia/Kolkata', (await repo.getUser(1))!, deps);
    expect((await repo.getUser(1))?.timezone).toBe('Asia/Kolkata');
  });
});

describe('Iranian football section', () => {
  it('shows only verified competitions and explains when no Iranian source is configured', async () => {
    const { deps } = setup({ iran: false });
    await fresh(deps);
    await pick(deps, 1, 'ln:fa');
    const r = await pick(deps, 1, 'ir');
    expect(buttons(r!.view.kb).filter((b) => b.data.startsWith('lg:x:'))).toEqual([]);
    expect(r!.view.text).toContain('فعال نشده');
  });
  it('lists real competitions of the Iranian provider with localized names', async () => {
    const { deps } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:fa');
    const fa = buttons((await pick(deps, 1, 'ir'))!.view.kb);
    expect(fa.map((b) => b.text)).toEqual(expect.arrayContaining(['🏆 لیگ برتر خلیج فارس', '🏆 لیگ آزادگان', '📊 جدول لیگ‌ها']));
    expect(fa.find((b) => b.data === 'lg:x:IR1:u:0')).toBeTruthy();
    // no AFC / national team buttons because nothing verified provides them
    expect(fa.find((b) => b.data === 'ir:a')).toBeUndefined();
    await pick(deps, 1, 'st:l:en');
    const en = buttons((await pick(deps, 1, 'ir'))!.view.kb);
    expect(en.map((b) => b.text)).toEqual(expect.arrayContaining(['🏆 Persian Gulf Pro League', '🏆 Azadegan League', '📊 League Standings']));
  });
  it('competition tabs render today/upcoming with localized team names, Jalali date and verified venue', async () => {
    const { deps } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:fa');
    const today = (await pick(deps, 1, 'lg:x:IR1:t:0'))!.view.text;
    expect(today).toContain('سپاهان');
    expect(today).toContain('تراکتور');
    const detail = (await pick(deps, 1, 'm:va:10'))!.view.text;
    expect(detail).toContain('🏆 <b>لیگ برتر خلیج فارس</b>');
    expect(detail).toContain('استقلال × پرسپولیس');
    expect(detail).toContain('📅 جمعه، ۱۵ آبان ۱۴۰۵');
    expect(detail).toContain('🕒 ساعت ۱۸:۰۰');
    expect(detail).toContain('📍 Azadi Stadium');
  });
  it('English match formatting', async () => {
    const { deps, repo } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:en');
    await repo.updateUser(1, { timezone: 'Asia/Tehran' });
    const detail = (await pick(deps, 1, 'm:va:10'))!.view.text;
    expect(detail).toContain('🏆 <b>Persian Gulf Pro League</b>');
    expect(detail).toContain('Esteghlal vs Persepolis');
    expect(detail).toContain('📅 Friday, November 6, 2026');
    expect(detail).toContain('🕒 18:00');
    expect(detail).toContain('📍 Azadi Stadium');
  });
  it('never shows a venue that the provider did not supply', async () => {
    const { deps } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:en');
    expect((await pick(deps, 1, 'm:va:11'))!.view.text).not.toContain('📍');
  });
  it('standings are shown only for competitions whose provider supports them', async () => {
    const { deps } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:en');
    const ok = await pick(deps, 1, 'lg:t:IR1');
    expect(ok!.view.text).toContain('Persepolis');
    expect(ok!.view.text).toContain('23');
    expect(await pick(deps, 1, 'lg:t:IR2')).toBeNull();
    expect(await pick(deps, 1, 'lg:t:PL')).toBeNull(); // FakeProvider has no standings
  });
  it('unsupported competitions are rejected, not faked', async () => {
    const { deps } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:en');
    expect(await pick(deps, 1, 'lg:x:AFCE:u:0')).toBeNull();
    expect(await pick(deps, 1, 'lg:x:IR1:z:0')).toBeNull();
  });
});

describe('team search and favorites', () => {
  it('Persian and English queries resolve to the same provider-independent key', async () => {
    const { deps, fixtures } = setup();
    expect((await fixtures.searchTeams('استقلال')).data.map((x) => x.key)).toEqual(['tc:esteghlal']);
    expect((await fixtures.searchTeams('Esteghlal')).data.map((x) => x.key)).toEqual(['tc:esteghlal']);
    await fresh(deps);
    await pick(deps, 1, 'ln:fa');
    await pick(deps, 1, 'fv:s');
    const res = await handleText('پرسپولیس', (await deps.repo.getUser(1))!, deps);
    expect(buttons(res!.view.kb).map((b) => b.text)).toContain('➕ پرسپولیس');
  });
  it('adding a catalog team stores its key and finds its fixtures regardless of provider id', async () => {
    const { deps, repo } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:en');
    await pick(deps, 1, 'fv:a:tc:persepolis');
    expect(await repo.listFavorites(1)).toEqual([{ key: 'tc:persepolis', name: 'Persepolis' }]);
    const view = (await pick(deps, 1, 'fv:0'))!.view;
    expect(view.text).toContain('Esteghlal vs Persepolis');
    await pick(deps, 1, 'fv:r:tc:persepolis');
    expect(await repo.listFavorites(1)).toEqual([]);
  });
  it('rejects malformed team keys', async () => {
    const { deps } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:en');
    expect(await pick(deps, 1, 'fv:a:evil')).toBeNull();
    expect(await pick(deps, 1, 'fv:r:fd:abc')).toBeNull();
  });
});

describe('per-match reminder button', () => {
  it('is idempotent and offered only for upcoming matches', async () => {
    const { deps, repo } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:en');
    expect(buttons((await pick(deps, 1, 'm:fd:1'))!.view.kb).some((b) => b.data === 'rm:fd:1:1')).toBe(true);
    await pick(deps, 1, 'rm:fd:1:1');
    await pick(deps, 1, 'rm:fd:1:1'); // stale double press
    expect(await repo.hasMatchReminder(1, 'fd:1')).toBe(true);
    await pick(deps, 1, 'rm:fd:1:0');
    expect(await repo.hasMatchReminder(1, 'fd:1')).toBe(false);
  });
  it('refuses to set a reminder for a match that already started', async () => {
    const { deps, repo, fixtures } = setup();
    void fixtures;
    await fresh(deps);
    await pick(deps, 1, 'ln:en');
    const r = await pick(deps, 1, 'rm:va:11:1'); // kickoff 12:30Z, now 12:00Z -> still upcoming
    expect(await repo.hasMatchReminder(1, 'va:11')).toBe(true);
    expect(r).not.toBeNull();
  });
});

describe('callback navigation crawl (both languages)', () => {
  for (const lang of ['fa', 'en'] as const) {
    it(`every reachable button works and stays within Telegram limits — ${lang}`, async () => {
      const { deps } = setup();
      await fresh(deps);
      await pick(deps, 1, `ln:${lang}`);
      const seen = new Set<string>();
      let frontier = ['menu'];
      for (let depth = 0; depth < 4 && frontier.length; depth++) {
        const next: string[] = [];
        for (const data of frontier) {
          if (seen.has(data) || seen.size > 250) continue;
          seen.add(data);
          // skip destructive/mutating leaves to keep the crawl deterministic
          if (/^(rm|fv:r|fv:a|nt:t|nt:c:[A-Z0-9]+|st:l|st:z:\d|st:v:[gt])/.test(data)) continue;
          const r = await pick(deps, 1, data);
          expect(r, `callback ${data}`).not.toBeNull();
          const { text, kb } = r!.view;
          expect(text.length, data).toBeLessThanOrEqual(4096);
          expect(text, data).not.toMatch(/undefined|NaN|\[object/);
          for (const b of buttons(kb)) {
            expect(Buffer.byteLength(b.data), b.data).toBeLessThanOrEqual(64);
            expect(b.text.length).toBeGreaterThan(0);
            next.push(b.data);
          }
          if (lang === 'fa') expect(/[\u0600-\u06FF]/.test(text), `fa text for ${data}`).toBe(true);
        }
        frontier = next;
      }
      expect(seen.size).toBeGreaterThan(20);
    });
  }

  it('unknown or malformed callbacks return null (handler shows "expired")', async () => {
    const { deps } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:en');
    for (const bad of ['', 'zzz', 'd:not-a-date:0:m', 'nt:t:daily:2', 'nt:t:bogus:1', 'st:z:99', 'lg:c:nonsense', 'm:fd', 'rm:fd:1:7']) {
      expect(await pick(deps, 1, bad), bad).toBeNull();
    }
  });
  it('out-of-range pages are clamped', async () => {
    const { deps } = setup();
    await fresh(deps);
    await pick(deps, 1, 'ln:en');
    expect(await pick(deps, 1, 'd:2026-11-06:99:m')).not.toBeNull();
  });
  it('help text exists in both languages', () => {
    expect(t('fa').help).toContain('راهنما');
    expect(t('en').help).toContain('Help');
  });
});
