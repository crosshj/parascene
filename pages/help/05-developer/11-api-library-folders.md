---
title: API - Library folders
description: Sync desktop Library folders and creation memberships across devices
---

See [API Overview](/help/developer/api) for authentication, base URL, and the full route index.

## Overview

Library folders are **owner-scoped desktop organization metadata**: named folders and which creations belong in each. They do **not** store media bytes or project file trees.

This API is intended for **parascene-desktop** cross-machine sync. The web client does not use it yet.

Auth is the same as the rest of the API: **session cookie** or **`Authorization: Bearer psn_…`** (or a desktop OAuth access token). Without auth, responses are **401**.

Concurrency uses a single **account-level revision**. Mutate requests must send the revision they last observed. If the server has moved on, the mutate fails with **409** and returns the current snapshot. There is no silent last-write-wins.

## Snapshot shape

Both endpoints return:

| Field | Type | Description |
| --- | --- | --- |
| `revision` | number | Monotonic per-user sync revision (starts at `0`) |
| `folders` | array | All folders for the authenticated user |

Each folder object:

| Field | Type | Description |
| --- | --- | --- |
| `id` | string (uuid) | Stable folder id (client-generated on create) |
| `title` | string | Display title (max 200; empty becomes `Untitled folder`) |
| `description` | string | Optional text (max 2000) |
| `created_at` | string | ISO timestamp |
| `updated_at` | string | ISO timestamp |
| `creation_ids` | number[] | Owned creation ids in this folder, ordered by `added_at` then id |
| `member_count` | number | `creation_ids.length` |

Semantics match desktop Library folders today:

- Flat list (no nested folders).
- A creation belongs to **at most one** folder per user.
- Moving a creation into a folder removes it from any previous folder.
- `folder_id: null` on move means **unfiled**.

Limits:

- Max **500** folders per user
- Max **100** operations per mutate
- Max **500** `creation_ids` per create/move op

## `GET` `/api/library/folders`

Return the full snapshot for the current user.

**200** example:

```json
{
  "revision": 3,
  "folders": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "title": "Favorites",
      "description": "",
      "created_at": "2026-07-18T20:00:00.000Z",
      "updated_at": "2026-07-18T20:05:00.000Z",
      "creation_ids": [101, 102],
      "member_count": 2
    }
  ]
}
```

**401** if unauthenticated. **501** if the server has not applied the Library folders schema yet.

Responses use `Cache-Control: private, no-store`.

## `POST` `/api/library/folders/mutate`

Apply a batch of operations if `base_revision` matches the current server revision.

**Body (JSON):**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `base_revision` | number | yes | Last known revision (`baseRevision` alias accepted) |
| `operations` | array | yes | Ordered ops (`ops` alias accepted) |

### Operations

#### `create`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `op` | `"create"` | yes | Also accepts `type` |
| `id` | uuid string | yes | Client-generated UUID |
| `title` | string | no | Defaults to `Untitled folder` |
| `description` | string | no | Defaults to `""` |
| `creation_ids` | number[] | no | Optional initial members (`creationIds` alias) |

#### `update`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `op` | `"update"` | yes | |
| `id` | uuid string | yes | Existing folder |
| `title` | string | one of* | New title |
| `description` | string | one of* | New description |

\* Provide at least one of `title` / `description`.

#### `delete`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `op` | `"delete"` | yes | |
| `id` | uuid string | yes | Folder to delete (memberships removed) |

#### `move`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `op` | `"move"` | yes | |
| `folder_id` | uuid \| null | yes | Target folder, or `null` to unfile (`folderId` alias) |
| `creation_ids` | number[] | yes | Creations to move (`creationIds` alias) |

Creations must belong to the authenticated user. Unknown or foreign creation ids fail the whole batch with **400**.

### Example

```json
{
  "base_revision": 3,
  "operations": [
    {
      "op": "create",
      "id": "22222222-2222-4222-8222-222222222222",
      "title": "B-roll",
      "creation_ids": [103]
    },
    {
      "op": "move",
      "folder_id": "11111111-1111-4111-8111-111111111111",
      "creation_ids": [104, 105]
    },
    {
      "op": "update",
      "id": "11111111-1111-4111-8111-111111111111",
      "title": "Favorites"
    }
  ]
}
```

**200** on success: the new full snapshot (revision incremented by 1).

**409 Conflict** when `base_revision` is stale:

```json
{
  "error": "conflict",
  "message": "base_revision is stale; pull and retry",
  "revision": 4,
  "folders": []
}
```

**400** for invalid ops, unknown folder ids, non-owned creations, or limit violations. **401** unauthenticated. **501** schema/RPC unavailable.

The batch is atomic: either all operations apply and revision bumps, or none apply.

## Desktop sync algorithm

Recommended client flow for parascene-desktop:

1. Persist `cloud_revision` locally (start as unset / treat as needing pull).
2. On sync start, `GET /api/library/folders`.
3. If local folders still use non-UUID ids (for example `folder-<timestamp>-<pid>`), generate UUIDs once, rewrite local SQLite, and treat first upload as creates under those UUIDs.
4. Merge server snapshot into local SQLite when there are no pending local ops.
5. When the user changes folders locally, append ops to a pending queue (do not clear the queue until a mutate succeeds).
6. Before mutate, pull again if `cloud_revision` may be stale.
7. `POST /api/library/folders/mutate` with `base_revision = cloud_revision` and the pending ops.
8. On **200**, replace local folders with the returned snapshot and set `cloud_revision` to the returned revision; clear the acknowledged pending ops.
9. On **409**, replace local cloud baseline with the returned snapshot, then either:
   - replay still-valid pending ops against the new revision after automatic merge, or
   - present a conflict UI when the same folder/membership was edited on both sides.
10. Never force-overwrite by ignoring `base_revision`.

### Conflict guidance

Safe automatic merges:

- Creates with distinct folder ids
- Updates to different folders
- Moves of different creation ids
- Deletes of folders the other side did not edit

Needs explicit resolution (or last-change wins only after user confirmation):

- Same folder title/description edited on both devices
- Same creation moved into different folders offline
- One device deleted a folder the other still mutated

## Out of scope

- Project file trees / arbitrary blob sync
- Nested folders
- Version history / tombstone change feeds (full snapshot is enough for current folder counts)
- Web UI for Library folders
