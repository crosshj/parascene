---
title: API Overview
description: Create a key and call the parascene API programmatically
---

## Create or manage a key

1. Sign in.
2. Open **Profile** (avatar / profile icon in the header; on small screens, open the menu first).
3. Under **API key**, choose **Generate API key** (or **Generate new key** to replace an existing one).
4. **Copy the key immediately.** It is shown only once. Rotating generates a new secret and invalidates the old one.
5. To revoke access, use **Remove API key**.

Key management (generate / remove) requires a normal browser session. You cannot create or delete keys using the API key itself.

## Use the key

Send the key on every request:

```http
Authorization: Bearer psn_<your-secret>
```

Use HTTPS. Treat the secret like a password; do not commit it to source control or expose it in client-side code.

## Base URL

Use **`https://api.parascene.com`** as the origin for all `/api/...` requests in this guide.

## API overview

Signed-in routes mirror the web app. For most routes, field-level contracts are not spelled out here—use the site’s network panel if you need exact bodies. **Chat** (DM + hashtag channels, messages, pagination) is documented in **[API - Chat](/help/developer/api-chat)**.

Image and video URLs for creations are returned on API objects; you do not need separate “asset path” routes for normal integration.

### Account, notifications

- `GET` `/api/profile`
- `PATCH` `/api/profile`
- `PUT` `/api/profile`
- `POST` `/api/profile`
- `POST` `/api/profile/avatar-from-creation`
- `PUT` `/api/account/email`
- `GET` `/api/notifications`
- `GET` `/api/notifications/unread-count`
- `POST` `/api/notifications/acknowledge`
- `POST` `/api/notifications/acknowledge-all`

### Feed & discovery

- `GET` `/api/feed`
- `GET` `/api/explore`
- `GET` `/api/explore/search`
- `GET` `/api/explore/search/semantic`
- `GET` `/api/personalities/:personality/creations`
- `GET` `/api/tags/:tag/creations`

### Creations (catalog)

- `GET` `/api/creations`
- `GET` `/api/creations/nsfw-flags`
- `GET` `/api/creations/:id/related`
- `GET` `/api/creations/:id/semantic-related`
- `GET` `/api/creations/:id/summary`
- `GET` `/api/embeddings/search`

### Users & follows

**Base:** `/api/users/:id` or `/api/users/by-username/:username` — append:

- `GET` `…/profile`
- `GET` `…/created-images`
- `GET` `…/liked-creations`
- `GET` `…/comments`
- `POST` `…/follow`
- `DELETE` `…/follow`
- `GET` `…/followers`
- `GET` `…/following`

### Create & images

- `POST` `/api/create/preview`
- `POST` `/api/create/query`
- `POST` `/api/create/validate`
- `POST` `/api/create`
- `GET` `/api/create/images`
- `GET` `/api/create/images/:id`
- `GET` `/api/create/images/:id/children`
- `POST` `/api/create/images/:id/share`
- `POST` `/api/create/images/:id/retry`
- `POST` `/api/create/images/:id/publish`
- `PUT` `/api/create/images/:id`
- `POST` `/api/create/images/:id/unpublish`
- `DELETE` `/api/create/images/:id`

### Engagement

- `GET` `/api/created-images/:id/like`
- `POST` `/api/created-images/:id/like`
- `DELETE` `/api/created-images/:id/like`
- `GET` `/api/comments/latest`
- `GET` `/api/created-images/:id/activity`
- `POST` `/api/created-images/:id/comments`
- `POST` `/api/comments/:commentId/reactions`

### Chat

- `GET` `/api/chat/threads`
- `POST` `/api/chat/dm`
- `POST` `/api/chat/channels`
- `GET` `/api/chat/threads/:threadId`
- `GET` `/api/chat/threads/:threadId/messages`
- `POST` `/api/chat/threads/:threadId/messages`
- `POST` `/api/chat/messages/:messageId/reactions`

Details: **[API - Chat](/help/developer/api-chat)**

### Servers

- `GET` `/api/servers`
- `GET` `/api/servers/:id`
- `POST` `/api/servers/:id/join`
