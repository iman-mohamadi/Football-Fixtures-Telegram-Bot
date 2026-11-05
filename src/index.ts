import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { webhookCallback } from 'grammy';
import { createBot } from './bot/index.js';
import type { Session } from './bot/views.js';
import { loadConfig } from './config/index.js';
import { migrate } from './database/migrate.js';
import { MemoryRepository } from './database/repositories/memory.js';
import { PostgresRepository } from './database/repositories/postgres.js';
import type { Repository } from './database/repositories/types.js';
import { FixtureService } from './services/fixtures/fixtureService.js';
import { FileCacheStore, PostgresCacheStore } from './services/football/cacheStores.js';
import type { PersistentStore } from './services/football/cache.js';
import { UsageTracker } from './services/football/http.js';
import { ApiSportsProvider } from './services/football/providers/apiSports.js';
import { FootballDataProvider } from './services/football/providers/footballData.js';
import type { FootballProvider } from './services/football/providers/interface.js';
import { OpenLigaProvider } from './services/football/providers/openLiga.js';
import { VictoryApiProvider } from './services/football/providers/victoryApi.js';
import { Notifier, UnreachableUserError } from './services/notifications/notifier.js';
import { configureLogger, log } from './utils/logger.js';

// Local development convenience; in Docker/production the variables come from the environment.
if (existsSync('.env')) process.loadEnvFile('.env');

const cfg = loadConfig();
configureLogger(cfg.logLevel, [cfg.botToken, cfg.footballDataToken, cfg.victoryApiKey, cfg.apiFootballKey, cfg.webhookSecret]);

// ── persistence
let repo: Repository;
let cacheStore: PersistentStore;
let pruneCache: (() => Promise<void>) | null = null;
if (cfg.databaseUrl) {
  await migrate(cfg.databaseUrl);
  const pgRepo = PostgresRepository.create(cfg.databaseUrl);
  repo = pgRepo;
  const pgStore = new PostgresCacheStore(pgRepo.pool);
  cacheStore = pgStore;
  pruneCache = () => pgStore.prune(3 * 24 * 3600_000);
} else {
  log.warn('DATABASE_URL not set: using in-memory storage (favorites/settings are lost on restart). Not for production.');
  repo = new MemoryRepository();
  cacheStore = new FileCacheStore(cfg.cacheFile); // API responses still survive restarts
}

// ── providers (priority order = ownership order, see FixtureService docs)
//   0. API-Football (free 100/day, key optional) – Europa/Conference League etc., verified at startup
//   1. Victory API  – Iranian + AFC competitions (paid plan; only when VICTORYAPI_KEY is set; league IDs discovered at runtime)
//   2. football-data.org – international competitions (free token)
//   3. OpenLigaDB   – German competitions, keyless; fallback for BL1 and sole source of BL2/DFB-Pokal
const usage = new UsageTracker();
const providers: FootballProvider[] = [];
if (cfg.victoryApiKey) providers.push(new VictoryApiProvider(cfg.victoryApiKey, { usage }));
if (cfg.apiFootballKey) providers.push(new ApiSportsProvider(cfg.apiFootballKey, { usage }));
if (cfg.footballDataToken) providers.push(new FootballDataProvider(cfg.footballDataToken, { usage }));
else log.warn('FOOTBALL_DATA_TOKEN not set: international competitions limited to what other providers serve.');
if (cfg.enableOpenLiga) providers.push(new OpenLigaProvider({ usage }));
if (!providers.length) throw new Error('No football provider configured. Set FOOTBALL_DATA_TOKEN, VICTORYAPI_KEY and/or ENABLE_OPENLIGADB=true');
const fixtures = new FixtureService(providers, { store: cacheStore });
await fixtures.initProviders();
// Providers that failed discovery (e.g. temporary outage) are retried hourly.
const initTimer = setInterval(() => void fixtures.initProviders(), 60 * 60_000);

const deps = {
  repo,
  fixtures,
  sessions: new Map<number, Session>(),
  defaults: { lang: cfg.defaultLang, timezone: cfg.defaultTimezone },
  now: () => Date.now(),
};
const bot = createBot(cfg, deps);

// ── notifications (once per minute, dedupe is database-backed)
const notifier = new Notifier(repo, fixtures, async (userId, html) => {
  try {
    await bot.api.sendMessage(userId, html, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  } catch (e) {
    const code = (e as { error_code?: number }).error_code;
    if (code === 403 || code === 400) throw new UnreachableUserError((e as Error).message);
    throw e;
  }
});
let ticking = false;
const tickTimer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    const r = await notifier.tick();
    if (r.sent) log.info('notifications sent', r);
    if (new Date().getUTCMinutes() === 0) {
      await repo.pruneNotificationLog(14 * 24 * 3600_000);
      await pruneCache?.();
    }
  } catch (e) {
    log.error('notifier tick failed', { err: e as Error });
  } finally {
    ticking = false;
  }
}, 60_000);

// ── HTTP server: health + webhook
const handleWebhook = cfg.mode === 'webhook' ? webhookCallback(bot, 'http', { secretToken: cfg.webhookSecret! }) : null;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/healthz') {
      // Liveness only: must not spend provider quota (Docker/LB probes hit this every few seconds).
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, usage: usage.snapshot() }));
      return;
    }
    if (req.url === '/healthz/providers') {
      // Active provider check; costs ~1 request per provider. Use sparingly.
      const providers = await fixtures.health();
      const ok = Object.values(providers).some((p) => p.ok);
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok, providers, usage: usage.snapshot() }));
      return;
    }
    if (handleWebhook && req.method === 'POST' && req.url === '/telegram') {
      await handleWebhook(req, res);
      return;
    }
    res.writeHead(404).end();
  } catch (e) {
    log.error('http handler failed', { err: e as Error });
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
server.listen(cfg.port, () => log.info('http server listening', { port: cfg.port, mode: cfg.mode }));

// ── start bot
await bot.api.setMyCommands([
  { command: 'start', description: 'شروع / Start' },
  { command: 'menu', description: 'منوی اصلی / Main menu' },
  { command: 'help', description: 'راهنما / Help' },
]);
if (cfg.mode === 'webhook') {
  await bot.api.setWebhook(`${cfg.webhookUrl!.replace(/\/$/, '')}/telegram`, { secret_token: cfg.webhookSecret!, allowed_updates: ['message', 'callback_query'] });
  await bot.init();
  log.info('webhook configured');
} else {
  await bot.api.deleteWebhook();
  void bot.start({ allowed_updates: ['message', 'callback_query'], onStart: (me) => log.info('polling started', { bot: me.username }) });
}

// ── graceful shutdown
let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { signal });
  clearInterval(tickTimer);
  clearInterval(initTimer);
  const force = setTimeout(() => process.exit(1), 10_000);
  try {
    if (cfg.mode === 'polling') await bot.stop();
    await new Promise<void>((r) => server.close(() => r()));
    if (cacheStore instanceof FileCacheStore) cacheStore.flush();
    await repo.close();
  } catch (e) {
    log.error('shutdown error', { err: e as Error });
  } finally {
    clearTimeout(force);
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => log.error('unhandled rejection', { err: e as Error }));
