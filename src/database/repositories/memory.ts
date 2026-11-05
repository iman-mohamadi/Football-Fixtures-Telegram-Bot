import type { FavoriteTeam, NotifKind, Repository, User, UserDefaults } from './types.js';

/** In-memory repository for tests and zero-setup development. Data is lost on restart. */
export class MemoryRepository implements Repository {
  private users = new Map<number, User>();
  private favs = new Map<number, FavoriteTeam[]>();
  private comps = new Map<number, Set<string>>();
  private log = new Map<string, number>();
  private reminders = new Set<string>();

  async getOrCreateUser(id: number, d: UserDefaults): Promise<User> {
    let u = this.users.get(id);
    if (!u) {
      u = {
        telegramId: id,
        lang: d.lang,
        timezone: d.timezone,
        defaultView: 'grouped',
        notif: { daily: false, favorites: false, reminders: false, competitions: false },
        blocked: false,
        langSelected: false,
      };
      this.users.set(id, u);
    }
    return structuredClone(u);
  }
  async getUser(id: number): Promise<User | null> {
    const u = this.users.get(id);
    return u ? structuredClone(u) : null;
  }
  async updateUser(id: number, patch: Partial<Pick<User, 'lang' | 'timezone' | 'defaultView' | 'blocked' | 'langSelected'>>): Promise<void> {
    const u = this.users.get(id);
    if (u) Object.assign(u, patch);
  }
  async setNotif(id: number, kind: NotifKind, enabled: boolean): Promise<void> {
    const u = this.users.get(id);
    if (u) u.notif[kind] = enabled;
  }
  async listFavorites(id: number): Promise<FavoriteTeam[]> {
    return structuredClone(this.favs.get(id) ?? []);
  }
  async addFavorite(id: number, team: FavoriteTeam): Promise<void> {
    const list = this.favs.get(id) ?? [];
    if (!list.some((t) => t.key === team.key)) list.push({ ...team });
    this.favs.set(id, list);
  }
  async removeFavorite(id: number, key: string): Promise<void> {
    this.favs.set(id, (this.favs.get(id) ?? []).filter((t) => t.key !== key));
  }
  async listNotifCompetitions(id: number): Promise<string[]> {
    return [...(this.comps.get(id) ?? [])];
  }
  async setNotifCompetition(id: number, code: string, enabled: boolean): Promise<void> {
    const s = this.comps.get(id) ?? new Set<string>();
    if (enabled) s.add(code);
    else s.delete(code);
    this.comps.set(id, s);
  }
  async setMatchReminder(id: number, fixtureId: string, enabled: boolean): Promise<void> {
    const k = `${id}|${fixtureId}`;
    if (enabled) this.reminders.add(k);
    else this.reminders.delete(k);
  }
  async hasMatchReminder(id: number, fixtureId: string): Promise<boolean> {
    return this.reminders.has(`${id}|${fixtureId}`);
  }
  async allMatchReminders(): Promise<{ user: User; fixtureId: string }[]> {
    const out: { user: User; fixtureId: string }[] = [];
    for (const k of this.reminders) {
      const i = k.indexOf('|');
      const u = this.users.get(Number(k.slice(0, i)));
      if (u && !u.blocked) out.push({ user: structuredClone(u), fixtureId: k.slice(i + 1) });
    }
    return out;
  }
  async matchRemindersFor(fixtureIds: string[]): Promise<{ user: User; fixtureId: string }[]> {
    const set = new Set(fixtureIds);
    return (await this.allMatchReminders()).filter((r) => set.has(r.fixtureId));
  }
  async usersWithNotif(kind: NotifKind): Promise<User[]> {
    return [...this.users.values()].filter((u) => u.notif[kind] && !u.blocked).map((u) => structuredClone(u));
  }
  async claimNotification(id: number, key: string): Promise<boolean> {
    const k = `${id}|${key}`;
    if (this.log.has(k)) return false;
    this.log.set(k, Date.now());
    return true;
  }
  async releaseNotification(id: number, key: string): Promise<void> {
    this.log.delete(`${id}|${key}`);
  }
  async pruneNotificationLog(olderThanMs: number): Promise<void> {
    const cutoff = Date.now() - olderThanMs;
    for (const [k, t] of this.log) if (t < cutoff) this.log.delete(k);
  }
  async close(): Promise<void> {}
}
