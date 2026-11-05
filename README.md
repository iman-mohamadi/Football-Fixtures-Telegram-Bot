# ⚽ Football Center — Telegram fixtures bot / ربات فوتبال سنتر

## فارسی
ربات تلگرامی برنامه و نتایج فوتبال با رابط کاملاً دوزبانه (فارسی / English). در اولین `/start` ابتدا زبان پرسیده می‌شود و انتخاب شما در پایگاه داده ذخیره می‌شود. تاریخ‌ها در حالت فارسی شمسی و با ارقام فارسی نمایش داده می‌شوند و ساعت بازی‌ها بر اساس منطقه زمانی خودتان (پیش‌فرض تهران) است.

**امکانات:** فوتبال ایران (در صورت فعال بودن منبع داده) · فوتبال جهان (لیگ‌ها، برنامه، نتایج، جدول) · مسابقات زنده · امروز / فردا / تقویم ۷ روزه · تیم‌های محبوب (جستجو به فارسی و انگلیسی) · اعلان‌های اختیاری (برنامه روزانه، تیم‌های محبوب، لیگ‌های انتخابی، یادآوری شروع بازی) · دکمهٔ «یادآوری» برای هر مسابقه · تنظیمات (زبان، منطقه زمانی، نمایش).

> ⚠️ لیگ برتر خلیج فارس و سایر رقابت‌های ایرانی در هیچ API رایگانِ تأییدشده‌ای موجود نیستند. این بخش فقط با کلید اشتراکی Victory API (`VICTORYAPI_KEY`) فعال می‌شود؛ بدون آن، ربات رقابت‌های ایرانی را نمایش نمی‌دهد (نه داده‌ی ساختگی). جزئیات: [docs/IRANIAN_DATA_SOURCES.md](docs/IRANIAN_DATA_SOURCES.md).

## English
A Telegram bot for football fixtures, live scores, results and tables with a fully bilingual interface. The first `/start` asks for a language (stored in the database); Persian mode uses the Jalali calendar and Persian digits; kickoff times follow each user's timezone (language and timezone are independent).

**Features:** Iranian football (when a data source is configured) · World football (leagues, fixtures, results, standings) · Live matches · Today / Tomorrow / 7-day calendar · Favorite teams (Persian or English search) · Optional notifications (daily schedule, favorites digest, selected competitions, kickoff reminders) · per-match “Remind me” · Settings (language, timezone, display).

> ⚠️ Iranian competitions are **not** available from any verified free API. They need a paid Victory API key (`VICTORYAPI_KEY`); without it the Iranian section says so instead of showing fake data. See [docs/IRANIAN_DATA_SOURCES.md](docs/IRANIAN_DATA_SOURCES.md).

## Requirements
Node.js ≥ 20.12 (full ICU, default). PostgreSQL 14+ for production (optional for development).

## Installation
```bash
npm install
cp .env.example .env      # fill in TELEGRAM_BOT_TOKEN (+ optional keys below)
npm run dev               # development, long polling, in-memory storage if DATABASE_URL is empty
```
Production:
```bash
npm run build
DATABASE_URL=postgres://… npm run migrate   # optional: migrations also run automatically on start
npm start
```
Docker: `docker compose up -d --build` (set `POSTGRES_PASSWORD` and the variables in `.env`). Webhook mode: `BOT_MODE=webhook`, `WEBHOOK_URL=https://your.host`, `WEBHOOK_SECRET=<random>`; the bot registers `<WEBHOOK_URL>/telegram`. Health: `GET /healthz` (liveness, no API quota), `GET /healthz/providers` (active check).

## Environment variables
| Variable | Required | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | BotFather token |
| `BOT_MODE` | no | `polling` (default) or `webhook` |
| `WEBHOOK_URL`, `WEBHOOK_SECRET` | webhook mode | public HTTPS base URL, random secret header |
| `PORT` | no | HTTP port (default 3000) |
| `DATABASE_URL` | production | PostgreSQL URL; empty = in-memory (dev only) |
| `FOOTBALL_DATA_TOKEN` | recommended | free football-data.org token – international leagues |
| `ENABLE_OPENLIGADB` | no | keyless German data (default `true`) |
| `VICTORYAPI_KEY` | optional (paid) | Iranian + AFC competitions |
| `DEFAULT_TIMEZONE`, `DEFAULT_LANG`, `LOG_LEVEL` | no | fallbacks / logging |

Secrets are only read from the environment; logs scrub the configured tokens.

## Tests
```bash
npm test          # 154 deterministic tests, all HTTP mocked
npm run typecheck
```

## Limitations
- football-data.org and Victory API adapters are tested with **mocked responses only** (no token/key was available during development). Verify with your own keys before launch.
- football-data.org free tier: 10 req/min, delayed scores; no Europa/Conference League; no Iranian or AFC competitions.
- Iran national teams are not offered (no verified source). Team/competition logos are modeled but not rendered (Telegram text messages cannot embed images).
- Persian team names exist only for the catalog in `src/services/teams/catalog.ts`; other teams stay in Latin script.
- Lineups and match events are shown only when a provider supplies them (goals from OpenLigaDB). Team search covers teams playing in the next 10 days.
- Cache is per process; for several replicas add a shared cache (notification dedupe is already database-backed).
- Dockerfile/compose were written but not built in this environment (Docker was not installed).

## Docs
[API research](docs/API_RESEARCH.md) · [Iranian data sources](docs/IRANIAN_DATA_SOURCES.md) · [Architecture](docs/ARCHITECTURE.md) · [i18n](docs/I18N.md)
