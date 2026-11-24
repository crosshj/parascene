# Plan: API off Vercel

Stripe, QStash jobs, mail, and creation polls already run in the root server. `api.parascene.com` still resolves to Vercel. Schedules and `CREATION_WORKER_ORIGIN` already use that hostname, so DNS is what moves them. The list below is done.

## Before DNS

- [x] Point pricing checkout, plan cancel, and checkout-return at same-origin `/api/...` in `client/views/Pricing/PricingView.js`. Those routes are on the VPS. A browser call from `www` to `api.parascene.com` gets no CORS headers.
- [x] Set nginx `proxy_read_timeout` and `proxy_send_timeout` to at least 300s for `/api/worker/` and `/api/try/worker` in `infra/nginx/parascene.conf`. Those handlers hold the request until the job ends. The default is 60s, and a cut-off makes QStash retry the same poll.
- [x] Enqueue an embedding job on publish, on a title or description save of a published creation, and on admin restore. `POST /api/worker/jobs` can run `embedding`.

QStash keeps calling `/api/worker/jobs` and `/api/worker/notifications`, same as the old API. The in-process pulse and welcome timers sit behind `startProcessSchedules` in `server/services/schedule/processSchedules.js`. They run only when `mode` is `timer`. The default is `qstash`.

Confirm the live Upstash destinations and the Stripe webhook URL are `https://api.parascene.com/...` before the flip. Keep the Cloudflare `api` record DNS-only so the proxy does not cut a worker request off around 100s. After DNS: one checkout, one plan cancel, one creation poll, one catalog rebuild, one pulse flush, one mail cron. Then pause Vercel. Rollback is pointing `api` back at Vercel.
