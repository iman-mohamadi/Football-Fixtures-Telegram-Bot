import { en } from './locales/en.js';
import { fa } from './locales/fa.js';

export type Lang = 'fa' | 'en';
export const SUPPORTED_LANGS: Lang[] = ['fa', 'en'];
export type Messages = typeof fa;

const locales: Record<Lang, Messages> = { fa, en };

/** Single entry point for every user-facing string: `t(lang).menuTitle`. */
export function t(lang: Lang): Messages {
  return locales[lang] ?? locales.en;
}
/** Back-compat alias used across the bot code. */
export const m = t;
export const messages = locales;

export function isLang(v: unknown): v is Lang {
  return v === 'fa' || v === 'en';
}

/** Bilingual picker shown before a language is known (first /start). Intentionally NOT per-language. */
export const LANGUAGE_PICKER_TEXT =
  '⚽ Welcome to Football Center\nPlease select your language:\n\n' +
  '⚽ به فوتبال سنتر خوش آمدید!\nلطفاً زبان موردنظر خود را انتخاب کنید:';
export const LANGUAGE_BUTTONS: { lang: Lang; label: string }[] = [
  { lang: 'fa', label: '🇮🇷 فارسی' },
  { lang: 'en', label: '🇬🇧 English' },
];

/** Initial timezone suggested by language. Only applied at first selection; never tied afterwards. */
export const DEFAULT_TIMEZONE_BY_LANG: Record<Lang, string> = { fa: 'Asia/Tehran', en: 'UTC' };

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const FA_DIGIT_RE = /[0-9]/g;

/** Latin digits → Persian digits when lang is fa; identity for en. Do not run on team names or IDs. */
export function digits(lang: Lang, s: string | number): string {
  const str = String(s);
  return lang === 'fa' ? str.replace(FA_DIGIT_RE, (d) => FA_DIGITS[+d]) : str;
}

/** Normalizes Persian/Arabic variants for search: ي→ی, ك→ک, strips ZWNJ/diacritics, Persian/Arabic digits → Latin. */
export function normalizePersian(s: string): string {
  return s
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/[آأإ]/g, 'ا')
    .replace(/[ً-ٰٟ‌‍‏‎]/g, '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, ' ')
    .trim();
}
