# VPS migration tracker

This is an open-work list only. Completed ports and confirmed behavior are intentionally omitted. The [migration guide](VPS_MIGRATION_GUIDE.md) owns parity and cutover requirements; the [VPS deployment guide](VPS_DEPLOYMENT.md) owns deployment details.

## Remaining work

Before DNS for `api.parascene.com`. Detail is in [PLAN_api_off_vercel.md](PLAN_api_off_vercel.md). These three are done.

- [x] Point pricing checkout, plan cancel, and checkout-return at same-origin `/api/...` in `client/views/Pricing/PricingView.js`.
- [x] Set nginx `proxy_read_timeout` and `proxy_send_timeout` to at least 300s for `/api/worker/` and `/api/try/worker`.
- [x] Enqueue an embedding job on publish, on a title or description save of a published creation, and on admin restore.

- [ ] Remove remaining `_legacy` imports from maintained scripts and tests. The current references are in feed/visit-pulse job scripts, blog migration, audio/video backfills and video metadata repair, debug/monitoring scripts, and `test/messages-presentation-parity.test.js`. Port only supported tooling to root-owned modules; retire obsolete one-off scripts or replace the test's source dependency with root-owned fixtures. Do not port the legacy DB wholesale to preserve scripts.
- [ ] After the checklist, point `api` at the VPS and keep that Cloudflare record DNS-only. Confirm one checkout, one plan cancel, one creation poll, one catalog rebuild, one pulse flush, and one mail cron. Then pause Vercel. Rollback is pointing `api` back at Vercel.
