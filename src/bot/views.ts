import { InlineKeyboard } from 'grammy';
import type { NotifKind, Repository, User, UserDefaults } from '../database/repositories/types.js';
import { NOTIF_KINDS } from '../database/repositories/types.js';
import {
  DEFAULT_TIMEZONE_BY_LANG, LANGUAGE_BUTTONS, LANGUAGE_PICKER_TEXT, SUPPORTED_LANGS, digits, isLang, m, type Lang,
} from '../i18n/index.js';
import type { FixtureService } from '../services/fixtures/fixtureService.js';
import { sectionOf } from '../services/fixtures/status.js';
import {
  CATEGORY_LABELS, COMPETITION_CATALOG, WORLD_CATEGORIES, competitionDisplayName, competitionMeta, type CompetitionCategory,
} from '../services/football/competitions.js';
import { displayNameForKey, teamById } from '../services/teams/catalog.js';
import type { Fixture, Result, StandingRow } from '../types/fixture.js';
import { log } from '../utils/logger.js';
import { clampPage, clampText, paginate } from '../utils/pagination.js';
import {
  addDays, dayRangeUtc, formatDateLabel, formatFullLocalDate, formatLocalDateLabel, formatOffset, isDateString, isValidTimeZone,
  localDateString, utcDatesCovering,
} from '../utils/time.js';
import {
  buttonLabel, compName, esc, estimateSize, fixtureMeta, isolate, matchupText, renderFixturePage, rtlLine, sortForGroupedView,
  teamLabel, timeText,
} from './format.js';

export interface View {
  text: string;
  kb: InlineKeyboard;
}

export interface Session {
  awaiting?: { kind: 'team' | 'comp' | 'tz'; until: number };
  /** last list view, so match details can go "back" */
  back?: string;
}

export interface Deps {
  repo: Repository;
  fixtures: FixtureService;
  sessions: Map<number, Session>;
  defaults: UserDefaults;
  now: () => number;
}

export interface RouteResult {
  view: View;
  user: User;
  /** true right after the first language selection → bot should install the persistent keyboard */
  onboarded?: boolean;
}

export const TIMEZONES: [string, string][] = [
  ['Asia/Tehran', 'Tehran'], ['Asia/Dubai', 'Dubai'], ['Europe/Istanbul', 'Istanbul'], ['Asia/Baghdad', 'Baghdad'],
  ['Asia/Kabul', 'Kabul'], ['Asia/Baku', 'Baku'], ['Europe/London', 'London'], ['Europe/Berlin', 'Berlin'],
  ['Europe/Paris', 'Paris'], ['Europe/Moscow', 'Moscow'], ['America/New_York', 'New York'], ['America/Toronto', 'Toronto'],
  ['America/Los_Angeles', 'Los Angeles'], ['Australia/Sydney', 'Sydney'],
];

const PAGE_ITEMS = 8;
const PAGE_CHARS = 2800;
const AWAIT_MS = 5 * 60_000;
const TEAM_KEY_RE = /^((fd|ol|va):\d+|tc:[a-z0-9-]+)$/;

function session(deps: Deps, id: number): Session {
  let s = deps.sessions.get(id);
  if (!s) {
    s = {};
    deps.sessions.set(id, s);
  }
  return s;
}

function navRow(kb: InlineKeyboard, user: Pick<User, 'lang'>, refresh: string | null, back: string | null = 'menu'): InlineKeyboard {
  const t = m(user.lang);
  const row: [string, string][] = [];
  if (refresh) row.push([t.btn.refresh, refresh]);
  if (back && back !== 'menu') row.push([t.btn.back, back]);
  row.push([t.btn.home, 'menu']);
  kb.row();
  for (const [label, data] of row) kb.text(label, data);
  return kb;
}

function footer(user: User, r: Result<unknown> | null, now: number): string {
  if (!r) return '';
  const t = m(user.lang);
  const when = timeText(r.fetchedAt, user.timezone, user.lang);
  const fresh = now - r.fetchedAt < 15 * 60_000;
  let out = '';
  if (r.stale || !fresh) out += '\n\n' + rtlLine(user.lang, t.stale(when));
  else out += '\n\n' + rtlLine(user.lang, `<i>${t.updatedAt(when)} · ${esc(user.timezone)}</i>`);
  if (r.partial) out += '\n' + rtlLine(user.lang, t.partial);
  return out;
}

function pageLabel(user: User, p: number, n: number): string {
  return rtlLine(user.lang, m(user.lang).page(digits(user.lang, p), digits(user.lang, n)));
}

function errorView(user: User, retry: string): View {
  return { text: m(user.lang).errorGeneric, kb: navRow(new InlineKeyboard(), user, retry) };
}

/* ───────────── language selection (first run) ───────────── */

export function languagePickerView(): View {
  const kb = new InlineKeyboard();
  for (const b of LANGUAGE_BUTTONS) kb.text(b.label, `ln:${b.lang}`);
  return { text: LANGUAGE_PICKER_TEXT, kb };
}

/** What /start shows: the language picker until a language has been chosen, then the main menu. */
export function entryView(user: User): View {
  return user.langSelected ? mainMenuView(user) : languagePickerView();
}

export function mainMenuView(user: Pick<User, 'lang'>): View {
  const t = m(user.lang);
  const b = t.btn;
  const kb = new InlineKeyboard()
    .text(b.iran, 'ir').text(b.world, 'wd').row()
    .text(b.live, 'lv').row()
    .text(b.today, 'today').text(b.tomorrow, 'tomorrow').row()
    .text(b.calendar, 'wk').row()
    .text(b.favorites, 'fv:0').text(b.notifications, 'nt').row()
    .text(b.settings, 'st');
  return { text: t.menuTitle, kb };
}

/* ───────────── day views ───────────── */

export async function dayView(date: string, page: number, origin: string, user: User, deps: Deps): Promise<View> {
  const t = m(user.lang);
  const now = deps.now();
  const { startMs, endMs } = dayRangeUtc(date, user.timezone);
  const refresh = `d:${date}:${page}:${origin}`;
  let r: Result<Fixture[]>;
  try {
    r = await deps.fixtures.getRange(startMs, endMs, utcDatesCovering(startMs, endMs));
  } catch (e) {
    log.error('day view failed', { err: e as Error, date });
    return errorView(user, refresh);
  }

  const today = localDateString(now, user.timezone);
  const label = formatDateLabel(date, user.lang);
  const title = date === today ? t.titleToday(label) : date === addDays(today, 1) ? t.titleTomorrow(label) : t.titleDay(label);
  const back = origin === 'w' ? 'wk' : 'menu';
  const grouped = user.defaultView === 'grouped';
  const list = grouped ? sortForGroupedView(r.data, now) : r.data;

  if (!list.length) {
    return { text: `${rtlLine(user.lang, title)}\n\n${t.emptyDay}${footer(user, r, now)}`, kb: navRow(new InlineKeyboard(), user, refresh, back) };
  }
  const pages = paginate(list, { maxItems: PAGE_ITEMS, maxChars: PAGE_CHARS, size: estimateSize });
  const p = clampPage(page, pages.length);
  const text =
    rtlLine(user.lang, title) + '\n\n' + renderFixturePage(pages[p], user, now, grouped) +
    (pages.length > 1 ? `\n\n${pageLabel(user, p + 1, pages.length)}` : '') + footer(user, r, now);

  session(deps, user.telegramId).back = `d:${date}:${p}:${origin}`;
  const kb = new InlineKeyboard();
  for (const f of pages[p]) kb.text(buttonLabel(f, user.lang), `m:${f.id}`).row();
  pagerRow(kb, user, p, pages.length, (n) => `d:${date}:${n}:${origin}`);
  return { text: clampText(text), kb: navRow(kb, user, `d:${date}:${p}:${origin}`, back) };
}

function pagerRow(kb: InlineKeyboard, user: Pick<User, 'lang'>, p: number, total: number, data: (n: number) => string): void {
  if (total <= 1) return;
  const t = m(user.lang);
  if (p > 0) kb.text(t.btn.prev, data(p - 1));
  if (p < total - 1) kb.text(t.btn.next, data(p + 1));
  kb.row();
}

export function calendarView(user: User, deps: Deps): View {
  const t = m(user.lang);
  const today = localDateString(deps.now(), user.timezone);
  const kb = new InlineKeyboard();
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    kb.text(formatDateLabel(d, user.lang), `d:${d}:0:w`);
    if (i % 2 === 1) kb.row();
  }
  navRow(kb, user, null);
  return { text: t.titleCalendar, kb };
}

/* ───────────── live ───────────── */

export async function liveView(user: User, deps: Deps): Promise<View> {
  const t = m(user.lang);
  const now = deps.now();
  let r: Result<Fixture[]>;
  try {
    r = await deps.fixtures.getLive();
  } catch (e) {
    log.error('live view failed', { err: e as Error });
    return errorView(user, 'lv');
  }
  const title = rtlLine(user.lang, t.titleLive);
  if (!r.data.length) {
    return { text: `${title}\n\n${t.emptyLive}${footer(user, r, now)}`, kb: navRow(new InlineKeyboard(), user, 'lv') };
  }
  const items = sortForGroupedView(r.data.slice(0, 20), now);
  session(deps, user.telegramId).back = 'lv';
  const kb = new InlineKeyboard();
  for (const f of items.slice(0, 10)) kb.text(buttonLabel(f, user.lang), `m:${f.id}`).row();
  const text = clampText(`${title}\n\n${renderFixturePage(items, user, now, true)}${footer(user, r, now)}`);
  return { text, kb: navRow(kb, user, 'lv') };
}

/* ───────────── match details & reminders ───────────── */

export async function detailView(id: string, refresh: boolean, user: User, deps: Deps, note?: string): Promise<View> {
  const t = m(user.lang);
  const now = deps.now();
  const back = session(deps, user.telegramId).back ?? 'menu';
  let r: Result<Fixture | null>;
  try {
    r = refresh ? await deps.fixtures.refreshFixture(id) : await deps.fixtures.findFixture(id);
  } catch (e) {
    log.error('detail view failed', { err: e as Error, id });
    return errorView(user, `m:${id}`);
  }
  const f = r.data;
  if (!f) return { text: t.detailNotFound, kb: navRow(new InlineKeyboard(), user, null, back) };

  const lines: string[] = [];
  if (note) lines.push(note, '');
  lines.push(`${t.fComp} <b>${esc(compName(f, user.lang))}</b>`);
  lines.push(`${t.fTeams} ${matchupText(f, user.lang, false, now)}`);
  if (f.kickoffUtc) {
    const ms = Date.parse(f.kickoffUtc);
    lines.push(`${t.fDate} ${formatFullLocalDate(ms, user.timezone, user.lang)}`);
    lines.push(`${t.fTime(timeText(ms, user.timezone, user.lang))} (${formatOffset(ms, user.timezone)})`);
  } else {
    lines.push(`🕒 ${t.noKickoff}`);
  }
  if (f.venue) lines.push(`${t.fVenue} ${esc(f.venue)}`);
  lines.push(`${t.fStatus}: ${fixtureMeta(f, user, now).replace(/^\S+ /, '')}`);
  const sec = sectionOf(f, now);
  if (sec === 'live' || sec === 'finished') {
    lines.push(`${t.fScore}: ${f.homeScore != null && f.awayScore != null ? isolate(digits(user.lang, `${f.homeScore} - ${f.awayScore}`)) : t.scoreNA}`);
  }
  const goals = f.events.filter((e) => e.type === 'goal');
  if (goals.length && sec !== 'upcoming') {
    lines.push('', `${t.fGoals}:`);
    for (const g of goals.slice(0, 20)) {
      const who = g.team === 'home' ? f.homeTeam : g.team === 'away' ? f.awayTeam : '';
      const tag = g.detail === 'penalty' ? ' (P)' : g.detail === 'own_goal' ? ' (OG)' : '';
      const sc = g.homeScore != null && g.awayScore != null ? `${digits(user.lang, `${g.homeScore}-${g.awayScore}`)} ` : '';
      lines.push(`• ${g.minute != null ? `${digits(user.lang, g.minute)}' ` : ''}${sc}${isolate(esc(g.player ?? teamLabel(who, user.lang)))}${tag}`);
    }
  }
  const text = clampText(lines.map((l) => (l ? rtlLine(user.lang, l) : l)).join('\n') + footer(user, r, now));

  const kb = new InlineKeyboard();
  const canRemind = sec === 'upcoming' && !!f.kickoffUtc && Date.parse(f.kickoffUtc) > now;
  const has = await deps.repo.hasMatchReminder(user.telegramId, f.id);
  if (canRemind || has) kb.text(has ? t.btn.remindOn : t.btn.remind, `rm:${f.id}:${has ? 0 : 1}`).row();
  return { text, kb: navRow(kb, user, `m:${id}:r`, back) };
}

async function setReminder(id: string, enabled: boolean, user: User, deps: Deps): Promise<View> {
  const t = m(user.lang);
  if (enabled) {
    const r = await deps.fixtures.findFixture(id);
    const f = r.data;
    const ok = !!f && sectionOf(f, deps.now()) === 'upcoming' && !!f.kickoffUtc && Date.parse(f.kickoffUtc) > deps.now();
    if (!ok) return detailView(id, false, user, deps, t.remindNotPossible);
    await deps.repo.setMatchReminder(user.telegramId, id, true);
    return detailView(id, false, user, deps, t.remindOnMsg);
  }
  await deps.repo.setMatchReminder(user.telegramId, id, false);
  return detailView(id, false, user, deps, t.remindOffMsg);
}

/* ───────────── Iranian football + world football ───────────── */

function supportedMeta(deps: Deps) {
  const supported = new Set(deps.fixtures.supportedCompetitions());
  const known = COMPETITION_CATALOG.filter((c) => supported.has(c.code));
  const unknown = [...supported]
    .filter((c) => !competitionMeta(c))
    .map((c) => ({ code: c, nameEn: c, nameFa: c, category: 'other' as CompetitionCategory, aliases: [] as string[] }));
  return [...known, ...unknown];
}

function compLabel(code: string, lang: Lang): string {
  return `🏆 ${competitionDisplayName(code, code, lang)}`;
}

/** Only competitions the configured providers verified are listed. National teams are not offered (no verified source). */
export function iranView(user: User, deps: Deps): View {
  const t = m(user.lang);
  const metas = supportedMeta(deps);
  const iran = metas.filter((c) => c.category === 'iran');
  const asia = metas.filter((c) => c.category === 'asia');
  const kb = new InlineKeyboard();
  for (const c of iran) kb.text(compLabel(c.code, user.lang), `lg:x:${c.code}:u:0`).row();
  if (asia.length) kb.text(t.iranAsian, 'ir:a').row();
  if ([...iran, ...asia].some((c) => deps.fixtures.supportsStandings(c.code))) kb.text(t.iranStandings, 'ir:s').row();
  const note = iran.length || asia.length ? t.iranSome : t.iranNone;
  return { text: `${t.iranTitle}\n\n${note}`, kb: navRow(kb, user, null) };
}

function iranSubView(kind: 'asia' | 'standings', user: User, deps: Deps): View {
  const t = m(user.lang);
  const metas = supportedMeta(deps).filter((c) => (kind === 'asia' ? c.category === 'asia' : (c.category === 'iran' || c.category === 'asia') && deps.fixtures.supportsStandings(c.code)));
  const kb = new InlineKeyboard();
  for (const c of metas) kb.text(compLabel(c.code, user.lang), kind === 'asia' ? `lg:x:${c.code}:u:0` : `lg:t:${c.code}`).row();
  return { text: kind === 'asia' ? t.asianTitle : t.standingsPick, kb: navRow(kb, user, null, 'ir') };
}

export function worldView(user: User, deps: Deps): View {
  const t = m(user.lang);
  const metas = supportedMeta(deps).filter((c) => WORLD_CATEGORIES.includes(c.category));
  if (!metas.length) return { text: t.noCompetitions, kb: navRow(new InlineKeyboard(), user, null) };
  const kb = new InlineKeyboard();
  for (const cat of WORLD_CATEGORIES) {
    if (metas.some((c) => c.category === cat)) kb.text(CATEGORY_LABELS[cat][user.lang], `lg:c:${cat}`).row();
  }
  kb.text(t.btn.search, 'lg:s').row();
  return { text: t.worldTitle, kb: navRow(kb, user, null) };
}

export function categoryView(cat: string, user: User, deps: Deps): View | null {
  if (!WORLD_CATEGORIES.includes(cat as CompetitionCategory)) return null;
  const t = m(user.lang);
  const list = supportedMeta(deps).filter((c) => c.category === cat);
  if (!list.length) return null;
  const kb = new InlineKeyboard();
  for (const c of list) kb.text(user.lang === 'fa' ? c.nameFa : c.nameEn, `lg:x:${c.code}:u:0`).row();
  return { text: t.leaguesCat(CATEGORY_LABELS[cat as CompetitionCategory][user.lang]), kb: navRow(kb, user, null, 'wd') };
}

function compBack(code: string): string {
  const cat = competitionMeta(code)?.category ?? 'other';
  if (cat === 'iran') return 'ir';
  if (cat === 'asia') return 'ir:a';
  return `lg:c:${cat}`;
}

type CompMode = 't' | 'u' | 'r';

/** Competition screen with Today / Upcoming / Results tabs (+ standings when the provider has them). */
export async function competitionView(code: string, mode: CompMode, page: number, user: User, deps: Deps): Promise<View | null> {
  if (!deps.fixtures.supportedCompetitions().includes(code)) return null;
  const t = m(user.lang);
  const now = deps.now();
  const refresh = `lg:x:${code}:${mode}:${page}`;
  let r: Result<Fixture[]>;
  try {
    if (mode === 'u') r = await deps.fixtures.getCompetitionUpcoming(code);
    else if (mode === 'r') r = await deps.fixtures.getCompetitionResults(code);
    else {
      const { startMs, endMs } = dayRangeUtc(localDateString(now, user.timezone), user.timezone);
      r = await deps.fixtures.getCompetitionRange(code, startMs, endMs);
    }
  } catch (e) {
    log.error('competition view failed', { err: e as Error, code });
    return errorView(user, refresh);
  }
  const name = competitionDisplayName(code, code, user.lang);
  const title = rtlLine(user.lang, t.leagueTitle(esc(name)));
  const tabs = new InlineKeyboard();
  const tab = (label: string, md: CompMode) => tabs.text(mode === md ? `• ${label}` : label, `lg:x:${code}:${md}:0`);
  tab(t.tabToday, 't');
  tab(t.tabUpcoming, 'u');
  tab(t.tabResults, 'r');
  if (deps.fixtures.supportsStandings(code)) tabs.text(t.tabStandings, `lg:t:${code}`);
  tabs.row();
  const empty = mode === 'u' ? t.emptyComp : mode === 'r' ? t.emptyCompResults : t.emptyCompToday;
  if (!r.data.length) {
    return { text: `${title}\n\n${empty}${footer(user, r, now)}`, kb: navRow(tabs, user, refresh, compBack(code)) };
  }
  const pages = paginate(r.data, { maxItems: PAGE_ITEMS, maxChars: PAGE_CHARS, size: estimateSize });
  const p = clampPage(page, pages.length);
  session(deps, user.telegramId).back = `lg:x:${code}:${mode}:${p}`;
  const kb = tabs;
  for (const f of pages[p]) kb.text(buttonLabel(f, user.lang), `m:${f.id}`).row();
  pagerRow(kb, user, p, pages.length, (n) => `lg:x:${code}:${mode}:${n}`);
  const body = dateGrouped(pages[p], user, now);
  const text = clampText(`${title}\n\n${body}${pages.length > 1 ? `\n\n${pageLabel(user, p + 1, pages.length)}` : ''}${footer(user, r, now)}`);
  return { text, kb: navRow(kb, user, `lg:x:${code}:${mode}:${p}`, compBack(code)) };
}

export async function standingsView(code: string, user: User, deps: Deps): Promise<View | null> {
  if (!deps.fixtures.supportedCompetitions().includes(code) || !deps.fixtures.supportsStandings(code)) return null;
  const t = m(user.lang);
  const now = deps.now();
  let r: Result<StandingRow[]>;
  try {
    r = await deps.fixtures.getStandings(code);
  } catch (e) {
    log.error('standings view failed', { err: e as Error, code });
    return errorView(user, `lg:t:${code}`);
  }
  const back = `lg:x:${code}:u:0`;
  const title = rtlLine(user.lang, t.standingsTitle(esc(competitionDisplayName(code, code, user.lang))));
  if (!r.data.length) return { text: `${title}\n\n${t.emptyStandings}${footer(user, r, now)}`, kb: navRow(new InlineKeyboard(), user, `lg:t:${code}`, back) };
  const d = (n: number | null) => (n == null ? '–' : digits(user.lang, n));
  const rows = r.data.slice(0, 30).map((row) =>
    rtlLine(user.lang, `${d(row.rank)}. ${isolate(esc(teamLabel(row.team, user.lang)))} · ${d(row.played)} · ${row.goalDiff == null ? '–' : digits(user.lang, row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff)} · <b>${d(row.points)}</b>`),
  );
  const text = clampText(`${title}\n${rtlLine(user.lang, `<i>${t.standingsHead}</i>`)}\n\n${rows.join('\n')}${footer(user, r, now)}`);
  return { text, kb: navRow(new InlineKeyboard(), user, `lg:t:${code}`, back) };
}

/** Lists fixtures with a local-date heading whenever the day changes. */
function dateGrouped(list: Fixture[], user: User, now: number): string {
  const out: string[] = [];
  let last = '';
  for (const f of list) {
    const d = f.kickoffUtc ? localDateString(Date.parse(f.kickoffUtc), user.timezone) : '';
    if (d !== last) {
      out.push('', rtlLine(user.lang, d ? `📅 <b>${formatDateLabel(d, user.lang)}</b>` : `📅 <b>${m(user.lang).noKickoff}</b>`));
      last = d;
    }
    out.push(rtlLine(user.lang, `🔹 ${matchupText(f, user.lang, true, now)}`), rtlLine(user.lang, fixtureMeta(f, user, now)));
  }
  return out.join('\n').replace(/^\n/, '');
}

export function searchCompetitions(query: string, user: User, deps: Deps): View {
  const t = m(user.lang);
  const q = query.trim().toLowerCase();
  const hits = supportedMeta(deps).filter(
    (c) => c.code.toLowerCase() === q || [c.nameEn, c.nameFa, ...((c as { aliases?: string[] }).aliases ?? [])].some((s) => s.toLowerCase().includes(q)),
  );
  if (!q || !hits.length) return { text: t.emptyCompSearch, kb: navRow(new InlineKeyboard().text(t.btn.search, 'lg:s'), user, null, 'wd') };
  const kb = new InlineKeyboard();
  for (const c of hits.slice(0, 10)) kb.text(user.lang === 'fa' ? c.nameFa : c.nameEn, `lg:x:${c.code}:u:0`).row();
  return { text: t.searchCompResults(esc(query.slice(0, 40))), kb: navRow(kb, user, null, 'wd') };
}

/* ───────────── favorites ───────────── */

export async function favoritesView(page: number, user: User, deps: Deps): Promise<View> {
  const t = m(user.lang);
  const now = deps.now();
  const favs = await deps.repo.listFavorites(user.telegramId);
  const kb = new InlineKeyboard();
  if (!favs.length) {
    kb.text(t.btn.addTeam, 'fv:s').row();
    return { text: `${t.favTitle}\n\n${t.emptyFavs}`, kb: navRow(kb, user, null) };
  }
  let r: Result<Fixture[]>;
  try {
    r = await deps.fixtures.upcomingForTeams(favs);
  } catch (e) {
    log.error('favorites view failed', { err: e as Error });
    return errorView(user, `fv:${page}`);
  }
  const title = rtlLine(user.lang, t.favUpcomingTitle);
  const names = rtlLine(user.lang, favs.map((f) => esc(displayNameForKey(f.key, f.name, user.lang))).join(' · '));
  let body = t.emptyFavFixtures;
  const pages = paginate(r.data, { maxItems: PAGE_ITEMS, maxChars: PAGE_CHARS, size: estimateSize });
  const p = clampPage(page, pages.length);
  if (pages.length) {
    body = dateGrouped(pages[p], user, now);
    for (const f of pages[p]) kb.text(buttonLabel(f, user.lang), `m:${f.id}`).row();
    pagerRow(kb, user, p, pages.length, (n) => `fv:${n}`);
  }
  session(deps, user.telegramId).back = `fv:${p}`;
  kb.text(t.btn.addTeam, 'fv:s').text(t.btn.manage, 'fv:m').row();
  const text = clampText(`${title}\n${names}\n\n${body}${pages.length > 1 ? `\n\n${pageLabel(user, p + 1, pages.length)}` : ''}${footer(user, r, now)}`);
  return { text, kb: navRow(kb, user, `fv:${p}`) };
}

export async function manageFavoritesView(user: User, deps: Deps, note?: string): Promise<View> {
  const t = m(user.lang);
  const favs = await deps.repo.listFavorites(user.telegramId);
  const kb = new InlineKeyboard();
  if (!favs.length) {
    kb.text(t.btn.addTeam, 'fv:s').row();
    return { text: `${note ? note + '\n\n' : ''}${t.emptyFavs}`, kb: navRow(kb, user, null, 'fv:0') };
  }
  for (const f of favs) kb.text(`🗑 ${displayNameForKey(f.key, f.name, user.lang)}`, `fv:r:${f.key}`).row();
  kb.text(t.btn.addTeam, 'fv:s').row();
  return { text: `${note ? note + '\n\n' : ''}${t.favManageTitle}`, kb: navRow(kb, user, null, 'fv:0') };
}

export async function teamSearchView(query: string, user: User, deps: Deps): Promise<View> {
  const t = m(user.lang);
  let res: Result<{ key: string; name: string }[]>;
  try {
    res = await deps.fixtures.searchTeams(query.slice(0, 40));
  } catch (e) {
    log.error('team search failed', { err: e as Error });
    return errorView(user, 'fv:s');
  }
  const retry = new InlineKeyboard().text(t.btn.search, 'fv:s').row();
  if (!res.data.length) return { text: t.emptyTeamSearch, kb: navRow(retry, user, null, 'fv:0') };
  const favs = new Set((await deps.repo.listFavorites(user.telegramId)).map((f) => f.key));
  const kb = new InlineKeyboard();
  for (const tm of res.data) {
    if (!favs.has(tm.key)) kb.text(`➕ ${displayNameForKey(tm.key, tm.name, user.lang)}`, `fv:a:${tm.key}`).row();
  }
  return { text: t.favSearchResults(esc(query.slice(0, 40))), kb: navRow(kb, user, null, 'fv:0') };
}

/* ───────────── notifications ───────────── */

export async function notificationsView(user: User, deps: Deps, note?: string): Promise<View> {
  const t = m(user.lang);
  const fresh = (await deps.repo.getUser(user.telegramId)) ?? user;
  const kb = new InlineKeyboard();
  for (const k of NOTIF_KINDS) {
    const on = fresh.notif[k];
    kb.text(`${on ? t.on : t.off} · ${t.notifKinds[k]}`, `nt:t:${k}:${on ? 0 : 1}`).row();
  }
  kb.text(t.notifPickComps, 'nt:c').row();
  return { text: `${note ? note + '\n\n' : ''}${t.notifTitle}`, kb: navRow(kb, user, null) };
}

export async function setNotification(kind: NotifKind, enabled: boolean, user: User, deps: Deps): Promise<View> {
  const t = m(user.lang);
  if (enabled && kind === 'favorites' && !(await deps.repo.listFavorites(user.telegramId)).length) {
    return notificationsView(user, deps, `⚠️ ${t.notifNeedFavs}`);
  }
  if (enabled && kind === 'competitions' && !(await deps.repo.listNotifCompetitions(user.telegramId)).length) {
    return notificationsView(user, deps, `⚠️ ${t.notifNeedComps}`);
  }
  await deps.repo.setNotif(user.telegramId, kind, enabled);
  return notificationsView(user, deps);
}

export async function notifCompetitionsView(user: User, deps: Deps): Promise<View> {
  const t = m(user.lang);
  const selected = new Set(await deps.repo.listNotifCompetitions(user.telegramId));
  const kb = new InlineKeyboard();
  supportedMeta(deps).forEach((c, i) => {
    const on = selected.has(c.code);
    kb.text(`${on ? '✅' : '⬜'} ${user.lang === 'fa' ? c.nameFa : c.nameEn}`, `nt:c:${c.code}:${on ? 0 : 1}`);
    if (i % 2 === 1) kb.row();
  });
  return { text: t.notifCompsTitle, kb: navRow(kb, user, null, 'nt') };
}

/* ───────────── settings ───────────── */

export async function settingsView(user: User, deps: Deps): Promise<View> {
  const t = m(user.lang);
  const u = (await deps.repo.getUser(user.telegramId)) ?? user;
  const kb = new InlineKeyboard()
    .text(t.setLang, 'st:l').text(t.setTz, 'st:z').row()
    .text(t.setNotif, 'nt').text(t.setFavs, 'fv:m').row()
    .text(t.setView, 'st:v').row()
    .text(t.btn.help, 'hp').row();
  const view = u.defaultView === 'grouped' ? t.viewGrouped : t.viewByTime;
  const text = `${t.settingsTitle}\n\n${t.settingsSummary(t.langName, `${esc(u.timezone)} (${formatOffset(deps.now(), u.timezone)})`, view)}`;
  return { text, kb: navRow(kb, u, null) };
}

export function languageView(user: User): View {
  const t = m(user.lang);
  const kb = new InlineKeyboard();
  for (const b of LANGUAGE_BUTTONS) kb.text(`${b.lang === user.lang ? '✅ ' : ''}${b.label}`, `st:l:${b.lang}`);
  kb.row();
  return { text: t.langTitle, kb: navRow(kb, user, null, 'st') };
}

export function timezoneView(user: User, deps: Deps, text?: string): View {
  const t = m(user.lang);
  const kb = new InlineKeyboard();
  TIMEZONES.forEach(([tz, city], i) => {
    kb.text(`${city} (${formatOffset(deps.now(), tz)})`, `st:z:${i}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(t.tzOther, 'st:z:o').row();
  return { text: text ?? t.tzTitle, kb: navRow(kb, user, null, 'st') };
}

export function viewPrefView(user: User): View {
  const t = m(user.lang);
  const kb = new InlineKeyboard()
    .text(`${user.defaultView === 'grouped' ? '✅ ' : ''}${t.viewGrouped}`, 'st:v:g').row()
    .text(`${user.defaultView === 'by_time' ? '✅ ' : ''}${t.viewByTime}`, 'st:v:t').row();
  return { text: t.viewTitle, kb: navRow(kb, user, null, 'st') };
}

function promptView(kind: 'team' | 'comp' | 'tz', user: User, deps: Deps): View {
  const t = m(user.lang);
  session(deps, user.telegramId).awaiting = { kind, until: deps.now() + AWAIT_MS };
  const text = kind === 'team' ? t.favSearchPrompt : kind === 'comp' ? t.searchCompPrompt : t.tzTitle;
  const back = kind === 'team' ? 'fv:0' : kind === 'comp' ? 'wd' : 'st:z';
  return { text, kb: navRow(new InlineKeyboard(), user, null, back) };
}

/* ───────────── router ───────────── */

/**
 * Maps callback data to a view, performing any state change the action implies.
 * Every mutating action carries its target value (never "toggle"), so a stale keyboard
 * can only re-apply an explicit state and never flips something unexpectedly.
 * Returns null for unknown/malformed data (caller shows "expired" + main menu).
 * Until a language has been chosen, every action except `ln:*` returns the language picker.
 */
export async function route(data: string, user: User, deps: Deps): Promise<RouteResult | null> {
  const parts = data.split(':');
  const now = deps.now();
  const out = (view: View, u: User = user): RouteResult => ({ view, user: u });
  const clearAwait = () => {
    const s = deps.sessions.get(user.telegramId);
    if (s) s.awaiting = undefined;
  };

  // ── language selection (first run, or a stale picker)
  if (parts[0] === 'ln') {
    if (!isLang(parts[1])) return null;
    const first = !user.langSelected;
    const patch: { lang: Lang; langSelected: true; timezone?: string } = { lang: parts[1], langSelected: true };
    // The initial timezone follows the language ONLY on first selection; afterwards they are independent.
    if (first) patch.timezone = DEFAULT_TIMEZONE_BY_LANG[parts[1]];
    await deps.repo.updateUser(user.telegramId, patch);
    const u: User = { ...user, ...patch };
    const menu = mainMenuView(u);
    return { view: { text: `${m(u.lang).langChosen}\n\n${menu.text}`, kb: menu.kb }, user: u, onboarded: first };
  }
  if (!user.langSelected) return out(languagePickerView());

  if (data !== 'fv:s' && data !== 'lg:s' && data !== 'st:z:o') clearAwait();

  switch (parts[0]) {
    case 'menu':
      return out(mainMenuView(user));
    case 'today':
      return out(await dayView(localDateString(now, user.timezone), 0, 'm', user, deps));
    case 'tomorrow':
      return out(await dayView(addDays(localDateString(now, user.timezone), 1), 0, 'm', user, deps));
    case 'd': {
      const [, date, pg, origin] = parts;
      if (!date || !isDateString(date)) return null;
      return out(await dayView(date, Number(pg) || 0, origin === 'w' ? 'w' : 'm', user, deps));
    }
    case 'wk':
      return out(calendarView(user, deps));
    case 'lv':
      return out(await liveView(user, deps));
    case 'hp':
      return out({ text: m(user.lang).help, kb: navRow(new InlineKeyboard(), user, null, 'st') });
    case 'm': {
      if (!parts[1] || !parts[2]) return null;
      return out(await detailView(`${parts[1]}:${parts[2]}`, parts[3] === 'r', user, deps));
    }
    case 'rm': {
      if (!parts[1] || !parts[2] || (parts[3] !== '0' && parts[3] !== '1')) return null;
      return out(await setReminder(`${parts[1]}:${parts[2]}`, parts[3] === '1', user, deps));
    }
    case 'ir': {
      if (parts.length === 1) return out(iranView(user, deps));
      if (parts[1] === 'a') return out(iranSubView('asia', user, deps));
      if (parts[1] === 's') return out(iranSubView('standings', user, deps));
      return null;
    }
    case 'wd':
      return out(worldView(user, deps));
    case 'lg': {
      if (parts.length === 1) return out(worldView(user, deps));
      if (parts[1] === 'c') {
        const v = categoryView(parts[2], user, deps);
        return v ? out(v) : null;
      }
      if (parts[1] === 's') return out(promptView('comp', user, deps));
      if (parts[1] === 'x') {
        const mode = parts[3];
        if (mode !== 't' && mode !== 'u' && mode !== 'r') return null;
        const v = await competitionView(parts[2], mode, Number(parts[4]) || 0, user, deps);
        return v ? out(v) : null;
      }
      if (parts[1] === 't') {
        const v = await standingsView(parts[2], user, deps);
        return v ? out(v) : null;
      }
      return null;
    }
    case 'fv': {
      if (parts[1] === 's') return out(promptView('team', user, deps));
      if (parts[1] === 'm') return out(await manageFavoritesView(user, deps));
      if (parts[1] === 'a' || parts[1] === 'r') {
        const key = parts.slice(2).join(':');
        if (!TEAM_KEY_RE.test(key)) return null;
        if (parts[1] === 'a') {
          const name = await resolveTeamName(key, deps);
          if (!name) return out(await favoritesView(0, user, deps));
          await deps.repo.addFavorite(user.telegramId, { key, name });
          return out(await manageFavoritesView(user, deps, m(user.lang).favAdded(esc(displayNameForKey(key, name, user.lang)))));
        }
        const fav = (await deps.repo.listFavorites(user.telegramId)).find((f) => f.key === key);
        await deps.repo.removeFavorite(user.telegramId, key);
        return out(await manageFavoritesView(user, deps, fav ? m(user.lang).favRemoved(esc(displayNameForKey(fav.key, fav.name, user.lang))) : undefined));
      }
      return out(await favoritesView(Number(parts[1]) || 0, user, deps));
    }
    case 'nt': {
      if (parts.length === 1) return out(await notificationsView(user, deps));
      if (parts[1] === 't') {
        const kind = parts[2] as NotifKind;
        if (!NOTIF_KINDS.includes(kind) || (parts[3] !== '0' && parts[3] !== '1')) return null;
        return out(await setNotification(kind, parts[3] === '1', user, deps));
      }
      if (parts[1] === 'c') {
        if (parts.length === 2) return out(await notifCompetitionsView(user, deps));
        const code = parts[2];
        if (!deps.fixtures.supportedCompetitions().includes(code) || (parts[3] !== '0' && parts[3] !== '1')) return null;
        await deps.repo.setNotifCompetition(user.telegramId, code, parts[3] === '1');
        return out(await notifCompetitionsView(user, deps));
      }
      return null;
    }
    case 'st': {
      if (parts.length === 1) return out(await settingsView(user, deps));
      if (parts[1] === 'l') {
        if (parts[2] === undefined) return out(languageView(user));
        if (!isLang(parts[2])) return null;
        // Only the language changes: favorites, timezone, notification and display preferences are untouched.
        await deps.repo.updateUser(user.telegramId, { lang: parts[2] });
        const u: User = { ...user, lang: parts[2] };
        return out(await settingsView(u, deps), u);
      }
      if (parts[1] === 'z') {
        if (parts[2] === 'o') return out(promptView('tz', user, deps));
        if (parts[2] === undefined) return out(timezoneView(user, deps));
        const entry = TIMEZONES[Number(parts[2])];
        if (!entry) return null;
        await deps.repo.updateUser(user.telegramId, { timezone: entry[0] });
        const u = { ...user, timezone: entry[0] };
        const v = await settingsView(u, deps);
        return out({ ...v, text: `${m(u.lang).tzSet(esc(entry[0]))}\n\n${v.text}` }, u);
      }
      if (parts[1] === 'v') {
        if (parts[2] === 'g' || parts[2] === 't') {
          const dv = parts[2] === 'g' ? 'grouped' : 'by_time';
          await deps.repo.updateUser(user.telegramId, { defaultView: dv });
          const u = { ...user, defaultView: dv } as User;
          return out(viewPrefView(u), u);
        }
        return out(viewPrefView(user));
      }
      return null;
    }
    default:
      return null;
  }
}

async function resolveTeamName(key: string, deps: Deps): Promise<string | null> {
  if (key.startsWith('tc:')) return teamById(key.slice(3))?.en ?? null;
  const w = await deps.fixtures.getWindow();
  for (const f of w.data) {
    if (f.homeTeamKey === key) return f.homeTeam;
    if (f.awayTeamKey === key) return f.awayTeam;
  }
  return null;
}

/** Handles free text typed while the bot is waiting for a search/timezone. */
export async function handleText(text: string, user: User, deps: Deps): Promise<RouteResult | null> {
  if (!user.langSelected) return { view: languagePickerView(), user };
  const s = deps.sessions.get(user.telegramId);
  const aw = s?.awaiting;
  if (!aw || aw.until < deps.now()) {
    if (s) s.awaiting = undefined;
    return null;
  }
  const q = text.trim().slice(0, 60);
  if (!q) return null;
  s!.awaiting = undefined;
  if (aw.kind === 'team') return { view: await teamSearchView(q, user, deps), user };
  if (aw.kind === 'comp') return { view: searchCompetitions(q, user, deps), user };
  if (!isValidTimeZone(q)) {
    s!.awaiting = { kind: 'tz', until: deps.now() + AWAIT_MS };
    return { view: timezoneView(user, deps, m(user.lang).tzInvalid), user };
  }
  await deps.repo.updateUser(user.telegramId, { timezone: q });
  const u = { ...user, timezone: q };
  const v = await settingsView(u, deps);
  return { view: { ...v, text: `${m(u.lang).tzSet(esc(q))}\n\n${v.text}` }, user: u };
}


