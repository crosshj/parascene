# Digest and engagement email system

**Important:** Work is divided into phases. **Stop after each phase** to validate before continuing.

---

## Phases (validation chunks)

### Phase 1: Settings and test recipient
- **Goal:** Admin-editable setting controls whether emails go to real users or `delivered@resend.dev`.
- **Deliverables:** Use `policy_knobs` for `email_use_test_recipient`; adapter methods to get/upsert by key; GET/PATCH `/admin/settings`; all existing email send paths (password reset, comment notification) respect the setting; admin UI toggle.
- **Validate:** Toggle on → trigger an email (e.g. password reset) → message goes to `delivered@resend.dev`. Toggle off → next email goes to real address.

### Phase 2: Cron endpoint and dry run (no real digest send yet)
- **Goal:** Cron endpoint exists, secured; decides who would get a digest and records to DB; does not send when dry run.
- **Deliverables:** Tables `email_sends`, `user_email_campaign_state`; `email_link_clicks`; adapter methods; `POST /api/notifications/cron` (or `/api/email/digest-run`) with secret auth; digest-only logic (users with recent activity, window + cap); insert `email_sends`, optional `email_dry_run` setting; no Resend call when dry run.
- **Validate:** Set digest window to “now”, dry run on; trigger cron; DB has `email_sends` rows; no emails sent. Turn dry run off, keep test recipient on → run again → emails to `delivered@resend.dev`.

### Phase 3: Digest email and remove direct comment email
- **Goal:** Digest is sent (to test address when setting on); direct per-comment email removed.
- **Deliverables:** Digest template; cron sends digest via Resend and updates `last_digest_sent_at`; remove immediate comment email in `comments.js`.
- **Validate:** Comments create activity; cron sends one digest to test address; no per-comment email.

### Phase 4: Link tracking
- **Goal:** Links in emails include `send_id`; app records click and redirects without leaking params.
- **Deliverables:** Helper to build links with `?ref=email&send_id=...`; endpoint or middleware to record click and redirect; `email_link_clicks` populated.
- **Validate:** Click CTA in digest; one row in `email_link_clicks`; URL clean after redirect.

### Phase 5: Welcome and first-creation nudge
- **Goal:** Cron sends welcome and “never created” nudge; caps so each at most once per user.
- **Deliverables:** State `welcome_email_sent_at`, `first_creation_nudge_sent_at`; cron logic + templates; links with tracking.
- **Validate:** New user gets welcome; user with no creations gets nudge; second run does not resend.

### Phase 6: Re-engagement and highlight
- **Goal:** “We miss you” and “creation getting attention” emails with cooldowns.
- **Deliverables:** State for re-engagement and highlight; cron logic + templates; links with tracking.
- **Validate:** Inactive user and “hot” creation get one email each; cooldowns prevent repeat.

### Phase 7: Admin sends and effectiveness UI
- **Goal:** Admin sees recent sends and click counts.
- **Deliverables:** Admin API list sends + clicks; admin UI table (and optional CTR).
- **Validate:** Run cron, open admin → see sends; click links → see clicks.

### Phase 8: Admin-editable email/cron settings UI
- **Goal:** All tunables (windows, caps, test recipient, dry run, welcome delay, re-engagement, etc.) in `policy_knobs` and editable in admin.
- **Deliverables:** Cron reads all values from settings; admin UI form(s) to edit.
- **Validate:** Change e.g. max digests to 0, run cron → no digest; change back → digest sends again.

---

## Design notes

- **Real vs test recipient:** Controlled by admin setting `email_use_test_recipient` (not env). When on, all lifecycle/transactional emails go to `delivered@resend.dev` (optionally with label e.g. `+digest`).
- **Settings store:** Use existing `policy_knobs` (key/value) for email and cron settings; admin can tweak without deploy.
- **Cron auth:** Endpoint protected by shared secret (e.g. `Authorization: Bearer CRON_SECRET`).
- **Tracking:** Every send stored in `email_sends`; links include `send_id`; hits recorded in `email_link_clicks`.
