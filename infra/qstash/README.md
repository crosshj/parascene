# QStash schedules (infra)

Source of truth: `schedules.cjs`. Apply to Upstash like DB migrations.

## Prerequisites

- `.env` with `UPSTASH_QSTASH_TOKEN`, `UPSTASH_QSTASH_URL`
- Vercel env: same + `UPSTASH_QSTASH_CURRENT_SIGNING_KEY`, `UPSTASH_QSTASH_NEXT_SIGNING_KEY`
- Callback host: `api.parascene.com` (see `api_routes/utils/url.js` → `getQStashCallbackBaseUrl()`)

## Apply / update schedules

```bash
node infra/qstash/sync.cjs
node infra/qstash/sync.cjs --dry-run
node infra/qstash/sync.cjs --only parascene-visit-pulse-flush
```

Re-run after editing `schedules.cjs` — same schedule id updates cron/body in place.

## Add a schedule

1. Add an entry to `schedules.cjs` (stable `id`, `destinationPath`, `cron`, `body`).
2. Implement the worker route if new.
3. Run `node infra/qstash/sync.cjs`.

On-demand jobs (creation, embeddings) are **not** schedules — they use `/v2/publish/` from app code.

## Schedules today

| id | cron (UTC) | destination |
|----|------------|-------------|
| `parascene-notifications-cron` | `0 * * * *` | `/api/worker/notifications` |
| `parascene-visit-pulse-flush` | `10 5 * * *` | `/api/worker/jobs` |
| `parascene-feed-beta-catalog-rebuild` | `*/15 * * * *` | `/api/worker/jobs` |

Notifications cron runs hourly; digests only send during policy windows (`digest_utc_windows`, default 09:00 and 18:00 UTC). Other hours no-op with `not_in_window`.

Visit pulse flush cron is **05:10 UTC** = **00:10 US East (UTC-5, no DST)**. Redis keys and DB `day` use **US East calendar date**; `details` range endpoints are **UTC ISO**.
