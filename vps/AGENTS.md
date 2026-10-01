# VPS agent instructions

Before changing VPS/Beta frontend code, read [`../_docs/BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md`](../_docs/BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md).

The VPS client is a self-contained deployment. Never import, resolve, or bundle runtime source from outside `vps/`, including `public/`, `src/`, and `api_routes/`. Use those directories as references only; port required behavior into VPS-owned files. `npm run build` enforces this boundary and must pass before considering a VPS client change complete.
