# VPS migration tracker

This is an open-work list only. Completed ports and confirmed behavior are intentionally omitted. The [migration guide](VPS_MIGRATION_GUIDE.md) owns parity and cutover requirements; the [VPS deployment guide](VPS_DEPLOYMENT.md) owns deployment details.

## Remaining work

- [ ] Remove remaining `_legacy` imports from maintained scripts and tests. The current references are in feed/visit-pulse job scripts, blog migration, audio/video backfills and video metadata repair, debug/monitoring scripts, and `test/messages-presentation-parity.test.js`. Port only supported tooling to root-owned modules; retire obsolete one-off scripts or replace the test's source dependency with root-owned fixtures. Do not port the legacy DB wholesale to preserve scripts.
