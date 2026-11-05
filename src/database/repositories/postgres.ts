import pg from 'pg';
import type { DefaultView, FavoriteTeam, NotifKind, Repository, User, UserDefaults } from './types.js';

const NOTIF_COLUMN: Record<NotifKind, string> = {
  daily: 'notif_daily',
  favorites: 'notif_favorites',
  reminders: 'notif_reminders',
  competitions: 'notif_competitions',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToUser(r: any): User {
  return {
    telegramId: Number(r.telegram_id),
    lang: r.lang,
    timezone: r.timezone,
    defaultView: r.default_view as DefaultView,
    notif: { daily: r.notif_daily, favorites: r.notif_favorites, reminders: r.notif_reminders, competitions: r.notif_competitions },
    blocked: r.blocked,
    langSelected: r.lang_selected,
  };
}

export class PostgresRepository implements Repository {
  constructor(private readonly pool: pg.Pool) {}

  static create(url: string): PostgresRepository {
    return new PostgresRepository(new pg.Pool({ connectionString: url, max: 10 }));
  }

  async getOrCreateUser(id: number, d: UserDefaults): Promise<User> {
    await this.pool.query(
      'INSERT INTO users (telegram_id, lang, timezone) VALUES ($1,$2,$3) ON CONFLICT (telegram_id) DO NOTHING',
      [id, d.lang, d.timezone],
    );
    const u = await this.getUser(id);
    return u!;
  }
  async getUser(id: number): Promise<User | null> {
    const r = await this.pool.query('SELECT * FROM users WHERE telegram_id=$1', [id]);
    return r.rows[0] ? rowToUser(r.rows[0]) : null;
  }
  async updateUser(id: number, patch: Partial<Pick<User, 'lang' | 'timezone' | 'defaultView' | 'blocked' | 'langSelected'>>): Promise<void> {
    const cols: Record<string, string> = { lang: 'lang', timezone: 'timezone', defaultView: 'default_view', blocked: 'blocked', langSelected: 'lang_selected' };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !cols[k]) continue;
      vals.push(v);
      sets.push(`${cols[k]}=$${vals.length}`);
    }
    if (!sets.length) return;
    vals.push(id);
    await this.pool.query(`UPDATE users SET ${sets.join(',')}, updated_at=now() WHERE telegram_id=$${vals.length}`, vals);
  }
  async setNotif(id: number, kind: NotifKind, enabled: boolean): Promise<void> {
    await this.pool.query(`UPDATE users SET ${NOTIF_COLUMN[kind]}=$1, updated_at=now() WHERE telegram_id=$2`, [enabled, id]);
  }
  async listFavorites(id: number): Promise<FavoriteTeam[]> {
    const r = await this.pool.query('SELECT team_key, team_name FROM favorite_teams WHERE telegram_id=$1 ORDER BY created_at', [id]);
    return r.rows.map((x: any) => ({ key: x.team_key, name: x.team_name }));
  }
  async addFavorite(id: number, t: FavoriteTeam): Promise<void> {
    await this.pool.query(
      'INSERT INTO favorite_teams (telegram_id, team_key, team_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [id, t.key, t.name],
    );
  }
  async removeFavorite(id: number, key: string): Promise<void> {
    await this.pool.query('DELETE FROM favorite_teams WHERE telegram_id=$1 AND team_key=$2', [id, key]);
  }
  async listNotifCompetitions(id: number): Promise<string[]> {
    const r = await this.pool.query('SELECT competition_code FROM notification_competitions WHERE telegram_id=$1', [id]);
    return r.rows.map((x: any) => x.competition_code);
  }
  async setNotifCompetition(id: number, code: string, enabled: boolean): Promise<void> {
    if (enabled) {
      await this.pool.query('INSERT INTO notification_competitions (telegram_id, competition_code) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, code]);
    } else {
      await this.pool.query('DELETE FROM notification_competitions WHERE telegram_id=$1 AND competition_code=$2', [id, code]);
    }
  }
  async setMatchReminder(id: number, fixtureId: string, enabled: boolean): Promise<void> {
    if (enabled) {
      await this.pool.query('INSERT INTO match_reminders (telegram_id, fixture_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, fixtureId]);
    } else {
      await this.pool.query('DELETE FROM match_reminders WHERE telegram_id=$1 AND fixture_id=$2', [id, fixtureId]);
    }
  }
  async hasMatchReminder(id: number, fixtureId: string): Promise<boolean> {
    const r = await this.pool.query('SELECT 1 FROM match_reminders WHERE telegram_id=$1 AND fixture_id=$2', [id, fixtureId]);
    return (r.rowCount ?? 0) > 0;
  }
  async allMatchReminders(): Promise<{ user: User; fixtureId: string }[]> {
    const r = await this.pool.query('SELECT u.*, m.fixture_id FROM match_reminders m JOIN users u ON u.telegram_id=m.telegram_id WHERE u.blocked=FALSE');
    return r.rows.map((x: any) => ({ user: rowToUser(x), fixtureId: x.fixture_id }));
  }
  async matchRemindersFor(fixtureIds: string[]): Promise<{ user: User; fixtureId: string }[]> {
    if (!fixtureIds.length) return [];
    const r = await this.pool.query('SELECT u.*, m.fixture_id FROM match_reminders m JOIN users u ON u.telegram_id=m.telegram_id WHERE u.blocked=FALSE AND m.fixture_id = ANY($1)', [fixtureIds]);
    return r.rows.map((x: any) => ({ user: rowToUser(x), fixtureId: x.fixture_id }));
  }
  async usersWithNotif(kind: NotifKind): Promise<User[]> {
    const r = await this.pool.query(`SELECT * FROM users WHERE ${NOTIF_COLUMN[kind]}=TRUE AND blocked=FALSE`);
    return r.rows.map(rowToUser);
  }
  async claimNotification(id: number, key: string): Promise<boolean> {
    const r = await this.pool.query(
      'INSERT INTO notification_log (telegram_id, dedupe_key) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [id, key],
    );
    return (r.rowCount ?? 0) === 1;
  }
  async releaseNotification(id: number, key: string): Promise<void> {
    await this.pool.query('DELETE FROM notification_log WHERE telegram_id=$1 AND dedupe_key=$2', [id, key]);
  }
  async pruneNotificationLog(olderThanMs: number): Promise<void> {
    await this.pool.query("DELETE FROM notification_log WHERE sent_at < now() - ($1 || ' milliseconds')::interval", [String(olderThanMs)]);
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
