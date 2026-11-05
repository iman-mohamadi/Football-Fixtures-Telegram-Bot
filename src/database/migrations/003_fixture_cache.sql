-- Persistent API-response cache: survives restarts and is shared by replicas, so quota is not re-spent.
CREATE TABLE IF NOT EXISTS fixture_cache (
  key        TEXT PRIMARY KEY,
  payload    JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS fixture_cache_fetched_idx ON fixture_cache (fetched_at);
