# Supabase Realtime Broadcast for Chat Invalidation

Use **Supabase Realtime Broadcast on private channels** as a thin invalidation bus. Do **not** use Postgres Changes for this.

## Goal

Chat data stays authoritative in our API and database (`prsn_chat_*`, see `db/schemas/supabase_03_chat.sql`). Supabase only carries tiny “something changed” hints; clients refetch from the API.

## Architecture

- **App load:** subscribe to `user:<userId>` (app user id as string).
- **Thread open:** subscribe to `room:<threadId>` (use chat `thread_id`).
- **After a message commits:** server broadcasts event `dirty` on the thread channel (and optionally per-user channels for unread).
- **On `dirty`:** client debounces (about 100–300 ms) and loads new data from the chat API (not from the broadcast payload).

## Rules

- Private channels only; subscribe only with a Supabase-authenticated browser session.
- Payloads are tiny hints only; never ship full message bodies over Broadcast.
- `service_role` stays server-side — use existing `getSupabaseServiceClient()` in `api_routes/utils/supabaseService.js`.
- Resync on reconnect, tab focus, and thread open (Realtime can drop events).

## Already in this repo

- `@supabase/supabase-js` dependency and service-role client helper (`api_routes/utils/supabaseService.js`).
- Chat HTTP API and persistence: `api_routes/chat.js`, members in `prsn_chat_members`, messages via `GET /api/chat/threads/:threadId/messages` (cursor `before=` today).

## Still to implement for Broadcast

1. **Browser:** `createClient` with project URL + anon key (exposed to browser-side JS without a bundler — e.g. inlined from server env), then `channel(\`room:${threadId}\`, { config: { private: true } }).on('broadcast', { event: 'dirty' }, …).subscribe()` (and the same pattern for `user:${userId}`). Remove channel on thread leave.
2. **Server:** after a successful insert in `POST /api/chat/threads/:threadId/messages`, call `channel.send({ type: 'broadcast', event: 'dirty', payload: { … } })` via the service client (same topic names as above).
3. **RLS on `realtime.messages`:** **authenticated** may `select` (receive) broadcast; **insert** is not granted to them — **service_role** bypasses RLS for server publishes. Defined in `db/schemas/supabase_03_chat.sql`.

## Payload shape (keep minimal)

```json
{
	"type": "roomDirty",
	"roomId": "123",
	"afterMessageId": "456"
}
```

`roomId` here is the chat **thread** id. Extend or add a delta query on the messages route if you need “messages newer than X” beyond current `before=` pagination.
