import { loadConfig } from '../config/index.js';
import { migrate } from './migrate.js';

import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const cfg = loadConfig(process.env, { requireToken: false });
if (!cfg.databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const applied = await migrate(cfg.databaseUrl);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply');
