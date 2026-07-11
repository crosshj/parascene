# Plan: One overview report (day / week / month / inception)

One static report app that answers "how are we doing" at every time scale. The HTML/JS never changes. It reads a small local data store on load and computes every metric in the browser. "Re-running" the report only refreshes the store.

## Architecture (locked)

Three pieces:

- Data store — a small local file the app reads on load. Compact aggregates, but granular enough (per-user-per-day activity) that every metric can be recomputed client-side for any range.
- Refresh (ETL) — a script that fetches Supabase/Redis, transforms to the store shape, and overwrites the store. This is the only thing that touches the DB. It never regenerates the app HTML.
- Report app — one unchanging static HTML + JS. Loads the store, computes all metrics in the browser, renders Today / Week / Month / Inception, handles prev/next and the inception from/to.

Consequences:

- "Re-run the report" = run refresh (fetch → transform → write store), then reload the page.
- All metric math (DAU/WAU/MAU, cohorts, churn, activation, funnels, action mix, top-2 share, actions-per-active, projections, milestone ETAs, heatmaps) lives in the client. No metric fidelity is lost to ranging, because everything recomputes from the store.
- Served locally, dev only: the app is mounted at `http://localhost:2367/reports/` by the dev server (`api/index.js`) and is never mounted in production (guarded by `NODE_ENV !== "production" && !VERCEL`). It is unauthenticated because it is local-only. Serving over HTTP means real ES modules — `app.js` imports `./metrics.js` and `fetch`es `./store.json` (no `file://` global-script workarounds).
- `hn-today` excluded (external, not our data).
- Time zone: all day-keys in US/Eastern to match existing rollups.
- Week start: Sunday (weeks run Sun→Sat; heatmap rows Sun→Sat). Note this differs from the older visit-pulse/engagement reports, which are Monday-start.

## Data store shape

Pinned (versioned) as JSDoc typedefs in `scripts/analytics/overview/metrics.js` — that file is the single source of truth for both the ETL output shape and the client math. Summary:

- `meta`: `{ launchDay, lastRefresh, tz, schemaVersion }`.
- `users`: `[{ id, label|null, signupDay }]` (labels are local-only).
- `userDay`: compact per-(user, day) activity — action-type counts. Powers distinct-window DAU/WAU/MAU, cohorts, churn, activation, action mix, top-2 share, actions-per-active. Columnar to keep small.
- `visitDaily`: `[{ day, hits, blocks, authedHits, anonHits, authedVisitors, anonVisitors, hourly[24] }]` — traffic/pulse + weekday×hour heatmap + today hour chart.
- `funnelDaily`: landing funnel events per day (view, video_play, video_complete, cta_click) + feed impressions.
- (Phase 4) `transitionsDaily`, `challengeDaily`, taste/affinity aggregates.

Granularity is per-user-per-day at most — aggregate, no raw events. Small for the current user base; columnar encoding if it grows.

## Time scales (all derived client-side from the store)

- Today: authed/anon traffic, hour-by-hour presence, named logged-in users, today's landing funnel + feed impressions. Reflects the last refresh snapshot (see live note).
- Week: WAU (action/visit/traffic), activation, action mix, weekday×hour rhythm, latest-week milestone snapshot. Prev/Next by week.
- Month: DAU/WAU/MAU, retention cohorts, churn, signup funnel, engagement leaders, "stable small room" scorecard. Prev/Next by month.
- Inception: all-time DAU/WAU/MAU, cumulative signups, cohorts, projections + milestone roadmap. A from/to control (default launch → yesterday) re-slices and redraws every graph and stat; projections/ETAs recompute against the selected range.

Prev/Next and the inception from/to are pure client windowing over the same store — no regeneration.

## Live note (Today)

- The store is a snapshot as of the last refresh, so "active now" isn't available from a static file. Today reflects the last refresh; refresh more often for freshness.
- Optional later: if online, the app can do a single live fetch for active-now and overlay it on Today. Out of scope for v1.

## Phase 0 — store schema + shared metric module (DONE)

- Schema pinned (v1) as JSDoc in `scripts/analytics/overview/metrics.js`.
- Browser-safe `metrics.js` (no Node/DOM deps): US-East day/week/month helpers, windowing, active-user metrics (action/visit/traffic DAU/WAU/MAU), signups, cohorts, churn, signup funnel, action mix, engagement leaders, top-2 share, actions-per-active, weekday×hour heatmap, plus `linearRegression`/`sparkline`/`barChart`/`heatmapSvg`. Validated in Node against a synthetic store.
- Convention normalized: everything uses US-East partition day keys (the pulse convention); `user-growth-story`'s UTC keys are superseded here for consistency.

## Phase 1 — refresh (ETL) (DONE)

- `scripts/analytics/overview-refresh.js`: queries Supabase (users via openDb; events, pulse days, share/try via service role) + best-effort live Redis snapshot for today, transforms to the v1 store shape, writes `.output/overview/store.json` (plain JSON). Default is **incremental** (loads existing store, re-fetches from `lastCompleteDay` onward, merges). `--full` rebuilds launch → now. `--out` overrides path; `--no-live` skips Redis. Imports shared schema constants from `overview/metrics.js` (native ESM).
- Full rebuild launch → now each run (~38s at current scale). Store ≈ 1.9 MB (bulk = per-day `visitorKeys`; interning anon cids to ints is an easy later shrink).
- Validated against `engagement-monthly-report` for a 30-day window: action/visit MAU, avg DAUs, cohorts, and action mix all match. Publishes differ (+29 in store) because the store catches late publishes of pre-window creations that the windowed report drops — store is the more correct side.

## Phase 2 — report app (static) (DONE)

- `scripts/analytics/overview/index.html` (links `./report.css` + small tab/control CSS) with a single `<script type="module" src="./app.js">`. Served at `http://localhost:2367/reports/`; the dev server aliases `/reports/report.css` (→ `scripts/analytics/report.css`) and `/reports/store.json` (→ `.output/overview/store.json`).
- `app.js` imports `* as M from "./metrics.js"`, `fetch`es `./store.json`, computes everything via `M`, and renders four tabs:
  - Today: live snapshot (visitors, hits, peak hour, present-by-hour charts, named logged-in users, action DAU + mix). Prev/next day.
  - Week: action/visit/traffic WAU, activation, actions/active, DAU + traffic sparklines, action mix, leaders, milestone. Prev/next week. Clamped to `lastCompleteDay`.
  - Month: DAU/traffic/MAU, activation, churn, signup funnel, cohorts, share→try funnel, leaders, milestone. Prev/next month. Clamped to `lastCompleteDay`.
  - Since inception: from/to date pickers (default launch → yesterday) — every graph/stat + the milestone projection recompute for the chosen range.
- Loading `http://localhost:2367/reports/` fetches the store from `./store.json` (served from `.output/overview/store.json`).
- Persisted app state (`localStorage: overview.state`): one blob holds the active tab, every per-tab control (day / week / month / inception from-to), and the ignored-user list. Restored on load and clamped to the current store's launch..lastComplete bounds (stale saved dates snap in-range after a newer refresh); saved on every tab switch, nav step, inception apply/reset, and ignore change. Migrates the older `overview.ignoredUserNames` key on first read.
- Copy for LLM: a ⧉ Copy header button instantly copies the current view as Markdown; a Preview… button opens a modal (same `.modal-*` pattern) with a Markdown/JSON toggle and a live preview. The digest serializes only the active tab + its resolved range + ignored-users state (KPIs, action mix, leaders, funnel, feed, related, challenges, plus cohorts/churn/MAU on month/inception) and appends the methodology caveats so a model doesn't over-read the proxies. All client-side from the filtered store.
- Settings popup: a ⚙ Settings button opens a medium modal built on a generic, reusable `.modal-*` pattern in `report.css` (overlay + `.modal` + `.modal-head`/`.modal-title`/`.modal-close` + scrollable `.modal-body` with `.modal-section` groups). Wiring is generic in `app.js` (`data-modal-open="<id>"` opens; `data-modal-close`, backdrop click, or Escape closes) so future popups need markup only. The Ignore-users control lives in the first section; a placeholder section reserves room for more settings.
- Ignore users: accepts names/@handles/ids, resolves them to user ids, and builds a filtered store view (drops those users from `users`, `userDay`, and visit `visitorKeys`/counts) that feeds every metric on every tab. Caveat: per-day `hourlyAuthed` can't subtract an individual user (per-user hours aren't in the store), so the by-hour charts still include ignored users; all distinct/action/count metrics are exact.

## Phase 3 — validation (DONE for family scope)

- `metrics.js` validated against a synthetic store; store validated against `engagement-monthly-report` (match, plus the publish fix). App exercised through a DOM shim: all four tabs render with no exceptions and correct milestone/target output. Old per-report HTMLs are now redundant for the family scope (Node loaders retained).

## Phase 4 — engagement extensions (DONE for click-next + challenges)

Store additions (typedefs in `metrics.js`, filled by `overview-refresh.js`):

- `transitionsDaily: [{ day, paths }]` + `transitionsTop: [{ from, to, count, lastDay, fromLabel, toLabel }]` — related-grid ("click-next") from `prsn_related_transitions`.
- `challenges: [{ id, title, phase, subStartDay, subEndDay, voteStartDay, voteEndDay, memberCount }]`, `challengeSubs: [{ d, u, c }]`, `challengeVotes: [{ u, c, to }]` — from the `#challenges` channel (reuses `extractChallengeEvents` etc.). Per-user rows so ignore-users recomputes submitter/voter counts client-side.

Feed engagement (already in the store via visit pulse `details.feed_impressions`, now surfaced):

- `feedImpressionSeries` / `feedImpressionTotals` in `metrics.js`; "Feed engagement" card (chart-first, stats below) on Today (compact) + Week/Month/Inception, inline beside Related browsing. Logged-in feed-beta only; unique impressors/creations are per-day peaks; aggregate-only so ignore-users doesn't subtract. Empty range shows a minimal placeholder.

Rendering (metric fns in `metrics.js`, cards in `app.js`):

- Week/Month/Inception: "Related browsing (paths touched)" trend + "Challenge submissions by day" + a challenges-active-in-range table (submissions, unique submitters/voters, participation vs channel members). Inception also shows all-time top related paths.
- Not on Today (both are low-volume / lifetime-ish).

Caveats (surfaced in-UI):

- Related-browsing `paths` is a proxy: the source stores lifetime counts + `last_updated` only, so a day's value = pairs whose most recent click landed that day. Logged-in only. No per-click user id, so ignore-users does NOT filter it (challenge rows do carry user ids and are filtered).
- Vote timestamps aren't stored, so challenge vote totals are lifetime (not range-clipped); only submissions bucket by day. Challenge day-keys re-bucketed to US-East (source used UTC).

Still exploratory:

- `user-taste-profile`: reuse content-affinity signals where they answer an engagement question; probe, not a requirement.

## Phase 5 — consolidation (DONE)

Retired the standalone reports now fully covered by the overview (script + `.html` template each):

- `visit-pulse-report` → Today tab.
- `visit-pulse-period-report` → Week/Month/Time Range traffic + heatmaps + funnel.
- `engagement-monthly-report` → Monthly tab (the validation oracle; re-diff before trusting new additions).
- `click-next-report` → Related browsing card.
- `inception-outlook-report` + `user-growth-story` → Time Range + milestone/projection card (removed together; outlook imported the story).
- `landingFunnelReport.js` helper removed with its only consumers (the two pulse reports).

Kept (unique value, not in the overview): `challenge-participation-export` (deep per-submission/vote LLM export), `user-taste-profile` (content affinity, WIP), `hn-today` (external). Shared `report-styles.js` retained (still used by those). Non-report utilities untouched (`overview-refresh`, `visit-pulse-flush`, `restore-visit-pulse-*`, `feed-beta-catalog-rebuild`).

## Done criteria

- Opening one HTML shows Today / Week / Month / Inception, each populated from the store, no cross-report hopping.
- Reloading after a refresh reflects new data with zero HTML changes.
- Prev/Next moves back by day, week, month.
- Inception from/to re-slices and redraws every graph and stat, including per-user metrics (all client-computed).
- Every metric is computed client-side from the store; metric math is defined once in `metrics.js`.
