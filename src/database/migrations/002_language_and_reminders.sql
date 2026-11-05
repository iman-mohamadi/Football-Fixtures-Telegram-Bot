-- First-run language selection must be remembered; existing rows already chose implicitly.
ALTER TABLE users ADD COLUMN IF NOT EXISTS lang_selected BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET lang_selected = TRUE;

-- Per-match "Remind me" requests. Dedupe of the actual send lives in notification_log.
CREATE TABLE IF NOT EXISTS match_reminders (
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  fixture_id  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_id, fixture_id)
);
CREATE INDEX IF NOT EXISTS match_reminders_fixture_idx ON match_reminders (fixture_id);
