# Plan: chat (API / DB first)

## Scope

- **In:** Supabase Postgres (source of truth), Express API on Vercel, smoke test script (`scripts/test-chat.js`).
- **Later:** WebSockets / Supabase Realtime.
- **UI:** Connect route (`app-route-servers`): **Chat** tab (default), list + channel opener + thread view; uses **`GET /api/chat/threads`** (requires **`prsn_chat_threads_for_user`** in `db/schemas/supabase_04.sql`).

## Data model

- **`prsn_chat_threads`**: `type` = `dm` | `channel`; DM uses unique **`dm_pair_key`** (`min_user_id:max_user_id`); channel uses unique **`channel_slug`** (normalized tag).
- **`prsn_chat_members`**: `(thread_id, user_id)`; membership enforced on read/write.
- **`prsn_chat_messages`**: `thread_id`, `sender_id`, `body`, `created_at`; index **`(thread_id, created_at DESC, id DESC)`** for pagination.

## API

- **Auth:** Same as rest of API (`req.auth.userId` from session or `Authorization: Bearer psn_…`).
- **POST `/api/chat/dm`**: body `{ other_user_id }` → get or create DM thread; both users added as members.
- **POST `/api/chat/channels`**: body `{ tag }` → get or create channel thread; caller added as member.
- **GET `/api/chat/threads/:threadId/messages`**: `limit`, optional `before` (opaque cursor) → **chronological** page (oldest→newest within window); **`hasMore`**, **`nextBefore`** for older history.
- **POST `/api/chat/threads/:threadId/messages`**: body `{ body }` → append message (member only).

## Tag normalization

- Reuse rules aligned with explore: lowercase, length/pattern; strip leading `#` from input.

## Redis

- **Phase 1:** Optional rate limiting on send (Upstash), fail-open if Redis missing.

## Files

- Schema: `db/schemas/supabase_03.sql` (apply in Supabase SQL editor or migration flow). Includes RPC `prsn_chat_messages_page` for cursor pagination.
- Routes: `api_routes/chat.js`.
- Tag helper: `api_routes/utils/tag.js` (used by explore + chat).
- Test: `scripts/test-chat.js` (same env style as `scripts/test-api.js`).
