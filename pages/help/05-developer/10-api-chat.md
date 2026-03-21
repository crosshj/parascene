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

Open or resume a **direct message** thread with another user (by internal user id).

**Body (JSON):**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `other_user_id` | number | yes* | Other participant’s user id (`prsn_users.id`) |
| `otherUserId` | number | yes* | Same as `other_user_id` (camelCase alias) |

\* Provide **one** of these keys.

**Example:**

```json
{ "other_user_id": 42 }
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

**400** if `other_user_id` is missing/invalid or you target yourself. **404** if the other user does not exist.

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
      "created_at": "2026-03-21T17:29:48.897972+00:00"
    }
  ],
  "hasMore": false,
  "nextBefore": "eyJjIjoiMjAyNi0wMy0yMVQxNzoyOTo0OC4..."
}
```

- **`messages`**: ordered **oldest → newest** within the page.
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

### Errors

Structured errors typically look like:

```json
{ "error": "Bad request", "message": "body required" }
```

**503** may be returned if chat storage is not available on the server.
