type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let minLevel: Level = 'info';
const secrets: string[] = [];

export function configureLogger(level: Level, redact: (string | null | undefined)[] = []): void {
  minLevel = level;
  for (const s of redact) if (s && s.length > 6) secrets.push(s);
}

function scrub(s: string): string {
  let out = s;
  for (const sec of secrets) out = out.split(sec).join('***');
  return out.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, 'bot***');
}

function emit(level: Level, msg: string, ctx?: Record<string, unknown>): void {
  if (order[level] < order[minLevel] || process.env.VITEST) return;
  const line = scrub(JSON.stringify({ t: new Date().toISOString(), level, msg, ...ctx, ...errCtx(ctx) }));
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
}

function errCtx(ctx?: Record<string, unknown>): Record<string, unknown> {
  const e = ctx?.err;
  if (e instanceof Error) return { err: e.message, errName: e.name, stack: e.stack?.split('\n').slice(0, 4).join(' | ') };
  return {};
}

export const log = {
  debug: (m: string, c?: Record<string, unknown>) => emit('debug', m, c),
  info: (m: string, c?: Record<string, unknown>) => emit('info', m, c),
  warn: (m: string, c?: Record<string, unknown>) => emit('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => emit('error', m, c),
};
