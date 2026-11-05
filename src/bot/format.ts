import type { Fixture } from '../types/fixture.js';
import type { User } from '../database/repositories/types.js';
import { digits, m, type Lang } from '../i18n/index.js';
import { competitionDisplayName } from '../services/football/competitions.js';
import { effectiveStatus, sectionOf, type Section } from '../services/fixtures/status.js';
import { localizeTeamName } from '../services/teams/catalog.js';
import { formatTime } from '../utils/time.js';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const RLM = '‏';
const LRI = '⁦';
const PDI = '⁩';

/** Wraps a mixed-script string so score/separator ordering survives RTL paragraphs. */
export function isolate(text: string): string {
  return `${LRI}${text}${PDI}`;
}

export function rtlLine(lang: Lang, line: string): string {
  return lang === 'fa' ? RLM + line : line;
}

/** Local-digit time, e.g. "۱۸:۳۰" for Persian, "18:30" for English. */
export function timeText(ms: number, tz: string, lang: Lang): string {
  return digits(lang, formatTime(ms, tz));
}

export function scoreText(f: Fixture, lang: Lang = 'en'): string | null {
  return f.homeScore != null && f.awayScore != null ? digits(lang, `${f.homeScore} - ${f.awayScore}`) : null;
}

function showScore(f: Fixture, now: number): boolean {
  const s = effectiveStatus(f, now);
  return s === 'live' || s === 'paused' || s === 'finished';
}

export function teamLabel(name: string, lang: Lang): string {
  return localizeTeamName(name, lang);
}

export function matchupText(f: Fixture, lang: Lang, withScore: boolean, now: number): string {
  const sc = withScore && showScore(f, now) ? scoreText(f, lang) : null;
  const mid = sc ?? m(lang).vsSep;
  return isolate(`${esc(teamLabel(f.homeTeam, lang))} ${mid} ${esc(teamLabel(f.awayTeam, lang))}`);
}

export const SECTION_ORDER: Section[] = ['live', 'upcoming', 'other', 'finished'];

/** Sort: sections (live, upcoming, other, finished) → competition → kickoff. */
export function sortForGroupedView(list: Fixture[], now: number): Fixture[] {
  const rank = (f: Fixture) => SECTION_ORDER.indexOf(sectionOf(f, now));
  return [...list].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.competitionName.localeCompare(b.competitionName) ||
      (a.kickoffUtc ? Date.parse(a.kickoffUtc) : 0) - (b.kickoffUtc ? Date.parse(b.kickoffUtc) : 0),
  );
}

export function sectionHeader(sec: Section, lang: Lang): string {
  const t = m(lang);
  return { live: t.secLive, upcoming: t.secUpcoming, finished: t.secFinished, other: t.secOther }[sec];
}

/** Second line of a fixture entry (time / minute / status). */
export function fixtureMeta(f: Fixture, user: Pick<User, 'lang' | 'timezone'>, now: number): string {
  const t = m(user.lang);
  const status = effectiveStatus(f, now);
  const time = f.kickoffUtc ? timeText(Date.parse(f.kickoffUtc), user.timezone, user.lang) : null;
  switch (status) {
    case 'live':
      return f.minute != null ? `🔴 ${t.liveMin(digits(user.lang, f.minute))}` : `🔴 ${t.statusLabel.live}`;
    case 'paused':
      return `🔴 ${t.statusLabel.paused}`;
    case 'scheduled':
      return `🕒 ${time ?? t.noKickoff}`;
    case 'finished':
      return `✅ ${t.statusLabel.finished}`;
    default:
      return `⚠️ ${t.statusLabel[status]}${time ? ` · 🕒 ${time}` : ''}`;
  }
}

export function compName(f: Fixture, lang: Lang): string {
  return competitionDisplayName(f.competitionCode, f.competitionName, lang);
}

export function fixtureEntry(f: Fixture, user: Pick<User, 'lang' | 'timezone'>, now: number, opts: { showComp?: boolean } = {}): string {
  const lines = [`🔹 ${matchupText(f, user.lang, true, now)}`, fixtureMeta(f, user, now)];
  if (opts.showComp) lines.push(`🏆 ${esc(compName(f, user.lang))}`);
  return lines.map((l) => rtlLine(user.lang, l)).join('\n');
}

export function compHeader(f: Fixture, lang: Lang): string {
  return rtlLine(lang, `🏆 <b>${esc(compName(f, lang))}</b>`);
}

export function buttonLabel(f: Fixture, lang: Lang, max = 38): string {
  const s = `${teamLabel(f.homeTeam, lang)} – ${teamLabel(f.awayTeam, lang)}`;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Renders a page of fixtures. When `grouped`, emits section + competition headers whenever they change;
 * otherwise a flat list (each entry shows its competition).
 */
export function renderFixturePage(items: Fixture[], user: Pick<User, 'lang' | 'timezone'>, now: number, grouped: boolean): string {
  const out: string[] = [];
  let lastSec: Section | null = null;
  let lastComp: string | null = null;
  for (const f of items) {
    if (grouped) {
      const sec = sectionOf(f, now);
      if (sec !== lastSec) {
        out.push('', rtlLine(user.lang, sectionHeader(sec, user.lang)));
        lastSec = sec;
        lastComp = null;
      }
      if (f.competitionCode !== lastComp) {
        out.push(compHeader(f, user.lang));
        lastComp = f.competitionCode;
      }
      out.push(fixtureEntry(f, user, now));
    } else {
      out.push(fixtureEntry(f, user, now, { showComp: true }));
    }
  }
  return out.join('\n').replace(/^\n/, '');
}

export function estimateSize(f: Fixture): number {
  return 90 + f.homeTeam.length + f.awayTeam.length + f.competitionName.length / 2;
}
