# Plan: Chat-first nav (replace Connect hub)

## Decisions (strategize before build)

- **Deep links (`/chat/dm/...`, `/chat/c/...`):** Keep **standalone** [`chat.html`](pages/chat.html) for these for now. **Integrate the nav hub first** (SPA `/chat` = full `initChatPage` inside app shell). Merging deep links into `app.html` is explicitly **later**, not part of the first milestone.
- **Comments (old Connect tab):** **Pseudo-channel** — reserved slug **`comments`**: client intercepts before `POST /api/chat/channels`; load `GET /api/comments/latest` in the main column. **Composer:** disabled with short help copy (“Reply on the creation page” or similar). **Policy:** confirm whether any real `#comments` channel already exists in DB; if so, migrate/rename or block.
- **URLs:** No need to preserve `/connect` for bookmarks. **`/connect` can go away** and be replaced by **`/chat`** (redirects from old `/connect` optional only if anything external still links).

## Problem (current)

- Primary nav goes to `/connect` and shows tabbed [`app-route-servers`](public/components/routes/servers.js): chat stub, comments, servers, feedback.
- Full chat is [`chat.js`](public/pages/chat.js) on `/chat/...` without app chrome; root `/chat` redirects to `/connect#chat`.
- Chat feels secondary (“two clicks” / leaving the shell for real threads).

## Direction

- User-facing **Chat**; canonical SPA route **`/chat`**.
- Hub route mounts **full** `initChatPage` (not the small Connect chat tab).
- Legacy feedback form tab → legacy until removed; feedback-as-channel stays primary.

## Phases (revised)

### Phase 1 — Rename and `/connect` → `/chat`

- Nav label and `data-route` **`chat`** in [`pages/app.html`](pages/app.html), [`pages/app-admin.html`](pages/app-admin.html), [`public/components/navigation/index.js`](public/components/navigation/index.js), [`public/components/navigation/mobile.js`](public/components/navigation/mobile.js).
- [`api_routes/pages.js`](api_routes/pages.js): serve app on `/chat` hub; **remove or replace `/connect`** (no bookmark requirement); fix `/chat` root redirect so it targets integrated hub, not old hash.
- [`public/pages/entry/entry-app.js`](public/pages/entry/entry-app.js): new route component tag (e.g. `app-route-chat`).
- Sweep internal links: [`chat.js`](public/pages/chat.js), [`chatSidebarRoster.js`](public/shared/chatSidebarRoster.js), [`feed.js` CTA](api_routes/feed.js), notifications, help.

### Phase 2 — `app-route-chat` (hub only)

- New component: same DOM + `initChatPage` as standalone; **gate init** per [`_docs/_ARCHITECTURE_ROUTE_LOAD.md`](_docs/_ARCHITECTURE_ROUTE_LOAD.md).
- Strip tabbed hub from [`servers.js`](public/components/routes/servers.js) once replaced; preserve admin-only behavior if any.

### Phase 3 — Standalone `/chat/*` (unchanged for now)

- **No change** to serving [`chat.html`](pages/chat.html) for thread URLs in the first milestone. Optional polish: “Back” links and copy say **Chat** and point at **`/chat`**, not Connect.

### Phase 4 — Comments as pseudo-channel (design)

See **“Pseudo-channel: Comments (deep dive)”** below. Implement only after URL + composer behavior are chosen.

### Phase 5 — Help and cleanup

- Help paths and copy: Connect → Chat; server registration docs pointing at old hash tabs → new flows.

## Done criteria (milestone 1)

- One nav click opens **Chat** with full inbox/thread UX **in the app shell** at `/chat`.
- `/chat/dm/...` etc. still work as standalone; back targets updated hub.
- `/connect` removed or redirected; internal product uses **`/chat`** only.

---

## Pseudo-channel: Comments (deep dive)

### What the old Connect tab actually is

- **Data:** `GET /api/comments/latest` (see [`api_routes/comments.js`](api_routes/comments.js)), not chat messages. Rows are **comments on creations** (creation thumbnail, creator, comment text, link to `/creations/:id`, comment reactions as read-only chips in the current UI).
- **UI:** Built in [`servers.js`](public/components/routes/servers.js) (`loadLatestComments`, `renderLatestComments`) — **not** the chat message list (`loadMessages` / `connect-chat-msg` in [`chat.js`](public/pages/chat.js)).

So a “pseudo-channel” here means: **same chrome as a chat thread** (sidebar + title bar + main column), but the **main column content** is driven by the **comments API**, not `GET /api/chat/threads/:id/messages`. Users can still **reply to comments in context** by opening the creation (existing behavior); there is no “post to this pseudo-channel” that maps to chat.

### Collision: `/chat/c/comments`

Today [`parseChatPathname`](public/pages/chat.js) treats `/chat/c/<slug>` as a **normal channel**. For slug `comments`, [`openThreadForCurrentPath`](public/pages/chat.js) will `POST /api/chat/channels` with `{ tag: "comments" }` and create or join a **real** hashtag channel — **not** the site-wide latest-comments feed.

So you must either:

- **A — Dedicated path (recommended for clarity):** Add a distinct URL shape, e.g. `/chat/comments` (new `parseChatPathname` kind like `pseudo-latest-comments`). No ambiguity with user-created `#comments` channels.
- **B — Reserved slug:** Block `comments` (and maybe similar) in `POST /api/chat/channels` / validation, and in the client **short-circuit** before POST when slug is reserved, then load the comments feed. Requires handling any **existing** DB rows that already use `comments` as a channel slug (migrate or accept conflict).
- **C — Different reserved tag:** Use an ugly internal slug (e.g. `__latest_comments`) for the pseudo entry only — works with current `/chat/c/...` parsing but is opaque in the URL bar.

### Composer behavior

- **Read-only stream:** Hide the message composer, or show it **disabled** with short copy (“Comments happen on creations — open a row to reply”). Prevents confusion with chat sends.
- **Realtime:** Latest-comments is **poll or manual refresh** unless you add SSE later; chat threads use [`subscribeRoomBroadcast`](public/shared/realtimeBroadcast.js) per thread — different model.

### Sidebar presence

- **Pinned row** at top of “Channels” (or its own subsection): “Latest comments” → navigates to `/chat/comments` (or chosen URL). Optionally **do not** list it in `GET /api/chat/threads` — purely client-driven route.
- Reuse or extract **`renderLatestComments`** from `servers.js` into a shared module so `chat.js` (or a small helper) renders the same cards inside `[data-chat-messages]` when in pseudo mode.

### What we are not doing (unless product changes)

- **Mirroring** each public comment into chat messages (duplication, moderation, deletion sync).
- **A real thread** that only bots post to for “latest” — unnecessary if the feed is read-only from `comments/latest`.

---

## Decisions (Comments pseudo-channel) — 2026-03-29

- **URL:** **Reserved slug** `comments` — intercept in [`openThreadForCurrentPath`](public/pages/chat.js) (and block creating a normal channel with that tag server-side if needed). Audit existing `channel_slug = 'comments'` rows before ship.
- **Composer:** **Disabled** + one line of helper text (not hidden).
