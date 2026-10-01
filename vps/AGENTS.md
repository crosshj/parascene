# VPS agent instructions

Before changing VPS/Beta frontend code, read [`../_docs/BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md`](../_docs/BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md).

The VPS client is a self-contained deployment. Never import, resolve, or bundle runtime source from outside `vps/`, including `public/`, `src/`, and `api_routes/`. Use those directories as references only; port required behavior into VPS-owned files. `npm run build` enforces this boundary and must pass before considering a VPS client change complete.

Do not create `vps/client/vendor` or another mirrored WWW source tree. Port each required module directly into its canonical VPS architecture location and omit unrelated WWW files.

Adapt imports in the source module itself. Do not add Rollup aliases, path remapping, dynamic-import rewriting, or file-specific source transforms to compensate for WWW paths or loading conventions. Rollup configuration should remain limited to general build responsibilities such as HTML/CSS loading, output generation, minification, and architecture-boundary validation.
