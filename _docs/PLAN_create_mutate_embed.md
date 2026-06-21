# Plan: Create / mutate embed overlays

Goal: keep mutate and create inside SPA shells via iframe overlay + `?embed=1`, same mental model as creation detail embed.

## Problem today

Creation viewing stays in-SPA via `creationDetailOverlay.js`. Mutate and create shell out to full-page routes and lose lane scroll/context.

## Chosen direction

- Mutate and create open in the workflow overlay from any SPA shell (app + chat, desktop + mobile).
- Direct URL refresh of `/create` or `/creations/:id/mutate` still serves standalone full pages.
- Chat composer stays for quick create on desktop pseudo-lanes; links to `/create` (Advanced, empty states, nav Create tab) use the overlay.

## Invariants (embed mode)

- Parent shell owns history and address bar overlay stack.
- Iframe never full-reloads or navigates the lane underneath.
- Same-origin navigation: postMessage to parent; parent swaps iframe src or dismisses.
- Shell-out: profile, `/create/blog`, off-origin, routes parent cannot host in overlay.
- Submit success: `navigate: 'spa'` + dismiss overlay + lane refresh.

## Architecture

- `creationDetailOverlay.js` — parent overlay, history, message routing (detail + mutate + create URLs).
- `creationDetailRuntime.js` — detail iframe navigation.
- `creationEditRuntime.js` — mutate iframe navigation.
- `createPageRuntime.js` — create iframe navigation (v2).
- `creationDetailEmbedShell.js` — parent lane sync after mutations.

## Navigation intents

- in-overlay: `/creations/:id`, `/creations/:id/mutate`, `/create`
- shell-out: `/create/blog/:id`, `/user/*`, `/chat/*` (when not lane), profile paths
- dismiss: lane paths (`/creations`, `/feed`, `/explore`), close button, submit success

## Single iframe, swap src

Detail → mutate: parent `pushState` to mutate URL, replace iframe src. Back restores detail embed.

## v1 mutate — done criteria

- Feed/chat → detail overlay → Mutate stays in SPA
- Back mutate → detail; back detail → lane + scroll
- Mutate submit → overlay dismiss + pending on creations lane
- Thumbnail in mutate → detail in same overlay
- Direct `/creations/:id/mutate` refresh → standalone full page
- Group mutate `?source_id=` preserved in history

## v2 create — done criteria

- App shell Create button opens `/create?embed=1` overlay
- App mobile bottom nav Create opens overlay
- Creations empty state "Get Started" opens overlay
- Document-level intercept for `/create` and mutate links on app SPA lanes
- Submit dismisses overlay + refreshes creations lane
- Blog tab shells out to `/create/blog/:id`
- Mutate "Advanced Mode" opens create in same overlay stack

## Phasing

```
v1 mutate overlay
v2 create overlay
v2.5 chat composer convergence (optional)
v3 rename overlay module (optional)
```
