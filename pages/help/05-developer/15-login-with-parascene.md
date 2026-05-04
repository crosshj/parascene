---
title: Log in with Parascene (developer)
description: Register an app you build, PKCE, tokens, and where users revoke access
---

Third-party apps can use an authorization-code flow with PKCE. End users sign in on Parascene and approve access; **your server** exchanges the code using **your** Parascene API key (`psn_…`) and receives short-lived access tokens to call APIs as that user. Users revoke access on the **Connections** page (`/integrations`, account menu) under **Sites & apps you use**. Your Parascene API key for token exchange is on the same page under **API & credentials**.

For general API usage (personal API key, route list), see **[API Overview](/help/developer/api)**.

## Prerequisites

- A Parascene account for the integration developer.
- An API key from **Connections** → **parascene API** → **Generate** (`/integrations`). Send `Authorization: Bearer psn_…` only from your **backend**—never in browser JavaScript.

## Register an integration app

**In the app:** open the **profile menu** (avatar, top right) and choose **Connections** (or go to `/integrations`). Under **Apps you build**, register an app: enter a display name and one or more redirect URIs; your public **`client_id`** appears after you create the app. Generate your API key under **API & credentials** on that same page if you have not already.

**Or** use a normal browser session and the API (cookie auth, same as the UI):

`POST /api/integration/apps`

Body (JSON):

```json
{
  "name": "My App",
  "redirect_uris": ["https://myapp.com/oauth/callback"]
}
```

The response includes **`client_id`** (public). Save it.

- `PATCH /api/integration/apps/:client_id` — update `name` and/or `redirect_uris` (same JSON shape).
- `DELETE /api/integration/apps/:client_id` — remove the app registration.

Redirect URIs must **exactly** match the callback URL you use (scheme, host, path). Register `http://localhost:PORT/path` for local development if needed.

## Authorization URL (browser)

Send the user’s browser to:

`GET /oauth/authorize`

| Parameter | Value |
|-----------|--------|
| `response_type` | `code` |
| `client_id` | From registration |
| `redirect_uri` | One of the registered URIs (exact match) |
| `scope` | Optional; defaults include `openid profile` |
| `state` | Required; opaque CSRF token you verify on return |
| `code_challenge_method` | `S256` |
| `code_challenge` | PKCE: BASE64URL(SHA256(code_verifier)) |

Generate **`code_verifier`** (43–128 characters) and keep it server-side until the token step.

If the user is not signed in, they are redirected to sign in and then returned to this authorize URL. Users who have not finished onboarding may be sent to **Welcome** first.

## Token endpoint (server only)

`POST /oauth/token`

Headers:

- `Authorization: Bearer psn_<your developer API key>`
- `Content-Type: application/x-www-form-urlencoded`

**Authorization code exchange** (`grant_type=authorization_code`):

| Field | Description |
|-------|-------------|
| `grant_type` | `authorization_code` |
| `client_id` | Your app’s public `client_id` |
| `code` | The `code` query parameter from the redirect |
| `redirect_uri` | Same URI as in `/oauth/authorize` |
| `code_verifier` | Your PKCE verifier |

The API key must belong to the **same account** that registered `client_id`.

Success returns JSON: `access_token`, `token_type`, `expires_in` (about 15 minutes), `refresh_token`, `scope`.

**Refresh** (`grant_type=refresh_token`): send `client_id`, `refresh_token` (`prt_…`), same `Authorization: Bearer psn_…`. Store the latest refresh token if a new one is returned.

Errors use `error` and `error_description` (OAuth-style).

## Calling APIs as the user

Use the **access token** (JWT), not your API key:

```http
Authorization: Bearer <access_token>
```

This behaves like that user’s personal `psn_` key for allowed routes. It cannot manage account secrets (API key / Vynly token changes stay website-only).

**Profile claims:** `GET /oauth/userinfo` with the access token returns `sub`, `preferred_username`, `name`, and `picture`. Email appears only if the `email` scope is granted (reserved for future use).

Use your normal site origin (e.g. `https://www.parascene.com`) or your dev server—not necessarily the `api.` subdomain for OAuth paths (`/oauth/...`).

## End-user revocation

Users remove access on **Connections** under **Sites & apps you use**. After revocation, refresh tokens stop working and new API calls with old tokens should fail.

## Security checklist

- Always send `state` and verify it on callback.
- Use PKCE (`S256`).
- Never expose `psn_` or `prt_` tokens in frontend code.
- Use HTTPS redirect URIs in production.
