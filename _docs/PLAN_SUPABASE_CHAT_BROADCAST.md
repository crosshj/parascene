# Plan: Supabase chat broadcast invalidation

Terse phased rollout. Full context: [`supabase-chat-broadcast-guide.md`](./supabase-chat-broadcast-guide.md).

---

## Phase 1 — Browser Supabase session + env

**Status:** Complete (implemented: `api_routes/utils/head.js` boot + import map, `api_routes/supabaseSession.js` + `SESSION_SECRET` bridge, `public/shared/supabaseBrowser.js`, `public/shared/pageInit.js`).

**Implement**

- **Public config from server:** The server reads Supabase **project URL** and **anon key** from env and **injects them into logged-in pages** (inline script, `window` config, etc.) so static client JS never hardcodes secrets. The anon key is **public by design** (RLS enforces access); still **never** send `service_role` to the browser.
- **JWT in the client:** Private Realtime requires a **Supabase Auth session** in the browser (access token / JWT + refresh). The server’s job is to ensure that once the user is logged into the app, the client obtains and keeps that session — e.g. exchange or mint tokens after cookie auth, or whatever bridge matches this codebase. The client uses URL + anon key only to run `createClient` and attach/refresh that session; **authorization for chat data stays in your API + `prsn_chat_*`.**
- **Scope:** Session bootstrap + shared Supabase client (or equivalent singleton) must load on **every route that renders the logged-in app shell** — not only chat. Realtime invalidation and thread `user:` subscription depend on that session; navigation between logged-in pages must not drop it unless the user logs out.

**Validate**

Phase 1 is **done when you can prove** the browser auth + config plumbing — **not** yet that private Realtime channels work (that needs Phase 2 broadcast policies before subscriptions succeed).

- **Config:** Logged-in shell exposes URL + anon key to JS (inspect `window` / inline boot); **no `service_role`** anywhere.
- **Session:** After app login, `supabase.auth.getSession()` returns a session with a usable **access token**; after reload or long idle, refresh still succeeds (or user is signed out consistently).
- **Cross-route:** Navigate feed → chat → profile (or equivalent): same session, no duplicate `createClient` init, no missing singleton on a route.
- **Identity:** You can read the JWT (e.g. `user_metadata.prsn_user_id`) for app user id — no need to subscribe to a channel yet.

---

## Phase 2 — `realtime.messages` RLS

**Status:** Implemented (same file as chat schema: [`db/schemas/supabase_03_chat.sql`](../db/schemas/supabase_03_chat.sql), Realtime section at end). In the dashboard, disable **Allow public access** under Realtime settings so only **authenticated** clients can use private channels (anon has no policies).

**Model (simpler):** **Authenticated** users may **select** (subscribe) for **broadcast** on **any** topic (`user:…`, `room:…`, etc.). **Insert/send** is not granted to them; **service_role** bypasses RLS for server/worker publishes. **No** per-topic membership in Realtime; **authorization for real data stays in the API.** Tradeoff: invalidation hints may be observable without API consent; payloads stay minimal.

**Implement**

- `realtime.messages.extension = 'broadcast'` on policies per [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).

**Validate**

- Without a Supabase session, private channel subscribe fails.
- With a session, subscribe to `room:<T>` / `user:<id>` succeeds; **GET** message APIs still enforce membership as today.

---

## Phase 3 — Server broadcast after write

**Status:** Complete (`broadcastRoomDirty` / `broadcastToChannel` in `api_routes/utils/realtimeBroadcast.js`; `POST …/messages` in `api_routes/chat.js`).

**Implement**

- After `POST /api/chat/threads/:threadId/messages` persists a row successfully, call `getSupabaseServiceClient()`, `channel('room:<threadId>', { config: { private: true } })`, `send({ type: 'broadcast', event: 'dirty', payload: { … } })` (minimal payload; `roomId` = thread id).
- Optionally broadcast on `user:<userId>` for unread/list invalidation (same pattern).

**Validate**

- Post message from client A; observe in Supabase Realtime inspector or a minimal test subscriber that `dirty` fires on `room:<threadId>` after DB commit.
- Failure path: DB insert fails → no broadcast.

---

## Phase 4 — Client lifecycle + resync

**Full refetch** on `dirty` is acceptable for now (no `after`/`since` required). **Delta** is optional — see Phase 5.

**Status:** Partial — `public/shared/realtimeBroadcast.js` (`subscribeBroadcast`, `subscribeRoomBroadcast`); chat page subscribes `room:<threadId>` on thread open and tears down on leave. **`user:<viewerId>` subscription and resync-on-reconnect/focus** still open.

**Implement**

- **Module:** Shared Realtime helpers own `private: true`, topic naming, teardown (`removeChannel`). Avoid scattered raw `supabase.channel(…)` in pages.
- **Thread:** On thread open → subscribe `room:<threadId>`; on navigate away / unmount → unsubscribe.
- **Optional:** On app load (post-auth) → subscribe `user:<viewerId>` for list/unread hints (not required for thread-only correctness).
- **Resync without trusting Realtime:** At least one authoritative **full** thread refetch on: Realtime reconnect, `document.visibilitychange` to **visible** (with thread open), and thread open (if not already loading). Same `GET` as today; no delta.
- No `service_role` in browser.

**Validate**

- Two clients in same thread: message from A appears in B’s UI after `dirty` (or after focus/reconnect resync if broadcast was missed).
- Leaving a thread does not leave zombie subscriptions; reopening re-subscribes cleanly.
- After airplane mode / sleep / killed WS: when focus or reconnect returns, UI matches server after one fetch.

---

## Phase 5 — Delta fetch

**Optional optimization.** Extend `GET /api/chat/threads/:threadId/messages` with `after` / `since` (or cursor) so `dirty` triggers a **small** fetch instead of reloading the whole page. Merge by message id so duplicate events or debounce are idempotent.

**Validate**

- No duplicate rows if event replays; new messages appear without full list reload.

---

## Exit criteria (whole feature)

- [ ] Unauthenticated clients cannot subscribe to private Broadcast channels; authenticated clients can (topic-level gating is optional; API is authoritative for data).
- [ ] Broadcast payloads never contain full message body.
- [ ] Chat source of truth remains API + `prsn_chat_*`; Realtime is invalidation only.
