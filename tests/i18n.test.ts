import { describe, expect, it } from 'vitest';
import { LANGUAGE_PICKER_TEXT, SUPPORTED_LANGS, digits, normalizePersian, t } from '../src/i18n/index.js';
import { en } from '../src/i18n/locales/en.js';
import { fa } from '../src/i18n/locales/fa.js';
import { competitionDisplayName } from '../src/services/football/competitions.js';
import {
  AMBIGUOUS_ALIASES, TEAM_CATALOG, displayNameForKey, localizeTeamName, lookupTeam, teamMatchesQuery,
} from '../src/services/teams/catalog.js';
import { formatDateLabel, formatFullDate, formatFullLocalDate, formatTime, localDateString } from '../src/utils/time.js';

type Leaf = string | ((...a: string[]) => string);
function flatten(o: Record<string, unknown>, prefix = ''): Record<string, Leaf> {
  const out: Record<string, Leaf> = {};
  for (const [k, v] of Object.entries(o)) {
    const key = prefix + k;
    if (typeof v === 'string' || typeof v === 'function') out[key] = v as Leaf;
    else if (v && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, key + '.'));
  }
  return out;
}
const render = (v: Leaf): string => (typeof v === 'string' ? v : v('XQ1', 'XQ2', 'XQ3'));
const PERSIAN = /[؀-ۿ]/;
const FLAT = { fa: flatten(fa), en: flatten(en) };

describe('translation completeness', () => {
  it('both locales are registered', () => {
    expect(SUPPORTED_LANGS).toEqual(['fa', 'en']);
    expect(t('fa')).toBe(fa);
    expect(t('en')).toBe(en);
  });
  it('Persian and English define exactly the same keys', () => {
    expect(Object.keys(FLAT.en).sort()).toEqual(Object.keys(FLAT.fa).sort());
  });
  it('same leaf kind and placeholder arity per key', () => {
    for (const [k, v] of Object.entries(FLAT.fa)) {
      const e = FLAT.en[k];
      expect(typeof e, k).toBe(typeof v);
      if (typeof v === 'function') expect((e as () => string).length, k).toBe(v.length);
    }
  });
  it('every placeholder is used by both translations', () => {
    for (const lang of ['fa', 'en'] as const) {
      for (const [k, v] of Object.entries(FLAT[lang])) {
        if (typeof v !== 'function') continue;
        const out = render(v);
        for (let i = 1; i <= v.length; i++) expect(out, `${lang}.${k}`).toContain(`XQ${i}`);
      }
    }
  });
  it('no empty strings', () => {
    for (const lang of ['fa', 'en'] as const) for (const [k, v] of Object.entries(FLAT[lang])) expect(render(v).trim().length, `${lang}.${k}`).toBeGreaterThan(0);
  });
  it('Persian locale is actually Persian (letters present) except symbol-only keys', () => {
    const symbolOnly = new Set(['vsSep', 'liveMin', 'fComp', 'fTeams', 'fDate', 'fVenue', 'leaguesCat', 'leagueTitle']);
    for (const [k, v] of Object.entries(FLAT.fa)) if (!symbolOnly.has(k)) expect(PERSIAN.test(render(v)), `fa.${k}`).toBe(true);
  });
  it('English locale contains no Persian script', () => {
    // favSearchPrompt intentionally shows one Persian example so English users know Persian names work.
    for (const [k, v] of Object.entries(FLAT.en)) if (k !== 'favSearchPrompt') expect(PERSIAN.test(render(v)), `en.${k}`).toBe(false);
  });
  it('Persian locale has no leftover English sentences in user-facing prose', () => {
    // Allow brand/format examples (Asia/Tehran, Europe/Berlin, Barcelona, Bundesliga) but not whole English words like "Today".
    for (const [k, v] of Object.entries(FLAT.fa)) {
      const stripped = render(v).replace(/<[^>]+>/g, '').replace(/Asia\/Tehran|Europe\/Berlin|Barcelona|Bundesliga|Arsenal|XQ\d|vs/g, '');
      expect(/\b(Today|Tomorrow|Settings|Back|Refresh|Loading|Error)\b/.test(stripped), `fa.${k}`).toBe(false);
    }
  });
  it('spec menu labels are present', () => {
    expect(fa.btn.iran).toBe('🇮🇷 فوتبال ایران');
    expect(fa.btn.world).toBe('🌍 فوتبال جهان');
    expect(en.btn.calendar).toBe('📆 Match Calendar');
    expect(en.btn.live).toBe('🔴 Live Matches');
    expect(fa.setLang).toBe('🌐 تغییر زبان');
    expect(en.setView).toBe('📅 Match Display Preferences');
  });
  it('language picker shows both required greetings', () => {
    expect(LANGUAGE_PICKER_TEXT).toContain('Welcome to Football Center');
    expect(LANGUAGE_PICKER_TEXT).toContain('به فوتبال سنتر خوش آمدید');
  });
});

describe('numerals', () => {
  it('Persian digits for fa, Latin for en', () => {
    expect(digits('fa', '18:30')).toBe('۱۸:۳۰');
    expect(digits('en', '18:30')).toBe('18:30');
    expect(digits('fa', 12)).toBe('۱۲');
  });
  it('normalizePersian unifies Arabic variants and digits', () => {
    expect(normalizePersian('استقلالي')).toBe(normalizePersian('استقلالی'));
    expect(normalizePersian('كاشان')).toBe('کاشان');
    expect(normalizePersian('۱۲٣')).toBe('123');
    expect(normalizePersian('گل‌گهر')).toBe(normalizePersian('گلگهر'));
  });
});

describe('Jalali / Gregorian formatting', () => {
  it('2026-11-06 is Friday 15 Aban 1405', () => {
    expect(formatFullDate('2026-11-06', 'fa')).toBe('جمعه، ۱۵ آبان ۱۴۰۵');
  });
  it('Nowruz 2026-03-21 is 1 Farvardin 1405', () => {
    expect(formatFullDate('2026-03-21', 'fa')).toContain('۱ فروردین ۱۴۰۵');
  });
  it('year boundary: 2026-03-20 is the last day of Esfand 1404', () => {
    expect(formatFullDate('2026-03-20', 'fa')).toContain('اسفند ۱۴۰۴');
  });
  it('English uses Gregorian with English numerals', () => {
    expect(formatFullDate('2026-11-06', 'en')).toBe('Friday, November 6, 2026');
    expect(formatDateLabel('2026-11-06', 'en')).toMatch(/Friday/);
    expect(/[۰-۹]/.test(formatFullDate('2026-11-06', 'en'))).toBe(false);
  });
  it('a late-evening UTC kickoff lands on the next Jalali day in Tehran (midnight crossing)', () => {
    const ms = Date.parse('2026-11-06T21:00:00Z'); // 00:30 on 7 Nov in Tehran
    expect(localDateString(ms, 'Asia/Tehran')).toBe('2026-11-07');
    expect(formatFullLocalDate(ms, 'Asia/Tehran', 'fa')).toBe('شنبه، ۱۶ آبان ۱۴۰۵');
    expect(formatFullLocalDate(ms, 'UTC', 'fa')).toBe('جمعه، ۱۵ آبان ۱۴۰۵');
  });
  it('calendar choice never changes the instant: same time string in both languages (modulo digits)', () => {
    const ms = Date.parse('2026-11-06T14:30:00Z');
    expect(formatTime(ms, 'Asia/Tehran')).toBe('18:00');
    expect(digits('fa', formatTime(ms, 'Asia/Tehran'))).toBe('۱۸:۰۰');
  });
  it('language is independent of timezone: Persian user in Berlin, English user in Tehran', () => {
    const ms = Date.parse('2026-07-01T18:30:00Z');
    expect(digits('fa', formatTime(ms, 'Europe/Berlin'))).toBe('۲۰:۳۰');
    expect(formatTime(ms, 'Asia/Tehran')).toBe('22:00');
  });
});

describe('competition name localization', () => {
  it('Iranian competitions have fa and en names', () => {
    expect(competitionDisplayName('IR1', 'x', 'fa')).toBe('لیگ برتر خلیج فارس');
    expect(competitionDisplayName('IR1', 'x', 'en')).toBe('Persian Gulf Pro League');
    expect(competitionDisplayName('IR2', 'x', 'fa')).toBe('لیگ آزادگان');
    expect(competitionDisplayName('IRC', 'x', 'en')).toBe('Hazfi Cup');
    expect(competitionDisplayName('IRS', 'x', 'fa')).toBe('سوپرجام');
  });
  it('unknown codes fall back to the provider name', () => {
    expect(competitionDisplayName('ZZZ', 'Some Cup', 'fa')).toBe('Some Cup');
  });
});

describe('team localization', () => {
  it('maps provider spellings by exact normalized equality', () => {
    expect(lookupTeam('Esteghlal FC')?.id).toBe('esteghlal');
    expect(lookupTeam('Persepolis F.C.')?.id).toBe('persepolis');
    expect(lookupTeam('Tractor SC')?.id).toBe('tractor');
    expect(lookupTeam('Chadormalou SC')?.id).toBe('chadormalou');
    expect(lookupTeam('Foolad FC')?.id).toBe('foolad');
    expect(lookupTeam('Sepahan SC')?.id).toBe('sepahan');
  });
  it('shows Persian names for fa and English for en', () => {
    expect(localizeTeamName('Esteghlal FC', 'fa')).toBe('استقلال');
    expect(localizeTeamName('Persepolis FC', 'fa')).toBe('پرسپولیس');
    expect(localizeTeamName('Persepolis FC', 'en')).toBe('Persepolis');
    expect(localizeTeamName('Real Madrid CF', 'fa')).toBe('رئال مادرید');
  });
  it('never guesses: unknown and merely similar names stay untouched', () => {
    expect(localizeTeamName('Unknown United', 'fa')).toBe('Unknown United');
    expect(lookupTeam('Esteghlal Something')).toBeNull();
    expect(lookupTeam('Esteghlal Khuzestan')?.id).toBe('esteghlal-khuzestan'); // distinct club, not folded into Esteghlal
  });
  it('shipped catalog has unique ids and no ambiguous aliases', () => {
    expect(new Set(TEAM_CATALOG.map((e) => e.id)).size).toBe(TEAM_CATALOG.length);
    expect([...AMBIGUOUS_ALIASES]).toEqual([]);
  });
  it('searches in either language and with Arabic letter variants', () => {
    expect(teamMatchesQuery('Esteghlal FC', 'استقلال')).toBe(true);
    expect(teamMatchesQuery('Persepolis FC', 'پرسپوليس')).toBe(true); // Arabic yeh
    expect(teamMatchesQuery('Esteghlal FC', 'esteghlal')).toBe(true);
    expect(teamMatchesQuery('Persepolis FC', 'پرسپولیس')).toBe(true);
    expect(teamMatchesQuery('Sepahan SC', 'پرسپولیس')).toBe(false);
    expect(teamMatchesQuery('Sepahan SC', 'zzz')).toBe(false);
    expect(teamMatchesQuery('Sepahan SC', '   ')).toBe(false);
  });
  it('catalog keys render localized for favorites', () => {
    expect(displayNameForKey('tc:tractor', 'Tractor', 'fa')).toBe('تراکتور');
    expect(displayNameForKey('tc:tractor', 'Tractor', 'en')).toBe('Tractor');
    expect(displayNameForKey('fd:99', 'Chelsea FC', 'fa')).toBe('چلسی');
    expect(displayNameForKey('fd:98', 'Nobody FC', 'fa')).toBe('Nobody FC');
  });
});
