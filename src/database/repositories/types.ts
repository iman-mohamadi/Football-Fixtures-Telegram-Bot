export type DefaultView = 'grouped' | 'by_time';
export type NotifKind = 'daily' | 'favorites' | 'reminders' | 'competitions';
export const NOTIF_KINDS: NotifKind[] = ['daily', 'favorites', 'reminders', 'competitions'];

export interface User {
  telegramId: number;
  lang: 'fa' | 'en';
  timezone: string;
  defaultView: DefaultView;
  notif: Record<NotifKind, boolean>;
  blocked: boolean;
  /** false until the user explicitly picked a language on first /start */
  langSelected: boolean;
}

export interface FavoriteTeam {
  key: string;
  name: string;
}

export interface UserDefaults {
  lang: 'fa' | 'en';
  timezone: string;
}

export interface Repository {
  getOrCreateUser(id: number, defaults: UserDefaults): Promise<User>;
  getUser(id: number): Promise<User | null>;
  updateUser(id: number, patch: Partial<Pick<User, 'lang' | 'timezone' | 'defaultView' | 'blocked' | 'langSelected'>>): Promise<void>;
  setNotif(id: number, kind: NotifKind, enabled: boolean): Promise<void>;

  listFavorites(id: number): Promise<FavoriteTeam[]>;
  addFavorite(id: number, team: FavoriteTeam): Promise<void>;
  removeFavorite(id: number, key: string): Promise<void>;

  listNotifCompetitions(id: number): Promise<string[]>;
  setNotifCompetition(id: number, code: string, enabled: boolean): Promise<void>;

  setMatchReminder(id: number, fixtureId: string, enabled: boolean): Promise<void>;
  hasMatchReminder(id: number, fixtureId: string): Promise<boolean>;
  /** (user, fixture) pairs for the given fixtures; only unblocked users. */
  matchRemindersFor(fixtureIds: string[]): Promise<{ user: User; fixtureId: string }[]>;
  /** Fixtures a user asked to be reminded about (for postponement notices). */
  allMatchReminders(): Promise<{ user: User; fixtureId: string }[]>;

  /** Users with the given notification enabled and not blocked. */
  usersWithNotif(kind: NotifKind): Promise<User[]>;
  /** Atomically claims the key. Returns true only for the first caller (=> send), false if already sent. */
  claimNotification(id: number, dedupeKey: string): Promise<boolean>;
  /** Releases a claim after a failed send so a later tick can retry. */
  releaseNotification(id: number, dedupeKey: string): Promise<void>;
  pruneNotificationLog(olderThanMs: number): Promise<void>;
  close(): Promise<void>;
}
