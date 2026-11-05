CREATE TABLE IF NOT EXISTS users (
  telegram_id        BIGINT PRIMARY KEY,
  lang               TEXT NOT NULL DEFAULT 'fa' CHECK (lang IN ('fa','en')),
  timezone           TEXT NOT NULL DEFAULT 'Asia/Tehran',
  default_view       TEXT NOT NULL DEFAULT 'grouped' CHECK (default_view IN ('grouped','by_time')),
  notif_daily        BOOLEAN NOT NULL DEFAULT FALSE,
  notif_favorites    BOOLEAN NOT NULL DEFAULT FALSE,
  notif_reminders    BOOLEAN NOT NULL DEFAULT FALSE,
  notif_competitions BOOLEAN NOT NULL DEFAULT FALSE,
  blocked            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS favorite_teams (
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  team_key    TEXT NOT NULL,
  team_name   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_id, team_key)
);

CREATE TABLE IF NOT EXISTS notification_competitions (
  telegram_id      BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  competition_code TEXT NOT NULL,
  PRIMARY KEY (telegram_id, competition_code)
);

-- Dedup ledger: a notification is sent only if its (user, dedupe_key) row can be inserted.
CREATE TABLE IF NOT EXISTS notification_log (
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  dedupe_key  TEXT NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS notification_log_sent_at_idx ON notification_log (sent_at);
