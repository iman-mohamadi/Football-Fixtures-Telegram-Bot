import { Bot, GrammyError, InlineKeyboard, Keyboard, type Context } from 'grammy';
import type { Config } from '../config/index.js';
import { log } from '../utils/logger.js';
import { clampText } from '../utils/pagination.js';
import type { User } from '../database/repositories/types.js';
import { messages, m } from '../i18n/index.js';
import { entryView, handleText, mainMenuView, route, type Deps, type View } from './views.js';

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

export function persistentKeyboard(lang: User['lang']): Keyboard {
  const b = m(lang).btn;
  return new Keyboard().text(b.today).text(b.tomorrow).text(b.live).row().text(b.home).persistent().resized();
}

/** reply-keyboard label → router data, for both languages */
function labelMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const lang of ['fa', 'en'] as const) {
    const b = messages[lang].btn;
    map.set(b.today, 'today');
    map.set(b.tomorrow, 'tomorrow');
    map.set(b.live, 'lv');
    map.set(b.home, 'menu');
  }
  return map;
}

function isNotModified(e: unknown): boolean {
  return e instanceof GrammyError && /message is not modified/i.test(e.description);
}

export function createBot(cfg: Config, deps: Deps): Bot {
  const bot = new Bot(cfg.botToken);
  const labels = labelMap();
  /** per-user in-flight guard: ignores rapid repeated presses while one is being processed */
  const busy = new Set<number>();

  async function userOf(ctx: Context): Promise<User | null> {
    const id = ctx.from?.id;
    if (!id) return null;
    const u = await deps.repo.getOrCreateUser(id, deps.defaults);
    if (u.blocked) {
      await deps.repo.updateUser(id, { blocked: false });
      u.blocked = false;
    }
    return u;
  }

  async function sendView(ctx: Context, view: View, markup = true): Promise<void> {
    await ctx.reply(clampText(view.text), { ...HTML, ...(markup ? { reply_markup: view.kb } : {}) });
  }

  bot.catch((err) => {
    log.error('bot handler error', { err: err.error as Error, update: err.ctx.update.update_id });
  });

  bot.command('start', async (ctx) => {
    const user = await userOf(ctx);
    if (!user) return;
    // First run: language picker ONLY (no menu, no reply keyboard) until a language is chosen.
    if (!user.langSelected) {
      await sendView(ctx, entryView(user));
      return;
    }
    await ctx.reply('⚽', { reply_markup: persistentKeyboard(user.lang) });
    await sendView(ctx, mainMenuView(user));
  });

  bot.command('menu', async (ctx) => {
    const user = await userOf(ctx);
    if (user) await sendView(ctx, entryView(user));
  });

  bot.command('help', async (ctx) => {
    const user = await userOf(ctx);
    if (!user) return;
    const r = await route('hp', user, deps);
    if (r) await sendView(ctx, r.view);
  });

  bot.on('callback_query:data', async (ctx) => {
    const id = ctx.from.id;
    // Always answer quickly so Telegram stops the spinner.
    if (busy.has(id)) {
      await ctx.answerCallbackQuery().catch(() => undefined);
      return;
    }
    busy.add(id);
    try {
      const user = await userOf(ctx);
      if (!user) return;
      await ctx.answerCallbackQuery().catch(() => undefined);

      const work = route(ctx.callbackQuery.data, user, deps);
      // Loading feedback only when the work is slow (cache miss).
      let done = false;
      const timer = setTimeout(() => {
        if (!done) void ctx.editMessageText(m(user.lang).loading, HTML).catch(() => undefined);
      }, 700);
      let result: Awaited<typeof work>;
      try {
        result = await work;
      } finally {
        done = true;
        clearTimeout(timer);
      }

      if (!result) {
        const v = mainMenuView(user);
        await ctx.editMessageText(`${m(user.lang).expired}\n\n${v.text}`, { ...HTML, reply_markup: v.kb }).catch(() => undefined);
        return;
      }
      try {
        await ctx.editMessageText(clampText(result.view.text), { ...HTML, reply_markup: result.view.kb });
      } catch (e) {
        if (!isNotModified(e)) throw e;
      }
      // First language selection, or language changed → (re)install the persistent keyboard in the right language.
      if (result.onboarded || result.user.lang !== user.lang) {
        await ctx.reply('⚽', { reply_markup: persistentKeyboard(result.user.lang) }).catch(() => undefined);
      }
    } catch (e) {
      log.error('callback failed', { err: e as Error, data: ctx.callbackQuery.data });
      const user = await deps.repo.getUser(id).catch(() => null);
      const text = m(user?.lang ?? deps.defaults.lang).errorGeneric;
      await ctx.editMessageText(text, { ...HTML, reply_markup: new InlineKeyboard().text(m(user?.lang ?? 'fa').btn.home, 'menu') }).catch(() => undefined);
    } finally {
      busy.delete(id);
    }
  });

  bot.on('message:text', async (ctx) => {
    const user = await userOf(ctx);
    if (!user) return;
    const text = ctx.message.text;
    const data = labels.get(text);
    try {
      if (data) {
        const r = await route(data, user, deps);
        if (r) await sendView(ctx, r.view);
        return;
      }
      const r = await handleText(text, user, deps);
      if (r) {
        await sendView(ctx, r.view);
        return;
      }
      const v = mainMenuView(user);
      await ctx.reply(`${m(user.lang).textFallback}\n\n${v.text}`, { ...HTML, reply_markup: v.kb });
    } catch (e) {
      log.error('message handler failed', { err: e as Error });
      await ctx.reply(m(user.lang).errorGeneric).catch(() => undefined);
    }
  });

  return bot;
}
