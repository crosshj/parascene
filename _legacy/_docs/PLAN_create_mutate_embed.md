# Plan: Create / mutate embed overlays

Goal: keep mutate and create inside SPA shells via native overlay mount (div), not iframe HTML.

## Live path

- Mutate and create open in the workflow overlay from any SPA shell (app + chat, desktop + mobile).
- Direct URL `/create` or `/creations/:id/mutate` serves chat shell + native overlay restore.
- Overlay uses `mountCreateWorkflow` in a div (`useNativeCreateWorkflow`); no `/create?embed=1` or mutate embed HTML.

## Invariants

- Parent shell owns history and address bar overlay stack.
- Native host callbacks (`createWorkflowHost`) for navigate / shell-out / dismiss / shell sync.
- Submit success: `navigate: 'none'` + dismiss overlay + lane refresh.
- Shell-out: profile, `/create/blog`, off-origin, routes parent cannot host in overlay.
- Nested Escape closes in-page dialogs first.

## Navigation intents

- in-overlay: `/creations/:id`, `/creations/:id/mutate`, `/create`
- shell-out: `/create/blog/:id`, `/user/*`, `/chat/*` (when not lane), profile paths
- dismiss: lane paths (`/creations`, `/feed`, `/explore`), close button, submit success

## Done

- Create and mutate native-mount in overlay
- Basic ↔ advanced remount via cookie + `forceReload`
- Dead HTML documents (`create.html`, `createAdvanced.html`, `creation-edit.html`) removed
