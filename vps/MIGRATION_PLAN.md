# VPS / Beta Migration Plan

## Goal

Introduce a VPS-backed beta alongside the current Vercel deployment without
duplicating the full application. The work is intentionally split into two
separate scopes.

## Scope 1: Beta authentication and shared state

This scope establishes beta as a real, authenticated companion to the current
site without moving uploads or the broader application yet.

Acceptance criteria:

- users can log in, sign up, log out, and reset passwords on beta;
- logging in on current leaves the user logged in on beta;
- logging in on beta leaves the user logged in on current;
- logging out or expiring a session on either host is reflected on the other;
- beta can show basic safe information about the authenticated user;
- current remains the owner of normal application traffic and uploads.

Out of scope for Scope 1:

- large-file handling;
- changing the current frontend upload path;
- moving workers or QStash;
- migrating the full application to the VPS.

## Scope 2: Canonical media and upload boundary

Only after Scope 1 is working do we transfer upload responsibility fully to
beta. This is not a dual-path experiment: `cdn.parascene.com` becomes the one
active upload path for both current and beta.

Acceptance criteria:

- current and beta both upload through `cdn.parascene.com`;
- uploads never pass through the Vercel application;
- the VPS streams uploads to Supabase Storage;
- the existing upload response contract remains usable by all current upload
  producers;
- image, edited-image, chat-file, and other upload paths are covered;
- share/media delivery can use the same canonical `cdn` boundary.

The old Vercel upload route may remain available as a rollback mechanism, but
it is not a second active product path after the Scope 2 cutover.

## Hosting boundaries

```text
www.parascene.com   Current application (Vercel during migration)
beta.parascene.com  Focused beta auth/demo application (VPS)
cdn.parascene.com   Canonical share, media, and upload boundary
                    (Cloudflare-proxied initially)
```

The beta is not initially a second copy of the entire Parascene application.
It should expose only the smallest useful surface: auth, session/profile
visibility, share/media routes, and the upload demonstration.

`sh.parascene.com` remains a legacy compatibility hostname while existing
share links are transitioned to `cdn.parascene.com/s/...`. New links should
use the canonical `cdn` hostname.

## Authentication

Parascene's existing `ps_session` cookie remains the canonical browser
session. Current and beta must share:

- the same `SESSION_SECRET`;
- the same session database;
- the same cookie name and JWT format;
- a cookie domain of `.parascene.com`;
- the same login, logout, expiry-refresh, and password-reset behavior.

The beta should reuse the current auth/session implementation patterns rather
than inventing a second identity system. Supabase Auth/Realtime session
hydration is a separate browser concern because local storage is origin
specific; the first beta milestone can validate the shared Parascene session
directly.

## Canonical upload path

There is one active upload path after the upload scope lands:

```text
current frontend ─┐
                   ├─> https://cdn.parascene.com/upload/*
beta frontend ────┘                         │
                                           ▼
                                  VPS streaming gateway
                                           │
                                           ▼
                                  Supabase Storage
```

The frontend must not know or call Supabase directly. The VPS owns
authentication, authorization, quotas, file naming, streaming, storage writes,
and the response contract used by the existing upload helpers.

Cloudflare proxying is acceptable for the initial rollout. The current app
limit is approximately 50 MiB, so the initial beta can live within the
Cloudflare Free/Pro 100 MB request-body limit. Larger files can later move to
resumable/multipart upload rather than changing the public hostname or API
contract.

The VPS must stream request bodies; it must not use the current buffered
`express.raw()` approach for large-file handling.

## Suggested `vps/` structure

```text
vps/
├── routes/                  Auth, profile, share, media, upload routes
│   ├── middleware/          Cookie auth, CORS, limits, request context
│   └── utils/                URL, storage, upload, and response helpers
├── db/                      Focused database adapter(s)
├── pages/                   Self-contained beta page modules
│   ├── index/               index.html and landing-page assets
│   └── auth/                auth.html, auth.css, auth.js
├── public/                  Browser/static assets
└── server.js                Beta process entry point
├── config/                  Deployment/runtime configuration templates
├── Dockerfile               Beta image definition
├── nginx/                   Host routing and upload timeout examples
├── scripts/                 Health checks, migrations, and local helpers
└── README.md                VPS development and deployment notes
```

The structure should follow the current app's patterns where useful:
small route factories, shared utilities, explicit environment configuration,
and separate server startup from route behavior. It should not import the
entire `api/index.js` just to serve beta.

The initial Scope 1 implementation uses this structure for the shared-session
auth slice. Password reset/email delivery and the authenticated beta profile
surface remain follow-on work before Scope 1 is considered complete.

## Migration sequence

### Scope 1

1. Build beta's shared-cookie auth surface.
2. Verify login and logout in both directions between current and beta.
3. Add the basic authenticated profile/session view.

### Scope 2

4. Establish Cloudflare routing for `cdn.parascene.com`.
5. Implement the VPS streaming upload gateway.
6. Change the current frontend's centralized upload client to use `cdn`.
7. Verify image, edited-image, chat-file, and other upload producers through
   the single canonical path.

### Later scopes

8. Add VPS workers and durable job processing later.
9. Migrate broader application traffic only after beta proves stable.
