# Plan: creation detail embed runtime

Goal: one mental model for standalone `/creations/:id` and embed (`?embed=1` in overlay iframe). No scattered `if (embed)` branches; no direct `location.reload` / `location.href` from page code.

## Invariants (embed mode)

- Parent shell owns history and address bar overlay stack.
- Iframe never full-reloads or navigates the lane underneath.
- Mutations: refresh via `loadCreation()` + `refreshAfterMutation(reason)` (shell sync to parent).
- In-overlay navigation: `/creations/:id` → postMessage route to parent.
- Shell-out: edit, mutate, `/creations`, profile, chat, etc. → postMessage route (parent closes overlay / full page).
- External: mailto, tel, off-origin → iframe may assign directly.

## Architecture

- `creationDetailRuntime.js` — single front door (navigate, shellOut, refreshAfterMutation, bind capture listeners).
- `creationDetailEmbedShell.js` — iframe → parent shell sync protocol + DOM patches.
- `creationDetailOverlay.js` — parent overlay, history, message routing.

## Navigation intents

- overlay: `/creations/:id` (same or other id)
- shell-out: `/creations/:id/edit|mutate`, `/creations`, `/feed`, `/explore`, `/chat/*`, `/user/*`, profile paths
- hashtag `/t/:slug` mention: `requestHashtagIntent` — under chat SPA post `prsn-chat-hashtag-intent` (parent dismisses overlay + chooser); else shared chooser then navigate/shellOut
- external: off-origin, mailto, tel

## Mutation reasons → shell scopes

- published / unpublished / deleted → all lanes + creation cards
- edited / status-changed → creations + chat-creations + creation
- profile-updated → creations + creation

## Migration checklist

- [x] Runtime module + register refresh handler from `loadCreation`
- [x] creation-detail.js uses runtime (no local postMessage helpers)
- [x] publish, tip-creator, closeModalsAndNavigate use runtime
- [x] CI grep forbids raw reload/href in embed-capable paths (except runtime)
- [ ] Lane registry: optional future — central `registerShellSyncConsumer` vs per-route listeners

## Done criteria

- Grep check passes on embed-capable files.
- Compatibility matrix spot-check: publish, unpublish, delete, retry, mutate, related, back, X, set avatar, tip — embed + parent lane refresh.
