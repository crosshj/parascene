# VPS composer port — after Create

2026-10-03 · Proposal

Governing requirements: [VPS/Beta migration guidance](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md). Architecture: [client ownership and lifecycle](BETA_VPS_CLIENT_ARCHITECTURE.md).

## Starting point

- [Create port](BETA_VPS_CREATE_PLAN.md) complete: Basic, Advanced/Data Builder, edit/mutate and working overlay navigation.
- Shared creation services available: provider configuration, validation/submission, credits, uploads, suggestions, settings, mutation queue and completion tracking.
- Feed has a basic Create entry point. These are prerequisites, not claims about current implementation.

## Goal

- Bring over active WWW composers intact: DOM, behavior, CSS, defaults and persistence.
- Reuse Create services; adapt mount, navigation and lifecycle seams only.
- Native templates; no composer redesign.

## Sources

- Creation: `public/shared/createComposer.js` → `mountCreateComposer`; active integration in `src/chat/chatPage.js`.
- Conversation: composer markup in `pages/chat.html`; behavior embedded in `src/chat/chatPage.js`.
- CSS: `public/global.css`, `public/pages/chat.css`, `public/pages/chat-hotfix.css`; include inherited rules, dialogs, popovers, keyframes and breakpoints.

## Port order

1. **Inventory** — map composer states/actions to existing Create services; identify remaining UI helpers and API differences.
2. **Creation composer** — preserve image/video/audio modes, model/aspect selectors, attachments, suggestions, settings, queue, import confirmations and submission behavior.
3. **Creation mounts** — expose composer from Feed and My Creations. Advanced opens the completed Create workflow; prompt, model, attachments and settings carry across both ways as WWW supports.
4. **Conversation composer** — extract shared component; drafts per thread, reply strip, autogrow, keyboard behavior, suggestions, picker/paste/drop, upload progress/errors/removal. Keep optimistic send and private encryption in threads/controllers.
5. **Parity review** — compare WWW/VPS states and interactions; stop for user review after each working composer.

## Ownership / dependencies

- Reuse Create submission, uploads, provider fields/options, credits, settings, queue, imports and completion tracking. Extend shared services only for demonstrated contract gaps.
- Port remaining composer UI, drag/drop, prompt clearing and import dialogs; reuse audited VPS icons, suggestions, toast and lightbox.
- Layout owns composer surfaces and reserved space; view controllers own bindings, readiness and teardown. Router owns navigation.
- Replace asset-version dynamic imports with native VPS imports. Use app navigation instead of legacy create-page/overlay globals.
- Load complete component/shared CSS before rendering; preserve WWW classes and hierarchy.
- Destroy listeners, observers, timers, suggestions, dialogs and object URLs; guard stale async results. Preserve intentional drafts/settings.

## Server delta

- No second creation backend: use the completed Create contracts.
- Audit composer-only import endpoints and upload payloads against that implementation; add missing coverage.
- Conversation: match WWW attachment formatting, size limits, mentions and private-message handling using threads and upload APIs.
- Confirm pending/completed/error updates and credit changes reach every composer mount.

## Review checkpoints

- Creation: image/video/audio and imports work; Advanced handoff preserves state; no duplicate pending rows or credit accounting.
- Conversation: text/reply, attachments and drafts match WWW; switching threads leaves no stale state.
- Both: loading/error/popover states, keyboard behavior, overlays and narrow layouts match WWW; VPS build passes.
