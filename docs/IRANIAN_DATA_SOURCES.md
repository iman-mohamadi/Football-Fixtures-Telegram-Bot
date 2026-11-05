# Iranian football data sources

Research date: **2026-11-06**. Rule followed: *a website is not an API*. No scraping, no anti-bot bypass, nothing purchased, no account created.

## Findings

| Source | What it is | Usable API? | Free? | Verdict |
|---|---|---|---|---|
| **Victory API** – victoryapi.ir | Commercial web service, base `https://api.v1.victoryapi.ir`, header `x-vapi-key`. Docs list: status, timezones, countries, leagues, seasons, teams (+statistics), venues, players, standings, rounds, fixtures (+h2h, statistics, events, lineups), coaches. Response layout follows the common `fixture / league / teams / goals` structure shown in its docs. Marketing pages: "Persian Gulf Pro League API", "Live Football API". | **Yes** (documented, keyed) | Free "test" plan = **300 req/day, English league only**. Iranian football API is listed under paid plans: 750 req/day = 700,000 Toman/month, up to 55,000 req/day = 5,100,000 Toman/month | **Integrated as an optional provider** (`VICTORYAPI_KEY`). Not live-verified – requires a paid plan and an account, which we may not create or buy. |
| **Majid API** – majidapi.ir | Persian web-service marketplace (Football360 / Varzesh3 / Footballi wrappers according to the task) | The site displayed a maintenance page ("سامانه در حال به‌روزرسانی است"); the documentation URLs returned **404**; paid "ویژه" subscriptions exist | Unknown | **Cannot be evaluated.** Important caveat: wrappers around Football360/Varzesh3/Footballi data may not carry redistribution rights from the original sites. Do not depend on it before confirming terms with the owner (contact channel on the site: t.me/majidapi). |
| **football360.ir** | Consumer website/app (news, video, scores) | No public API found | – | Not a data source. Scraping not allowed by our rules. |
| **varzesh3.com** | Consumer website | No public API found | – | Not a data source. |
| **soot360.com** | Consumer website with live scores, Iranian league tables | No public API found | – | Not a data source. (Used only to read public Persian spellings of club names for the team catalog.) |
| **footba11.co** | Consumer website, scores for 100+ countries | No public API found | – | Not a data source. |
| **GitHub / OSS** | Searched for Iranian league fixture APIs | Nothing maintained and legitimately licensed found (only scrapers, which we do not use) | – | None. |
| **TheSportsDB** | Lists *Persian Gulf Pro League* (id 4742), *Azadegan* (4741) | Free key returned **0 events** for the Iranian league | – | Rejected for Iran. |
| **TheStatsAPI / FootyStats** | Commercial APIs advertising Iranian leagues (trial / paid) | Not investigated beyond marketing pages | Trial only | Possible alternatives for a future adapter; unverified. |

## Competition coverage per the Victory API coverage page
Coverage page lists (names as published, Persian UI): World Cup + all qualifiers, AFC Champions League Elite and Two, AFC Challenge, Asian Cup youth tournaments, friendlies, and country leagues. Whether *Azadegan*, *Hazfi Cup*, *Super Cup*, *League 2* and the women's league are included, and with which exact names, depends on the plan and cannot be confirmed without a key.

## How the bot handles this honestly
- League IDs are **never hardcoded**. `VictoryApiProvider.init()` looks up Iran in `/countries`, lists its leagues from `/leagues?countryId=…`, and maps each canonical code (`IR1` Persian Gulf Pro League, `IR2` Azadegan, `IRC` Hazfi Cup, `IRS` Super Cup, `IR3` League 2, `IRW` women's league) only when **exactly one** league name matches. Ambiguous or missing leagues are skipped and logged.
- AFC Champions League Elite/Two (`AFCE`, `AFC2`) use a best-effort `/leagues?name=AFC Champions League` search; failure just means the section stays hidden.
- With no `VICTORYAPI_KEY`, the 🇮🇷 section explains that no Iranian data source is enabled, instead of showing fake or empty competitions.
- API plan/permission errors (`errors` in the JSON envelope) surface as errors, never as "no matches".
- Iran national teams (men/women/youth) are **not offered**: no verified source for them. They can be added when a provider with team search for Iran is verified.

## Legal / usage notes
- None of the investigated Iranian services states, on the pages we could read, whether public Telegram-bot redistribution is permitted. Ask the provider in writing before launching publicly. Victory API support: Support@victoryapi.ir.
- Do not scrape Varzesh3, Football360, Soot360 or Footba11 for data; they are consumer sites with their own terms.
- Persian team spellings in `src/services/teams/catalog.ts` are facts (names), not copied datasets.

## What you need to do to enable Iranian football
1. Register at victoryapi.ir (free) and choose a plan that includes Iranian football. Confirm in writing that bot use is allowed.
2. Put the key in `VICTORYAPI_KEY` and restart. Check the startup log line `victoryapi competitions verified` – it lists exactly which competitions were found.
3. Review `docs/I18N.md` → "Team localization" and add the exact English spellings your plan returns for Iranian clubs to the catalog (matching is exact on purpose).
