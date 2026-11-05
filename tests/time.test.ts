import { describe, expect, it } from 'vitest';
import {
  addDays, dayRangeUtc, formatDateLabel, formatTime, isDateString, isValidTimeZone, localDateString, utcDatesCovering,
} from '../src/utils/time.js';

const ms = (iso: string) => Date.parse(iso);

describe('timezone conversion', () => {
  it('converts UTC to Tehran (+3:30, no DST since 2022)', () => {
    expect(formatTime(ms('2026-11-07T15:00:00Z'), 'Asia/Tehran')).toBe('18:30');
    expect(formatTime(ms('2026-07-07T15:00:00Z'), 'Asia/Tehran')).toBe('18:30');
  });
  it('converts to Berlin with DST (summer +2, winter +1)', () => {
    expect(formatTime(ms('2026-07-01T18:30:00Z'), 'Europe/Berlin')).toBe('20:30');
    expect(formatTime(ms('2026-12-01T18:30:00Z'), 'Europe/Berlin')).toBe('19:30');
  });
  it('local date crosses midnight differently per timezone', () => {
    const t = ms('2026-11-07T22:30:00Z');
    expect(localDateString(t, 'UTC')).toBe('2026-11-07');
    expect(localDateString(t, 'Asia/Tehran')).toBe('2026-11-08'); // 02:00 next day
    expect(localDateString(t, 'America/New_York')).toBe('2026-11-07');
  });
  it('validates timezones', () => {
    expect(isValidTimeZone('Asia/Tehran')).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('date boundaries', () => {
  it('Tehran day is [prev 20:30Z, 20:30Z)', () => {
    const r = dayRangeUtc('2026-11-08', 'Asia/Tehran');
    expect(new Date(r.startMs).toISOString()).toBe('2026-11-07T20:30:00.000Z');
    expect(new Date(r.endMs).toISOString()).toBe('2026-11-08T20:30:00.000Z');
  });
  it('a 23:59 local kickoff belongs to the day, 00:00 next day does not', () => {
    const r = dayRangeUtc('2026-11-08', 'Asia/Tehran');
    expect(ms('2026-11-08T20:29:59Z')).toBeLessThan(r.endMs);
    expect(ms('2026-11-08T20:30:00Z')).toBeGreaterThanOrEqual(r.endMs);
  });
  it('handles DST spring-forward day (23h) in Berlin: 2026-03-29', () => {
    const r = dayRangeUtc('2026-03-29', 'Europe/Berlin');
    expect((r.endMs - r.startMs) / 3600_000).toBe(23);
  });
  it('handles DST fall-back day (25h) in Berlin: 2026-10-25', () => {
    const r = dayRangeUtc('2026-10-25', 'Europe/Berlin');
    expect((r.endMs - r.startMs) / 3600_000).toBe(25);
  });
  it('US spring-forward 2026-03-08 is 23h in New York', () => {
    const r = dayRangeUtc('2026-03-08', 'America/New_York');
    expect((r.endMs - r.startMs) / 3600_000).toBe(23);
  });
  it('UTC dates covering a Tehran day span two UTC dates', () => {
    const r = dayRangeUtc('2026-11-08', 'Asia/Tehran');
    expect(utcDatesCovering(r.startMs, r.endMs)).toEqual(['2026-11-07', '2026-11-08']);
  });
  it('addDays crosses month/year', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('isDateString rejects impossible dates', () => {
    expect(isDateString('2026-02-30')).toBe(false);
    expect(isDateString('2026-11-07')).toBe(true);
    expect(isDateString('x')).toBe(false);
  });
});

describe('labels', () => {
  it('Persian label uses Jalali calendar', () => {
    const l = formatDateLabel('2026-11-07', 'fa');
    expect(l).toContain('آبان'); // 16 Aban 1405
  });
  it('English label has weekday', () => {
    expect(formatDateLabel('2026-11-07', 'en')).toMatch(/Saturday/);
  });
});
