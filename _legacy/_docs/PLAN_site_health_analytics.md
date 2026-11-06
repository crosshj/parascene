# Plan: Site health analytics

Goal: honest picture of what people do on Parascene — population breadth, not leaderboards — at daily, monthly, and arbitrary period horizons so we can see what changed and what to fix next.

Instrumentation started ~2026-05-20 (visit pulse restore). Feed impression rollup live 2026-06-19.

## Principles

- **Daily US East day is the stored grain** — Redis hot path → nightly flush → one DB row per day (`prsn_visit_pulse_days` + tier blocks in `details`).
- **Month and period are views** — reports aggregate daily rows (`--from` / `--to`, calendar month, last N days). No separate monthly ingest unless query cost forces a cache table later.
- Rollups only in DB; no per-event tables unless we hit a hard wall.
- Passive where possible (visit pulse on API traffic); piggyback beacons we already send (feed impressions).
- Charts answer: how many people, how spread out, trending up or down — not who won.

## Time horizons

Same capability ladder at each horizon; only the window changes.

**Daily** — one US East partition. “What happened Tuesday?” Drill-down, anomalies, today partial via `--today` flush.

**Period** — any `--from` / `--to` or `--days N`. “Since launch / last 30d / this sprint.” Trend lines, averages, week-over-week shape. Visit pulse period report already does this for traffic + feed impressions daily series.

**Monthly** — calendar month (US East). “How was June vs May?” Coarser charts, milestone checks. Engagement monthly report does this today by scanning source tables; target is to **derive from daily rollups** once tiers 2–9 land on the day row.

Aggregation rules (report layer):

- Volume (hits, impressions, messages) — sum across days.
- Daily uniques (visitors, impressors) — sum is wrong; use avg daily uniques, median, or “active in period” from underlying actors when we have them; document which on each chart.
- Concentration — recompute from period totals or show daily band (min/max); don’t average Gini blindly.
- Penetration — actors in tier ÷ actors in base tier over the same window.

## Rhythm

Nightly (scheduled): `visit_pulse_flush` → **yesterday** US East into DB.

Refresh reports as needed:

```
# daily
node scripts/analytics/visit-pulse-flush.js --today
node scripts/analytics/visit-pulse-report.js --day YYYY-MM-DD --html

# period (default last 30d)
node scripts/analytics/visit-pulse-period-report.js --html
node scripts/analytics/visit-pulse-period-report.js --from 2026-05-20 --to 2026-06-18 --html

# monthly / long window (today: source-table scans; target: roll up dailies)
node scripts/analytics/engagement-monthly-report.js --from 2026-05-20 --to 2026-06-30 --html
node scripts/analytics/user-growth-story.js --html
node scripts/analytics/click-next-report.js --html
node scripts/analytics/inception-outlook-report.js --html
```

Outputs under `.output/`.

Done when: one **site-health** report family serves daily, period, and month modes from the same day-grain data without spelunking five scripts.

## Capability ladder

Each tier = penetration + volume + concentration (where it matters), at every horizon.

1. Traffic — anyone on site; authed vs anon; hours active; single-hit anon share.
   Daily: visit pulse row. Period/month: visit-pulse-period-report.

2. Account — signups, returning sessions, activation within 7d.
   Today: engagement monthly / growth story scans. Target: daily block on day row.

3. Create — users who start a creation.
   Today: engagement monthly. Target: daily block.

4. Publish — users who ship something.
   Today: engagement monthly. Target: daily block.

5. Feed scroll — feed-beta dwell + click; impressors; creation concentration.
   Daily: `details.feed_impressions`. Period: daily series in visit-pulse-period-report.

6. Interact — likes, comments, reactions, tips, detail views.
   Today: engagement monthly. Target: daily block.

7. Mutate — remix / mutate flows.
   Today: engagement monthly. Target: daily block.

8. Discover — related-grid click-next.
   Today: click-next report (lifetime; weak daily). Target: daily transition buckets → period/month sums.

9. Chat — messages sent.
   Today: engagement monthly. Target: daily block.

Read top to bottom: traffic without publish ≠ publish without scroll; scroll without interact = feed UX; interact without discover = recsys surfacing.

## What exists today

Daily grain in DB: traffic (visit pulse), feed scroll (`feed_impressions`).

Period views from dailies: visit-pulse-period (traffic + feed impression series).

Monthly / period from source scans: engagement-monthly, user-growth-story, click-next, inception-outlook.

Feed `feed-beta:seen` SET is ranking-only. Visit pulse hits ≠ feed impressions.

## Gaps

- `site-health-report.js` — one report, three modes (`--day`, `--from/--to`, `--month YYYY-MM`): ladder tiers as population charts, shared templates with visit-pulse reports.
- Daily blocks on day row for tiers 2–4, 6–9 (nightly job or extend flush); then point engagement-monthly at dailies instead of full table scans.
- Click-next daily buckets in DB (or pulse `details`) for real period/month discover trends.
- Funnel denominators over any window (e.g. click-next ÷ feed impressors).
- `--live` visit pulse includes feed impressions from Redis.

## Non-goals (for now)

- Per-user leaderboards.
- Re-flushing old days (Redis TTL ~72h).
- New client beacons.
- `feed_events` / long impression history in Postgres.

## Near-term focus

1. Daily pulse + period reports in routine; feed impressions = scroll-health signal.
2. Ship site-health report: period mode first (reuse visit-pulse-period patterns), then daily drill-down, then calendar month.
3. Add daily rollups for account → publish → interact → chat; migrate monthly reports to aggregate those rows.
