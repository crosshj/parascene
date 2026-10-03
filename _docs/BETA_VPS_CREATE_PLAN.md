# VPS Create port

2026-10-03 · Proposal

Governing requirements: [VPS/Beta migration guidance](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md). Architecture: [client ownership and lifecycle](BETA_VPS_CLIENT_ARCHITECTURE.md).

## Scope

- Full active WWW Create workflow, excluding reusable composers covered by [composer plan](BETA_VPS_COMPOSERS_PLAN.md).
- Basic creation, Advanced/Data Builder, edit/mutate, settings, provider controls, dialogs, assets and applicable role-gated tools.
- Preserve WWW DOM, CSS, behavior and defaults; adapt navigation, API and lifecycle seams only.
- Basic workflow prompt/form controls remain in scope; excluding composers does not remove these controls.

## Sources / current gaps

- Native SPA entry: `public/shared/createWorkflow.js` → `mountCreateWorkflow`.
- Basic: `basicCreateMarkup`, `public/pages/entry/entry-create.js`, style thumbnails.
- Advanced/Data Builder: `public/components/routes/create.js`, `public/components/elements/tabs.js`.
- Edit/mutate: `public/pages/creation-edit.js`; source selection, queue/prefill and lineage.
- Styles: `public/global.css`, `public/pages/creations.css`, `public/pages/creation-edit.css`; include dialogs, fields, tabs, inherited styles and breakpoints.
- VPS `/create` is a placeholder; `/creations/:id/edit` and `/mutate` equivalents need route definitions.

## Port order

1. **Inventory** — every visible control/tab, role gate, API and lazy dependency; capture WWW states. Include Blog tools currently embedded in Advanced.
2. **Shell** — native templates; `/create`, `/creations/:id/edit`, `/creations/:id/mutate`. Layout owns overlays; router owns URLs, Back and dismissal. Preserve background and scroll; support direct links.
3. **Basic** — prompts, styles/assets, image selection/edit carryover, settings, validation, submission and post-submit navigation.
4. **Advanced** — server/method/model selection, dynamic provider fields, conditional fields, uploads, aspect ratios, query/cost confirmation, payload preview/copy and Data Builder.
5. **Mutate** — source/group access, previews, prompt/settings prefill, queue, lineage, provider options and submission.
6. **Remaining tools** — port applicable role-gated Blog/campaign actions and their APIs; preserve visibility rules. Any deferral must be explicit.

## Shared machinery / server

- Reuse composer-plan submission, uploads, suggestions, settings, queue, imports, credits and completion tracking; one implementation for both surfaces.
- Additional contracts: `/api/create/query`, `/api/create/preview`, `/api/create/images/:id/mutate-source`; compare source/detail access and provider configuration.
- Query/preview must match WWW payload preparation and cost behavior; submission retains provider dispatch, accounting, lineage and completion updates.
- Blog tools require campaign/post CRUD and tracked-link APIs where exposed.

## Composer entry points

- Add a small **Create** action to the Feed overview; opens the reusable creation composer in a layout-owned surface.
- Composer **Advanced** action opens the full Create workflow; shared settings carry across.
- Conversation composers remain in channels/DMs. Feed entry UI belongs to the composer implementation, not a duplicate composer here.

## Completion / review

- Load all required styles before revealing the workflow; avoid placeholder/header size jumps.
- Scope selectors to the mount; destroy listeners, dialogs, observers, timers and stale async work. Preserve intentional settings/drafts.
- Review Basic, Advanced and Mutate separately: WWW visual/behavior parity, provider errors, credits, completion and navigation.
- Build passes; end-to-end review before calling Create complete.
