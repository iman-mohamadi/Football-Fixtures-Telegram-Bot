import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { log } from '../utils/logger.js';

/** Applies *.sql files in lexical order, once each, inside transactions. */
export async function migrate(databaseUrl: string): Promise<string[]> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    // Prevent concurrent runners (e.g. two replicas starting together)
    await client.query('SELECT pg_advisory_lock(727274)');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r: { name: string }) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(dir, f), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        applied.push(f);
        log.info('migration applied', { file: f });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
    await client.end();
  }
  return applied;
}
