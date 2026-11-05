# API research

Research date: **2026-11-06**. "Tested" = a real HTTP request was made from this project's machine. "Documented" = taken from the provider's own page but not exercised. Nothing was purchased and no account was created. Iranian providers are covered in depth in [IRANIAN_DATA_SOURCES.md](IRANIAN_DATA_SOURCES.md).

## Comparison

| Provider | Free plan | Limits | Current season fixtures | Live | Logos | Auth | Public-bot use | Verdict |
|---|---|---|---|---|---|---|---|---|
| **football-data.org** | Permanent ("Free. Forever" on the coverage page), 12 competitions | **10 req/min**, scores delayed | Yes (documented) | Delayed on free tier | crests + emblems | Free token (`X-Auth-Token`) | Terms not stated on pricing page; contact owner for commercial use | **Primary** (international) – *not live-tested, no token* |
| **OpenLigaDB** | Free, community project | none published | **Tested**: Bundesliga 2026 = 306 matches, plus 2. Bundesliga and DFB-Pokal | No live flag (finished flag only) | Yes (team icons) | None | Open data, no stated restriction | **Fallback** (German only) |
| **TheSportsDB** | Free key `123` | 30 req/min | **Unusable on free key** (see below) | Premium only | Yes | key in URL | Free key is for testing | Rejected |
| **API-Football / API-Sports** | 100 req/day, "entire API" | per-minute cap exists (number not on official pages) | Not tested (official pricing page returned 403 to our fetcher; needs account) | Yes | Yes | Account + key | Not verified | Candidate if a key is obtained; not integrated |
| **Sportmonks** | v3: **14-day trial only**. Legacy v2 free plan = Danish Superliga + Scottish Premiership | n/a | Not relevant | – | – | – | – | Rejected (not permanent / no target leagues) |
| **Victory API** (Iran) | Free test plan: 300 req/day, **English league only** | Iranian leagues on paid plans (from 700,000 Toman/month) | Not testable without a paid key | `fixtures?live=all` documented | Yes | Account + `x-vapi-key` | Not stated | Optional paid provider – implemented, **unverified live** |
| **Majid API** (Iran) | Site was in "maintenance"; docs URLs 404 | – | – | – | – | – | – | Cannot be evaluated |

## What was actually tested

### TheSportsDB (key `123`)
| Request | Result |
|---|---|
| `eventsnextleague.php?id=4328/4335/4332/4331/4334/4337/4344` (EPL, La Liga, Serie A, Bundesliga, Ligue 1, Eredivisie, Primeira Liga) | HTTP 200, **exactly 1 event each** (free limit). Fields valid: id, teams, timestamp, season 2026-2027, badges |
| same, UCL 4480 / UEL 4481 | 1 event each, dated 2026-11-24 / 2026-11-26 |
| `eventsday.php?d=2026-11-07&s=Soccer` | **3 events** total regardless of the ~100 matches that day |
| `eventsseason.php?id=4331&s=2026-2027` (Bundesliga) | 15 events, all `FT`, last one 2026-09-05 → **truncated; upcoming matches missing** |
| `search_all_leagues.php?c=Iran` | Lists *Persian Gulf Pro League* (4742) and *Azadegan League* (4741) |
| Persian Gulf Pro League next events / season events | **0 events** |
| `livescore.php?s=Soccer` | Returned live matches once (Copa Chile etc.); empty on re-test |
| Rate limiting | Repeated **HTTP 429** during a handful of sequential requests |

**Conclusion:** the free key cannot deliver a day's fixtures, the upcoming season, or Iranian fixtures. Rejected as a data source.

### OpenLigaDB (no key)
- `getmatchdata/bl1/2026` → 306 matches; fields: `matchID`, `matchDateTimeUTC`, teams with icons, `matchIsFinished`, `matchResults` (half-time + final), `goals` with minute/scorer/penalty/own-goal, `location` (mostly null), `lastUpdateDateTime`.
- `getmatchdata/bl2/2026` and `getmatchdata/dfb/2026` → data present.
- No in-play status flag exists; the adapter therefore **never reports OpenLigaDB matches as live** (unfinished matches past kickoff are "unknown").

### Cross-provider comparison
Hamburger SV vs Borussia Mönchengladbach: OpenLigaDB `2026-11-06T19:30:00Z`; TheSportsDB `2026-11-06T19:30:00` (UTC) → identical kickoff. Team naming differs ("Hamburger SV" vs "Hamburg"), which is why reconciliation never relies on names across providers (see ARCHITECTURE.md).

### football-data.org
Not live-tested: no token was available. Facts below come from https://www.football-data.org/coverage and /pricing:
- Free tier competitions: Champions League, Primeira Liga, Premier League, Eredivisie, Bundesliga, Ligue 1, Serie A, La Liga, Championship, Brasileirão Série A, World Cup, European Championship.
- 10 calls/minute; scores and schedules delayed.
- **Not in the free tier:** Europa League, Conference League, Persian Gulf Pro League, any AFC competition.
- The adapter is covered by mocked-response unit tests only. **First thing to do when you get a token:** run the bot and check `/healthz/providers`, then open today's matches.

## Coverage vs. the requested competitions

| Requested | Source today | Status |
|---|---|---|
| Premier League, La Liga, Serie A, Ligue 1, Eredivisie, Primeira Liga, UCL | football-data.org free | Documented, unverified live |
| Bundesliga | football-data.org (owner) + OpenLigaDB (fallback) | OpenLigaDB verified live |
| 2. Bundesliga, DFB-Pokal | OpenLigaDB | Verified live |
| Europa League / Conference League | **none free** | Gap – hidden in UI |
| Persian Gulf Pro League, Azadegan, Hazfi, Super Cup, League 2, women | Victory API (paid) | Implemented, unverified; hidden unless configured |
| AFC Champions League Elite / Two | Victory API (paid) | Implemented best-effort discovery, unverified |
| Iran national teams | none verified | Not offered |

## Additional free source added (unverified): API-Football
Implemented as an optional provider (`API_FOOTBALL_KEY`). Free plan = 100 requests/day. Whether the free plan serves the *current* season could not be confirmed from public pages (sources conflict), so the provider checks each wanted competition (Europa League, Conference League, and Iranian leagues) at startup, enables only those found exactly once **with a current season**, treats plan-restriction errors as errors, and caps itself at 90 requests/day with a 3 h refresh interval; the persistent cache covers the rest. No other credible free fixture API was found (TheSportsDB free is unusable; Sportmonks free is trial/2 leagues).

## Decision
- **Primary (international): football-data.org.** Documented permanent free tier, single request returns all subscribed competitions for a date range (ideal for caching), standings included.
- **Fallback: OpenLigaDB.** Keyless and verified; only German competitions.
- **Iranian: Victory API as an optional paid provider**, highest routing priority for the competitions it verifies at startup. Because Iranian competitions are not available on any free API we could verify, the bot works fully without it and simply hides the Iranian competitions that are not available.
- TheSportsDB, Sportmonks, API-Football were not selected (limits / trial-only / unverified).

## Estimated API usage
Usage is driven by the number of *distinct cache keys*, not by the number of users, because every view reads from shared TTL caches with request de-duplication.

| Cache key | TTL | Calls/hour (max) |
|---|---|---|
| Today (UTC day) | 5 min (1 min while a match is live) | 12 (60 live) |
| Each other UTC day touched | 20 min | 3 each |
| 10-day window (favorites/search) | 20 min | 3 |
| Live list | 1 min, only when someone opens Live | ≤ 60 |
| Competition season / standings | 20 / 30 min per competition viewed | 3 / 2 each |

Realistic football-data.org consumption: **~250–700 calls/day** on a quiet day, up to ~2,000 on busy match days with continuous live viewers, regardless of whether there are 10 or 1,000 users. The 10/min limit is enforced client-side (limiter set to 9/min), so bursts queue instead of failing. OpenLigaDB: ≤ 6 calls per 10 minutes (season files are cached for 10 minutes). Victory API (if enabled): ~12 season fetches/hour per Iranian competition ≈ 300–1,400/day depending on the number of competitions – pick a plan accordingly.
