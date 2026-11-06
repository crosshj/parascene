# Plan: Command palette (quick switcher)

v1 shipped: navigation-only quick switcher on chat SPA (`Cmd/Ctrl+K` desktop). Modules: `src/shared/commandPalette/commandPaletteProvider.js`, `commandPalette.js`. Wired from `src/chat/chatPage.js`.

## Later — discovery

- `@` / `#` prefix filters (Discord-style)
- `GET /api/suggest?source=users` then `POST /api/chat/dm` (reuse `chatSidebarModals.js`)
- `GET /api/chat/channel-slugs` for unjoined public channels
- Server browse/join from palette

## Later — actions

- Mark read, pin DM, open profile/settings
- Optional command mode (`>` prefix)

## Later — mobile

- Search/jump button in chat top bar
- Consider FAB or header long-press

## Later — cross-page

- Mount from future `app-route-chat` / Connect when nav unification lands (`PLAN_chat_nav_unification.md`)
- Optional `sessionStorage` visit history for recents better than activity sort

## Later — polish

- Highlight current destination; dim active row
- Unread badges (data exists on threads; partial in v1)
- Fuzzy subsequence scoring if substring match feels too strict
