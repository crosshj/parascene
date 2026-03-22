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

**Implement**

- After `POST /api/chat/threads/:threadId/messages` persists a row successfully, call `getSupabaseServiceClient()`, `channel('room:<threadId>', { config: { private: true } })`, `send({ type: 'broadcast', event: 'dirty', payload: { … } })` (minimal payload; `roomId` = thread id).
- Optionally broadcast on `user:<userId>` for unread/list invalidation (same pattern).

**Validate**

- Post message from client A; observe in Supabase Realtime inspector or a minimal test subscriber that `dirty` fires on `room:<threadId>` after DB commit.
- Failure path: DB insert fails → no broadcast.

---

## Phase 4 — Delta fetch from API

**Implement**

- On `dirty`, debounce 100–300 ms, then refetch **authoritative** messages (e.g. extend `GET /api/chat/threads/:threadId/messages` with `after`/`since` if current `before=` paging cannot load “only new” efficiently).

**Validate**

- Two clients in same thread: message from A appears in B’s UI after event without full reload.
- No duplicate rows if event replays or debounce fires twice (idempotent merge by message id).

---

## Phase 5 — Client subscribe lifecycle

**Implement**

- **Shared client module** (e.g. under `public/shared/`): expose **`subscribe`** (topic + event handler for `dirty`) and **`unsubscribe`** (or a returned teardown function). Callers must not scatter raw `supabase.channel(...).on(...).subscribe()` — the module owns `private: true`, channel naming (`user:` / `room:`), and `removeChannel` / cleanup.
- On app load (or post-auth): subscribe `user:<viewerId>`.
- On thread open: subscribe `room:<threadId>`; on navigate away / unmount: unsubscribe via that module.
- No `service_role` in browser.

**Validate**

- Leaving thread does not leave zombie subscriptions (channel count stable in devtools / no duplicate events).
- Opening thread again re-subscribes cleanly.
- Subscribing twice to the same topic is prevented or idempotent (no duplicate handlers).

---

## Phase 6 — Resync when Realtime is unreliable

**Implement**

- One authoritative delta or thread refetch on: Realtime reconnect, `document.visibilitychange` to visible, thread open.

**Validate**

- Missed broadcast (airplane mode toggle, sleep, or killed WS): after reconnect or focus, UI matches server after one fetch.

---

## Exit criteria (whole feature)

- [ ] Unauthenticated clients cannot subscribe to private Broadcast channels; authenticated clients can (topic-level gating is optional; API is authoritative for data).
- [ ] Broadcast payloads never contain full message body.
- [ ] Chat source of truth remains API + `prsn_chat_*`; Realtime is invalidation only.
