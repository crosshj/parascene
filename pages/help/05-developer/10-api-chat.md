---
title: API - Chat
description: DM and channel threads, messages, and pagination for the parascene API
---

See [API Overview](/help/developer/api) for authentication, base URL, and the full route index.

## Overview

Chat supports **DM threads** (two users) and **hashtag channels** (one thread per normalized tag). All routes require the same auth as the rest of the API (**session cookie** or **`Authorization: Bearer psn_…`**); without auth, responses are **401**. For `POST` requests, send **`Content-Type: application/json`** with the JSON bodies below.

### Channel tag format

For `POST /api/chat/channels`, the server reads **`tag`** or **`channel`**. It **strips leading `#`**, trims, lowercases, then validates:

- Must match **`[a-z0-9][a-z0-9_-]{1,31}`** (2–32 characters total after normalization).

Invalid or empty values return **400** with a JSON error body.

### `POST` `/api/chat/dm`

Open or resume a **direct message** thread with another user. Identify the other participant **either** by internal user id **or** by their public **username** (same handle as on profiles).

**Body (JSON):**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `other_user_id` | number | one group* | Other participant’s user id (`prsn_users.id`) |
| `otherUserId` | number | one group* | Same as `other_user_id` (camelCase alias) |
| `other_user_name` | string | one group* | Normalized handle: lowercase, optional leading `@`; must match **`[a-z0-9][a-z0-9_]{2,23}`** (same rules as profile usernames) |
| `otherUsername` | string | one group* | Alias for `other_user_name` |
| `username` | string | one group* | Alias for `other_user_name` |

\* Send **either** an id field **or** a username field (not both required). If **`other_user_id`** / **`otherUserId`** is present and parses as a positive number, that id is used. Otherwise the server resolves **`other_user_name`** (or an alias) via **`user_profiles.user_name`**.

**Examples:**

```json
{ "other_user_id": 42 }
```

```json
{ "other_user_name": "friend" }
```

**200** response:

```json
{
  "thread": {
    "id": 123,
    "type": "dm",
    "dm_pair_key": "12:42",
    "channel_slug": null
  }
}
```

**400** if no valid id or username is provided, the username is invalid, or you target yourself. **404** if the other user does not exist. **503** if username lookup is unavailable on the server (missing query support).

On the website, DM URLs often use the handle, for example **`/chat/dm/friend`**; an all-numeric path segment (e.g. **`/chat/dm/42`**) is still interpreted as a **user id** for backward compatibility.

### `POST` `/api/chat/channels`

Get or create a **channel** for a tag and add the current user as a member.

**Body (JSON):**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tag` | string | yes* | Hashtag / slug (see [Channel tag format](#channel-tag-format)) |
| `channel` | string | yes* | Alias for `tag` |

\* Provide **`tag`** or **`channel`**.

**Example:**

```json
{ "tag": "pixelart" }
```

**200** response:

```json
{
  "thread": {
    "id": 456,
    "type": "channel",
    "channel_slug": "pixelart",
    "dm_pair_key": null
  }
}
```

### `GET` `/api/chat/threads`

List **threads you belong to** (DMs and channels), each with a **`title`** for display, optional **`last_message`** preview, and **`viewer_id`** set to your user id. Rows are ordered by **recent activity** (last message time, then thread creation).

**200** response:

```json
{
  "viewer_id": 12,
  "threads": [
    {
      "id": 456,
      "type": "channel",
      "channel_slug": "pixelart",
      "title": "#pixelart",
      "last_message": {
        "body": "hello",
        "created_at": "2026-03-21T12:00:00.000000+00:00",
        "sender_id": 12
      }
    },
    {
      "id": 123,
      "type": "dm",
      "dm_pair_key": "10:42",
      "other_user_id": 42,
      "title": "@friend",
      "other_user": {
        "id": 42,
        "display_name": "Friend",
        "user_name": "friend",
        "avatar_url": null
      },
      "last_message": null
    }
  ]
}
```

The database must define **`prsn_chat_threads_for_user`** (see `db/schemas/supabase_04.sql`).

### `GET` `/api/chat/threads/:threadId`

Return thread metadata if you are a member.

**200** response:

```json
{
  "thread": {
    "id": 456,
    "type": "channel",
    "dm_pair_key": null,
    "channel_slug": "pixelart",
    "created_at": "2026-03-21T12:00:00.000000+00:00"
  }
}
```

**403** if you are not a member; **404** if the thread does not exist.

### `GET` `/api/chat/threads/:threadId/messages`

Paginated **message history**. With **no** `before` query parameter, returns the **latest** messages (newest at the **end** of the `messages` array). Pass **`before`** to load **older** pages (e.g. scroll up).

**Query parameters:**

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `limit` | number | `50` | Page size (maximum **100**) |
| `before` | string | — | Opaque cursor from the previous response’s `nextBefore` |

**200** response:

```json
{
  "messages": [
    {
      "id": 1,
      "thread_id": 456,
      "sender_id": 26,
      "body": "hello",
      "created_at": "2026-03-21T17:29:48.897972+00:00",
      "sender_user_name": "alice",
      "sender_avatar_url": null,
      "reactions": { "heart": 2, "thumbsUp": 1 },
      "viewer_reactions": ["heart"]
    }
  ],
  "hasMore": false,
  "nextBefore": "eyJjIjoiMjAyNi0wMy0yMVQxNzoyOTo0OC4..."
}
```

- **`messages`**: ordered **oldest → newest** within the page.
- **`sender_user_name`** / **`sender_avatar_url`**: optional profile fields for the sender.
- **`reactions`**: optional map of allowed emoji keys to **counts** (toggle your own via `POST /api/chat/messages/:messageId/reactions`).
- **`viewer_reactions`**: emoji keys the current user has applied on this message.
- **`hasMore`**: `true` if older messages exist; request again with **`before`** set to **`nextBefore`**.
- **`nextBefore`**: use as **`before`** on the **next** request to fetch the **next older** page. `null` when there is no further cursor (e.g. empty page).

Do not construct **`before`** manually; it is an opaque **base64url** token.

**403** if not a member; **400** for invalid `threadId` or invalid `before`.

### `POST` `/api/chat/threads/:threadId/messages`

Send a message in a thread you belong to.

**Body (JSON):**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `body` | string | yes | Non-empty text after trim; **maximum 4000** characters |

**Example:**

```json
{ "body": "Hello from the API" }
```

**201** response:

```json
{
  "message": {
    "id": 2,
    "thread_id": 456,
    "sender_id": 26,
    "body": "Hello from the API",
    "created_at": "2026-03-21T18:00:00.000000+00:00"
  }
}
```

**429** if send rate limits are exceeded for your user. **403** if not a member; **400** for empty or oversized `body`.

### `POST` `/api/chat/messages/:messageId/reactions`

Toggle your reaction on a **chat message** (add if absent, remove if present). You must be a **member of the message’s thread**.

**Body (JSON):**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `emoji_key` | string | yes | One of the allowed keys (same set as comment reactions): `thumbsUp`, `thumbsDown`, `heart`, `joy`, `grin`, `openMouth`, `sad`, `angry`, `clap`, `hundred`, `fire`, `thinking`, `eyes`, `rocket`, `pray` |

**Example:**

```json
{ "emoji_key": "heart" }
```

**200** response:

```json
{ "added": true, "count": 3 }
```

- **`added`**: `true` if you added the reaction, `false` if you removed it.
- **`count`**: total reactors for that emoji on the message after the toggle.

**400** for invalid `messageId` or `emoji_key`. **403** if you are not a thread member. **404** if the message does not exist.

### Errors

Structured errors typically look like:

```json
{ "error": "Bad request", "message": "body required" }
```

**503** may be returned if chat storage is not available on the server.
