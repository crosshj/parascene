# Supabase Realtime Broadcast for Chat Invalidation

Use **Supabase Realtime Broadcast on private channels** as a thin invalidation bus.

Do **not** use Postgres Changes for this.

## Goal

Keep chat truth in your API/database.

Use Supabase only to broadcast tiny invalidation events.

On event, the client fetches authoritative data from your API using a cursor.

## Architecture

- app load: subscribe to `user:<userId>`
- room open: subscribe to `room:<roomId>`
- message saved by API: server broadcasts a tiny `dirty` event
- clients receive event and call `GET /api/rooms/:roomId/messages?after=<lastSeenMessageId>`

## Rules

- channels must be private
- browser auth is required before subscribing
- API/database remains source of truth
- payloads stay tiny
- `service_role` never goes to the browser
- clients must resync on reconnect, tab focus, and room open

## Install

```bash
npm i @supabase/supabase-js
```

## Channel naming

Use these topic shapes:

```text
user:<uuid>
room:<roomId>
```

## Database table

Create a room membership table:

```sql
create table public.room_members (
	user_id uuid not null references auth.users(id) on delete cascade,
	room_id text not null,
	primary key (user_id, room_id)
);

alter table public.room_members enable row level security;
```

## Realtime authorization policies

Supabase private channel authorization is controlled with RLS policies on `realtime.messages`.

Use this starting point:

```sql
create policy "allow user channel read"
on realtime.messages
for select
to authenticated
using (
	realtime.topic() = 'user:' || auth.uid()::text
);

create policy "allow room channel read for members"
on realtime.messages
for select
to authenticated
using (
	exists (
		select 1
		from public.room_members rm
		where rm.user_id = auth.uid()
		and realtime.topic() = 'room:' || rm.room_id
	)
);

create policy "allow server/client broadcast on allowed topics"
on realtime.messages
for insert
to authenticated
with check (
	realtime.messages.extension = 'broadcast'
	and (
		realtime.topic() = 'user:' || auth.uid()::text
		or exists (
			select 1
			from public.room_members rm
			where rm.user_id = auth.uid()
			and realtime.topic() = 'room:' || rm.room_id
		)
	)
);
```

## Browser client

Use the user's normal Supabase auth session.

Private channel subscriptions must use `config: { private: true }`.

```ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL!,
	process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export function subscribeUser(userId: string, onDirty: (payload: any) => void) {
	return supabase
		.channel(`user:${userId}`, { config: { private: true } })
		.on('broadcast', { event: 'dirty' }, ({ payload }) => onDirty(payload))
		.subscribe()
}

export function subscribeRoom(roomId: string, onDirty: (payload: any) => void) {
	return supabase
		.channel(`room:${roomId}`, { config: { private: true } })
		.on('broadcast', { event: 'dirty' }, ({ payload }) => onDirty(payload))
		.subscribe()
}

export function unsubscribeChannel(channel: any) {
	supabase.removeChannel(channel)
}
```

## Express server broadcaster

Broadcast only after your API write commits successfully.

```ts
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
	process.env.SUPABASE_URL!,
	process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function broadcastRoomDirty(roomId: string, afterMessageId: string) {
	const channel = supabaseAdmin.channel(`room:${roomId}`, {
		config: { private: true }
	})

	const { error } = await channel.send({
		type: 'broadcast',
		event: 'dirty',
		payload: {
			type: 'roomDirty',
			roomId,
			afterMessageId
		}
	})

	if (error) throw error
}
```

## API write flow

When a message is posted, your API should do this in order:

1. authenticate user
2. verify room membership
3. insert message in DB
4. broadcast `dirty` to `room:<roomId>`
5. optionally broadcast `dirty` to `user:<userId>` targets for unread count refresh

## Client fetch flow

On a `dirty` event:

- debounce for 100 to 300 ms
- fetch a delta, not a full history

Example:

```ts
GET /api/rooms/:roomId/messages?after=<lastSeenMessageId>
```

## Event payload

Keep it minimal:

```json
{
	"type": "roomDirty",
	"roomId": "abc",
	"afterMessageId": "msg_123"
}
```

Do not send full message bodies through Broadcast yet.

## Reconnect safety

Always perform one delta fetch on:

- reconnect
- tab focus
- room open

Realtime can drop. The API remains authoritative.

## Minimal implementation target for the coding assistant

```text
Implement Supabase Realtime Broadcast as a private invalidation bus for chat.

Requirements:
- Use private channels only.
- Topic format: user:<userId> and room:<roomId>.
- Chat data remains authoritative in our API/database.
- Browser subscribes on app load to user:<userId>.
- Browser subscribes on room open to room:<roomId>.
- On broadcast event 'dirty', client debounces and calls our API for deltas.
- Use GET /api/rooms/:roomId/messages?after=<lastSeenMessageId>.
- Server broadcasts only after successful DB commit.
- Payloads must be tiny invalidation hints only, never full message content.
- Use Supabase auth in browser.
- Use service_role only on server.
- Add RLS policies on realtime.messages so authenticated users can only join user:<theirId> and room:<roomId> where room_members contains their membership.
- Use supabase-js private channels with config: { private: true }.
- Add cleanup for unsubscribing room channels on leave/unmount.
- Add reconnect/tab-focus resync by calling delta fetch once.
```
