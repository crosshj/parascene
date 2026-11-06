# Plan: auth gate, no try funnel

Goal: members-first product. No try-before-signup. Landing explains the site; signup requires verified email; first sign-in is username only; social login for major providers.

Current gaps: `/try` and `/api/try/create` bypass auth. Signup logs in immediately with no email verify. Welcome is 4 steps (username, display name, character, avatar). No social sign-in (Google OAuth is Photos/API only).

---

Phase 1 — kill public try

- `/try` redirect to `/auth#signup`
- Landing and share: remove prompt form and policy→try routing; CTAs to auth
- Share page: drop guest create block; keep unfurl/view for logged-in or view-only guests (decide in open questions)
- `POST /api/try/create`: 401 without session (welcome/admin avatar still uses try internally until migrated)
- Remove anon try from welcomeGate allow list for unauthenticated callers
- Stop relying on `ps_cid` / policy funnel for conversion

Touch: `api_routes/try.js`, `api_routes/pages.js`, `pages/index.html`, `public/pages/index.js`, `public/pages/share.js`, `api_routes/middleware/welcomeGate.js`, `api_routes/policy.js`

Done when: anonymous user cannot generate anywhere; share/landing never send to `/try`.

---

Phase 2 — video landing

- Hero: embedded video (asset TBD) + short copy + Sign up / Log in
- Remove generate form and “no payment / start creating” copy
- Strip policy checks and prompt rotation from `public/pages/index.js`
- Lower marketing sections optional trim

Touch: `pages/index.html`, `public/pages/index.css`, `public/pages/index.js`

Done when: logged-out `/` is video + auth CTAs only at top; no creation path without account.

---

Phase 3 — email verification

Reuse password-reset token pattern (`user.meta`, Resend, `auth?…#` sections).

- Signup: create user, do not set session cookie; store `verification_token_hash` + expiry in meta; send verification email
- New template `renderEmailVerification` in `email/templates.js`
- `GET /auth?vt=…#verify`: validate token, set `email_verified_at`, create session, redirect `/welcome`
- Login: reject if not verified; offer resend
- Auth UI: post-signup “check email”; verify error state
- Grandfather: existing users without flag = verified on login

Touch: `api_routes/user.js`, `pages/auth.html`, `email/templates.js`, `public/pages/entry/entry-auth.js` if needed

Done when: new email signups cannot use app until link clicked.

---

Phase 4 — slim welcome

Server on first `PUT /api/profile`:

- `display_name` = `user_name` when unset
- `meta.character_description` from `genProfile(userId)` (`public/shared/characterGenerator.js`) — deterministic, no user input
- Optional: queue background avatar via authenticated create (not anon try)

UI: one screen — username + availability check + submit. Remove display name, character textarea, avatar generate, review steps.

`computeWelcome` already only requires username; UI catches up.

Touch: `pages/welcome.html`, `public/pages/welcome.js`, `public/pages/welcome.css`, `api_routes/user.js`

Done when: new user picks username once and lands in app; character prefilled in meta.

---

Phase 5 — social sign-in

No social login today. Recommend Supabase Auth OAuth (Google, Apple, third) + sync to `prsn_users` on callback, set existing JWT cookie. Email/password flow stays separate with verification.

- Enable providers in Supabase dashboard
- Routes: OAuth start + callback
- Link or create user by email; store `meta.auth_provider` + provider id
- Social users: skip email verify if provider email verified
- Auth page: provider buttons on login and signup

Touch: new `api_routes/socialAuth.js` or extend auth, `pages/auth.html`, env vars, Supabase config

Done when: Google + Apple + chosen third provider sign-in works end-to-end.

Follow-up (not blocking): migrate welcome/admin avatar off `/api/try/*` to authenticated create; retire anon tables when unused.

---

Order

1 and 2 can ship together. 3 before 4. 5 after 3 (or parallel if OAuth infra ready).

---

Open questions

- Share links for guests: view-only preview + signup CTA, or login required to view?
- Landing video URL or file path?
- Third social provider: Facebook or GitHub?
- Avatar at welcome: skip, or background after username?
- Anon try DB rows: leave read-only or migration cleanup later?
