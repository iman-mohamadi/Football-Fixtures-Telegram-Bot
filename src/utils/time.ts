/**
 * Timezone helpers built on Intl only (no dependencies).
 * All kickoffs are stored as UTC; conversion happens only at display time.
 */

import type { Lang } from '../i18n/index.js';
export type { Lang };

export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function getZonedParts(ms: number, tz: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** Offset (zone local time minus UTC) in ms at the given instant. */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = getZonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Converts a wall-clock time in `tz` to a UTC epoch (handles DST via re-check). */
export function zonedTimeToUtcMs(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = tzOffsetMs(guess, tz);
  let res = guess - off;
  const off2 = tzOffsetMs(res, tz);
  if (off2 !== off) res = guess - off2;
  return res;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateString(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function utcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function localDateString(ms: number, tz: string): string {
  const p = getZonedParts(ms, tz);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addDays(dateStr: string, n: number): string {
  const m = DATE_RE.exec(dateStr);
  if (!m) throw new Error(`Bad date: ${dateStr}`);
  return utcDateString(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
}

/** [startMs, endMs) of a local calendar day. Correct for 23h/25h DST days. */
export function dayRangeUtc(dateStr: string, tz: string): { startMs: number; endMs: number } {
  const m = DATE_RE.exec(dateStr);
  if (!m) throw new Error(`Bad date: ${dateStr}`);
  const startMs = zonedTimeToUtcMs(+m[1], +m[2], +m[3], 0, 0, tz);
  const next = addDays(dateStr, 1);
  const n = DATE_RE.exec(next)!;
  const endMs = zonedTimeToUtcMs(+n[1], +n[2], +n[3], 0, 0, tz);
  return { startMs, endMs };
}

/** UTC calendar dates touched by [startMs, endMs). */
export function utcDatesCovering(startMs: number, endMs: number): string[] {
  const out: string[] = [];
  let d = utcDateString(startMs);
  const last = utcDateString(endMs - 1);
  while (d <= last) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export function formatTime(ms: number, tz: string): string {
  const p = getZonedParts(ms, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function labelLocale(lang: Lang): string {
  return lang === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US';
}

/** Label for a calendar date, e.g. "شنبه ۱۵ آبان" / "Sat 7 November". Date is zone-independent. */
export function formatDateLabel(dateStr: string, lang: Lang): string {
  const m = DATE_RE.exec(dateStr);
  if (!m) return dateStr;
  const noon = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return new Intl.DateTimeFormat(labelLocale(lang), {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(noon);
}

/** Label for the local date of an instant. */
export function formatLocalDateLabel(ms: number, tz: string, lang: Lang): string {
  return formatDateLabel(localDateString(ms, tz), lang);
}

/** "GMT+3:30"-style offset for display. */
export function formatOffset(ms: number, tz: string): string {
  const off = Math.round(tzOffsetMs(ms, tz) / 60000);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  const h = Math.floor(a / 60);
  const mm = a % 60;
  return `UTC${sign}${h}${mm ? ':' + String(mm).padStart(2, '0') : ''}`;
}

/** Full date incl. year: "جمعه، ۱۵ آبان ۱۴۰۵" / "Friday, November 6, 2026". Calendar conversion never touches the instant. */
export function formatFullDate(dateStr: string, lang: Lang): string {
  const m = DATE_RE.exec(dateStr);
  if (!m) return dateStr;
  const noon = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  if (lang === 'en') {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(noon);
  }
  const parts = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).formatToParts(noon);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('weekday')}، ${g('day')} ${g('month')} ${g('year')}`;
}

export function formatFullLocalDate(ms: number, tz: string, lang: Lang): string {
  return formatFullDate(localDateString(ms, tz), lang);
}
