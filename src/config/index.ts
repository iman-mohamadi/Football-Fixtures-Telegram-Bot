import { isValidTimeZone } from '../utils/time.js';

export interface Config {
  botToken: string;
  mode: 'polling' | 'webhook';
  webhookUrl: string | null;
  webhookSecret: string | null;
  port: number;
  databaseUrl: string | null;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  footballDataToken: string | null;
  victoryApiKey: string | null;
  apiFootballKey: string | null;
  cacheFile: string;
  enableOpenLiga: boolean;
  defaultTimezone: string;
  defaultLang: 'fa' | 'en';
  adminIds: number[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: { requireToken?: boolean } = {}): Config {
  const requireToken = opts.requireToken ?? true;
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  if (requireToken && !botToken) throw new Error('TELEGRAM_BOT_TOKEN is required');

  const mode = (env.BOT_MODE ?? 'polling') as Config['mode'];
  if (mode !== 'polling' && mode !== 'webhook') throw new Error('BOT_MODE must be "polling" or "webhook"');
  const webhookUrl = env.WEBHOOK_URL?.trim() || null;
  const webhookSecret = env.WEBHOOK_SECRET?.trim() || null;
  if (mode === 'webhook' && (!webhookUrl || !webhookSecret)) {
    throw new Error('WEBHOOK_URL and WEBHOOK_SECRET are required in webhook mode');
  }

  const tz = env.DEFAULT_TIMEZONE?.trim() || 'Asia/Tehran';
  if (!isValidTimeZone(tz)) throw new Error(`Invalid DEFAULT_TIMEZONE: ${tz}`);
  const lang = (env.DEFAULT_LANG ?? 'fa') as 'fa' | 'en';
  if (lang !== 'fa' && lang !== 'en') throw new Error('DEFAULT_LANG must be fa or en');

  const level = (env.LOG_LEVEL ?? 'info') as Config['logLevel'];
  return {
    botToken,
    mode,
    webhookUrl,
    webhookSecret,
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL?.trim() || null,
    logLevel: ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
    footballDataToken: env.FOOTBALL_DATA_TOKEN?.trim() || null,
    victoryApiKey: env.VICTORYAPI_KEY?.trim() || null,
    apiFootballKey: env.API_FOOTBALL_KEY?.trim() || null,
    cacheFile: env.CACHE_FILE?.trim() || '.cache/football-cache.json',
    enableOpenLiga: (env.ENABLE_OPENLIGADB ?? 'true') !== 'false',
    defaultTimezone: tz,
    defaultLang: lang,
    adminIds: (env.ADMIN_IDS ?? '').split(',').map((s) => Number(s.trim())).filter(Boolean),
  };
}
