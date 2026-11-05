import type { Repository, User } from '../../database/repositories/types.js';
import type { Fixture } from '../../types/fixture.js';
import { digits, m } from '../../i18n/index.js';
import { compName, esc, fixtureEntry, rtlLine, sortForGroupedView, renderFixturePage, matchupText, timeText } from '../../bot/format.js';
import type { FixtureService } from '../fixtures/fixtureService.js';
import { effectiveStatus } from '../fixtures/status.js';
import { isFavorite } from '../fixtures/fixtureService.js';
import { log } from '../../utils/logger.js';
import {
  dayRangeUtc, formatDateLabel, formatLocalDateLabel, getZonedParts, localDateString, utcDatesCovering,
} from '../../utils/time.js';

export type Sender = (userId: number, html: string) => Promise<void>;

/** Telegram "bot blocked / chat not found" style failures: user can no longer be reached. */
export class UnreachableUserError extends Error {}

export const SCHEDULE = {
  dailyHour: 8,
  competitionsHour: 8,
  competitionsMinute: 30,
  favoritesHour: 9,
  reminderMinutes: 30,
  /** minutes after the scheduled time that a late tick may still send (e.g. after a restart) */
  graceMinutes: 20,
};

function due(local: { hour: number; minute: number }, hour: number, minute: number): boolean {
  const diff = (local.hour * 60 + local.minute) - (hour * 60 + minute);
  return diff >= 0 && diff <= SCHEDULE.graceMinutes;
}

/**
 * Runs once per minute. Every send is guarded by a dedupe key claimed in the database
 * BEFORE sending, so overlapping ticks, restarts and multiple replicas never double-send.
 */
export class Notifier {
  constructor(
    private readonly repo: Repository,
    private readonly fixtures: FixtureService,
    private readonly send: Sender,
    private readonly now: () => number = Date.now,
  ) {}

  async tick(): Promise<{ sent: number }> {
    let sent = 0;
    sent += await this.daily();
    sent += await this.competitionsDigest();
    sent += await this.favoritesDigest();
    sent += await this.reminders();
    return { sent };
  }

  private async deliver(user: User, key: string, html: string): Promise<boolean> {
    if (!(await this.repo.claimNotification(user.telegramId, key))) return false;
    try {
      await this.send(user.telegramId, html);
      return true;
    } catch (e) {
      if (e instanceof UnreachableUserError) {
        await this.repo.updateUser(user.telegramId, { blocked: true });
        log.info('user unreachable; notifications paused', { user: user.telegramId });
      } else {
        await this.repo.releaseNotification(user.telegramId, key);
        log.warn('notification send failed; will retry', { user: user.telegramId, err: e as Error });
      }
      return false;
    }
  }

  private async dayFixtures(user: User): Promise<Fixture[] | null> {
    const date = localDateString(this.now(), user.timezone);
    const { startMs, endMs } = dayRangeUtc(date, user.timezone);
    try {
      return (await this.fixtures.getRange(startMs, endMs, utcDatesCovering(startMs, endMs))).data;
    } catch (e) {
      log.warn('notifier could not load fixtures', { err: e as Error });
      return null;
    }
  }

  private async daily(): Promise<number> {
    let n = 0;
    for (const u of await this.repo.usersWithNotif('daily')) {
      const local = getZonedParts(this.now(), u.timezone);
      if (!due(local, SCHEDULE.dailyHour, 0)) continue;
      const date = localDateString(this.now(), u.timezone);
      const list = await this.dayFixtures(u);
      if (!list || !list.length) continue; // nothing to say: send nothing (and do not claim, so a later tick may retry)
      const t = m(u.lang);
      const body = `${rtlLine(u.lang, t.notifDailyHeader + ' — ' + formatDateLabel(date, u.lang))}\n\n${renderFixturePage(sortForGroupedView(list, this.now()).slice(0, 25), u, this.now(), true)}`;
      if (await this.deliver(u, `daily:${date}`, body)) n++;
    }
    return n;
  }

  private async competitionsDigest(): Promise<number> {
    let n = 0;
    for (const u of await this.repo.usersWithNotif('competitions')) {
      const local = getZonedParts(this.now(), u.timezone);
      if (!due(local, SCHEDULE.competitionsHour, SCHEDULE.competitionsMinute)) continue;
      const comps = new Set(await this.repo.listNotifCompetitions(u.telegramId));
      if (!comps.size) continue;
      const date = localDateString(this.now(), u.timezone);
      const list = (await this.dayFixtures(u))?.filter((f) => comps.has(f.competitionCode));
      if (!list?.length) continue;
      const t = m(u.lang);
      const body = `${rtlLine(u.lang, t.notifCompHeader)}\n\n${renderFixturePage(sortForGroupedView(list, this.now()).slice(0, 25), u, this.now(), true)}`;
      if (await this.deliver(u, `comps:${date}`, body)) n++;
    }
    return n;
  }

  private async favoritesDigest(): Promise<number> {
    let n = 0;
    for (const u of await this.repo.usersWithNotif('favorites')) {
      const local = getZonedParts(this.now(), u.timezone);
      if (!due(local, SCHEDULE.favoritesHour, 0)) continue;
      const favs = await this.repo.listFavorites(u.telegramId);
      if (!favs.length) continue;
      let list: Fixture[];
      try {
        list = (await this.fixtures.upcomingForTeams(favs)).data;
      } catch (e) {
        log.warn('favorites digest skipped', { err: e as Error });
        continue;
      }
      const horizon = this.now() + 48 * 3600_000;
      list = list.filter((f) => f.kickoffUtc && Date.parse(f.kickoffUtc) <= horizon && effectiveStatus(f, this.now()) === 'scheduled');
      if (!list.length) continue;
      const t = m(u.lang);
      const lines = list.slice(0, 15).map((f) => {
        const ms = Date.parse(f.kickoffUtc!);
        return rtlLine(u.lang, `🔹 ${matchupText(f, u.lang, false, this.now())}\n🕒 ${formatLocalDateLabel(ms, u.timezone, u.lang)} · ${timeText(ms, u.timezone, u.lang)} · ${esc(compName(f, u.lang))}`);
      });
      const date = localDateString(this.now(), u.timezone);
      if (await this.deliver(u, `favs:${date}`, `${rtlLine(u.lang, t.notifFavHeader)}\n\n${lines.join('\n')}`)) n++;
    }
    return n;
  }

  private reminderBody(f: Fixture, u: User, mins: number): string {
    const t = m(u.lang);
    const ms = Date.parse(f.kickoffUtc!);
    const match = matchupText(f, u.lang, false, this.now());
    return [
      rtlLine(u.lang, t.notifReminderTitle),
      rtlLine(u.lang, t.notifReminderBody(match, digits(u.lang, mins))),
      rtlLine(u.lang, `🏆 ${esc(compName(f, u.lang))}`),
      rtlLine(u.lang, `🕒 ${timeText(ms, u.timezone, u.lang)}`),
    ].join('\n');
  }

  /**
   * Reminders: favorites / selected competitions (if the user enabled "reminders") plus explicit per-match
   * "Remind me" requests. The dedupe key includes the kickoff time, so a rescheduled match is reminded again
   * at its new time, while a duplicate tick never double-sends. Postponed/cancelled matches get one notice.
   */
  private async reminders(): Promise<number> {
    const now = this.now();
    const horizon = now + SCHEDULE.reminderMinutes * 60_000;
    let n = 0;

    const users = await this.repo.usersWithNotif('reminders');
    let soon: Fixture[] = [];
    try {
      const list = (await this.fixtures.getRange(now, horizon + 1, utcDatesCovering(now, horizon + 1))).data;
      soon = list.filter((f) => f.kickoffUtc && effectiveStatus(f, now) === 'scheduled' && Date.parse(f.kickoffUtc) > now && Date.parse(f.kickoffUtc) <= horizon);
    } catch (e) {
      log.warn('reminders: fixtures unavailable', { err: e as Error });
    }

    const mins = (f: Fixture) => Math.max(1, Math.round((Date.parse(f.kickoffUtc!) - now) / 60_000));
    for (const u of users) {
      if (!soon.length) break;
      const favs = await this.repo.listFavorites(u.telegramId);
      const comps = new Set(await this.repo.listNotifCompetitions(u.telegramId));
      for (const f of soon) {
        const mine = isFavorite(favs, f.homeTeam, f.homeTeamKey) || isFavorite(favs, f.awayTeam, f.awayTeamKey) || (u.notif.competitions && comps.has(f.competitionCode));
        if (!mine) continue;
        if (await this.deliver(u, `rem:${f.id}:${f.kickoffUtc}`, this.reminderBody(f, u, mins(f)))) n++;
      }
    }

    // Explicit per-match reminders (work even if the general "reminders" switch is off — the user asked for this match).
    for (const { user: u, fixtureId } of await this.repo.allMatchReminders()) {
      const f = this.fixtures.peekFixture(fixtureId);
      if (!f) continue;
      const status = effectiveStatus(f, now);
      if (status === 'postponed' || status === 'cancelled') {
        const t = m(u.lang);
        const match = matchupText(f, u.lang, false, now);
        const body = rtlLine(u.lang, status === 'postponed' ? t.notifPostponed(match) : t.notifCancelled(match));
        if (await this.deliver(u, `pp:${f.id}:${status}`, body)) n++;
        await this.repo.setMatchReminder(u.telegramId, fixtureId, false);
        continue;
      }
      if (soon.some((x) => x.id === f.id)) {
        if (await this.deliver(u, `rem:${f.id}:${f.kickoffUtc}`, this.reminderBody(f, u, mins(f)))) n++;
      }
    }
    return n;
  }
}
