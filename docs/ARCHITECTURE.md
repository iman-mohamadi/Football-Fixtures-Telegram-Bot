# Architecture

Node.js 20+ · TypeScript (ESM) · [grammY](https://grammy.dev) · PostgreSQL (in-memory repository for dev/tests) · Vitest.
grammY was chosen over Telegraf for first-class TypeScript types, a small core and a clean `webhookCallback`.
No Redis: caching is process-local (the bot is a single process; the dedupe ledger for notifications is in PostgreSQL, so several replicas would still never double-send). Add Redis only if you run multiple replicas and want a shared cache.

```
src/
  index.ts                 wiring, HTTP server (/healthz, /telegram webhook), notifier timer, graceful shutdown
  config/                  env parsing/validation
  i18n/                    t(lang), locales/fa.ts, locales/en.ts  (see I18N.md)
  bot/
    index.ts               grammY handlers: /start, callbacks (busy-guard, loading feedback, not-modified), text
    views.ts               ALL screens + callback router (pure: returns {text, keyboard}); fully unit-tested
    format.ts              fixture rendering (sections, grouping, RTL isolates, localized names)
  services/
    football/              providers (football-data, OpenLigaDB, Victory API), adapters (raw → Fixture),
                           http (timeout, retry/backoff, 429, limiter, usage), cache (TTL + dedupe + stale), competitions
    fixtures/              FixtureService (routing, caches), effectiveStatus (clock sanity), team matching
    teams/                 localization catalog
    notifications/         Notifier (daily, favorites, competitions, reminders, postponements)
  database/                migrations/*.sql, migrate runner, repositories (postgres, memory)
  utils/                   time (Intl-based zones, Jalali), pagination, logger (secret scrubbing), text
tests/                     154 deterministic tests with mocked HTTP
```

## Normalized model
`Fixture { id, provider, providerMatchId, competitionCode/Id/Name/Logo, homeTeam/awayTeam (+Key, Logo), kickoffUtc | null, status, minute, homeScore | null, awayScore | null, venue | null, events, updatedAt }`.
Missing data is `null`, never a default: no kickoff is fabricated, a missing score is never 0‑0 (adapters drop half-filled scores), a venue is shown only if the provider sent one.
IDs are `fd:`, `ol:`, `va:` + provider id, so they are stable and provider-scoped.

## Provider routing (explicit rules, no merging)
`FixtureService([victoryapi?, footballdata?, openligadb?])` – the array order **is** the priority.
1. A competition code is *owned* by the first provider that currently declares it (`provider.competitions` can be dynamic – Victory discovers its league IDs at startup).
2. Fixtures of a code come only from its owner → two providers can never yield duplicate/conflicting copies of one match. Cross-provider name matching is deliberately not used.
3. If the owner fails, the next provider declaring that code serves it as fallback (its own ids and provenance preserved: `fixture.provider`).
4. If nobody can serve a code it is omitted and the result is flagged `partial` (UI shows a warning). If everything fails and nothing is cached → error view with retry.
5. Other: Bundesliga → football-data (owner) / OpenLigaDB (fallback); 2. Bundesliga + DFB‑Pokal → OpenLigaDB only; Iranian + AFC → Victory only.
Optional capabilities per provider: `getLive` (overlay for fresher live data), `getStandings`.
Health: `/healthz` is liveness only (no quota); `/healthz/providers` actively checks each provider.

## Reliability
- `getJson`: timeout, ≤3 attempts, exponential backoff on 5xx/network/invalid JSON, `Retry-After` on 429, no retry on 4xx; sliding-window `RateLimiter` (football-data 9/min, Victory 20/min); `UsageTracker` per provider/day (+ remaining header).
- `TtlCache`: request de-duplication; on refresh failure serves the previous value flagged `stale` (up to 6h). Views print “data may be outdated (last update HH:mm)” whenever data is stale or older than 15 min.
- `effectiveStatus`: a “live” match whose kickoff is >10 min in the future or >4 h in the past is `unknown`; a “scheduled” match >3 h past kickoff is `unknown`. Live list uses this, so upcoming/finished matches are never shown as live. OpenLigaDB has no live flag and is never reported live.
- TTLs: today 5 min (1 min while live), other days 20 min, window 20 min, live list 1 min, competition 20 min, standings 30 min, detail 1 min.

## UX mechanics
- First `/start`: language picker only; main menu + persistent reply keyboard (Today / Tomorrow / Live / Main menu) after selection.
- One message per navigation, edited in place; “message is not modified” ignored; per-user in-flight lock ignores rapid repeated taps; loading text appears only if a call takes >700 ms.
- Callback data is compact and validated (`d:<date>:<page>:<origin>`, `lg:x:<code>:<mode>:<page>`, `fv:a:<teamKey>`…). Mutations carry the **target value** (`nt:t:daily:1`, `rm:<id>:0`), so stale keyboards cannot flip state. Unknown data → “expired” + main menu.
- Pagination by item count and character budget; hard clamp to Telegram's 4096 limit.

## Notifications
Single in-process tick per minute. Every send first *claims* `(user, dedupe_key)` in `notification_log` (PK) and releases the claim if the send fails. Keys: `daily:<date>`, `comps:<date>`, `favs:<date>`, `rem:<fixtureId>:<kickoffUtc>` (rescheduled matches are reminded again at the new time), `pp:<fixtureId>:<status>`. Nothing is sent unless enabled; explicit per-match 🔔 requests work independently and are cleared after a postponement/cancellation notice. 403/400 from Telegram marks the user `blocked` (cleared when they message the bot again).

## Database
`users(telegram_id, lang, lang_selected, timezone, default_view, notif_daily|favorites|reminders|competitions, blocked, …)`, `favorite_teams(telegram_id, team_key, team_name)`, `notification_competitions`, `notification_log`, `match_reminders`, `schema_migrations`. Migrations in `src/database/migrations`, applied automatically at startup under an advisory lock (`npm run migrate` also available).

## Known limitations
See README → “Limitations”.
