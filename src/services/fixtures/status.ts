import { LIVE_STATUSES, type Fixture, type FixtureStatus } from '../../types/fixture.js';

const MIN = 60_000;
/** A match flagged live more than this long before kickoff is bad data. */
const LIVE_EARLY_TOLERANCE = 10 * MIN;
/** Longest plausible match incl. extra time, penalties and stoppages. */
const MAX_MATCH_DURATION = 4 * 60 * MIN;
/** A "scheduled" match this long past kickoff has no trustworthy status. */
const SCHEDULED_GRACE = 3 * 60 * MIN;

/**
 * Sanity-checks the provider status against the clock so the UI never shows an
 * upcoming/completed match as live (and never a long-past "scheduled" match as upcoming).
 */
export function effectiveStatus(f: Pick<Fixture, 'status' | 'kickoffUtc'>, now: number): FixtureStatus {
  const k = f.kickoffUtc ? Date.parse(f.kickoffUtc) : null;
  if (LIVE_STATUSES.includes(f.status)) {
    if (k == null) return 'unknown';
    if (k - now > LIVE_EARLY_TOLERANCE) return 'unknown';
    if (now - k > MAX_MATCH_DURATION) return 'unknown';
    return f.status;
  }
  if (f.status === 'scheduled') {
    if (k == null) return 'unknown';
    if (now - k > SCHEDULED_GRACE) return 'unknown';
  }
  return f.status;
}

export function isLiveNow(f: Fixture, now: number): boolean {
  return LIVE_STATUSES.includes(effectiveStatus(f, now));
}

export type Section = 'live' | 'upcoming' | 'finished' | 'other';

export function sectionOf(f: Fixture, now: number): Section {
  const s = effectiveStatus(f, now);
  if (s === 'live' || s === 'paused') return 'live';
  if (s === 'scheduled') return 'upcoming';
  if (s === 'finished') return 'finished';
  return 'other';
}
