# Digest and engagement email system

**Important:** Work is divided into phases. **Stop after each phase** to validate before continuing.

---

## Phases (validation chunks)

### Phase 1: Settings and test recipient ✅ Done
- **Goal:** Admin-editable setting controls whether emails go to real users or `delivered@resend.dev`.
- **Deliverables:** Use `policy_knobs` for `email_use_test_recipient`; adapter methods to get/upsert by key; GET/PATCH `/admin/settings`; all existing email send paths (password reset, comment notification) respect the setting; admin UI toggle.
- **Validate:** Toggle on → trigger an email (e.g. password reset) → message goes to `delivered@resend.dev`. Toggle off → next email goes to real address.

### Phase 2: Cron endpoint and dry run (no real digest send yet) ✅ Done
- **Goal:** Cron endpoint exists, secured; decides who would get a digest and records to DB; does not send when dry run.
- **Deliverables:** Tables `email_link_clicks`, `email_sends`, `email_user_campaign_state`; adapter methods; `POST /api/notifications/cron` (or `/api/email/digest-run`) with secret auth; digest-only logic (users with recent activity, window + cap); insert `email_sends`, optional `email_dry_run` setting; no Resend call when dry run.
- **Validate:** Set digest window to “now”, dry run on; trigger cron; DB has `email_sends` rows; no emails sent. Turn dry run off, keep test recipient on → run again → emails to `delivered@resend.dev`.

### Phase 3: Digest email and remove direct comment email ✅ Done
- **Goal:** Digest is sent (to test address when setting on); direct per-comment email removed.
- **Deliverables:** Digest template; cron sends digest via Resend and updates `last_digest_sent_at`; remove immediate comment email in `comments.js`.
- **Validate:** Comments create activity; cron sends one digest to test address; no per-comment email.

### Phase 4: Welcome and first-creation nudge ✅ Done
- **Goal:** Cron sends welcome and “never created” nudge; caps so each at most once per user.
- **Deliverables:** State `welcome_email_sent_at`, `first_creation_nudge_sent_at`; cron logic + templates.
- **Validate:** New user gets welcome; user with no creations gets nudge; second run does not resend.
- **How to validate (Phase 4):** See [Phase 4 validation](#phase-4-validation) below.

### Phase 5: Re-engagement and highlight ✅ Done
- **Goal:** “We miss you” and “creation getting attention” emails with cooldowns.
- **Deliverables:** State for re-engagement and highlight; cron logic + templates.
- **Validate:** Inactive user and “hot” creation get one email each; cooldowns prevent repeat.

### Phase 6: Admin sends UI
- **Goal:** Admin sees recent sends.
- **Deliverables:** Admin API list sends; admin UI table.
- **Validate:** Run cron, open admin → see sends.

### Phase 7: Admin-editable email/cron settings UI
- **Goal:** All tunables (windows, caps, test recipient, dry run, welcome delay, re-engagement, etc.) in `policy_knobs` and editable in admin.
- **Deliverables:** Cron reads all values from settings; admin UI form(s) to edit.
- **Validate:** Change e.g. max digests to 0, run cron → no digest; change back → digest sends again.

---

## Design notes

- **Real vs test recipient:** Controlled by admin setting `email_use_test_recipient` (not env). When on, all lifecycle/transactional emails go to `delivered@resend.dev` (optionally with label e.g. `+digest`).
- **Settings store:** Use existing `policy_knobs` (key/value) for email and cron settings; admin can tweak without deploy.
- **Cron auth:** Endpoint protected by shared secret (e.g. `Authorization: Bearer CRON_SECRET`).
- **Sends:** Every send stored in `email_sends` for caps and admin visibility.

---

## Phase 4 validation

**Prerequisites:** `CRON_SECRET` and `RESEND_*` env set; admin has “use test recipient” on so emails go to `delivered@resend.dev`.

1. **Welcome email (once per user)**  
   - Ensure at least one user exists whose account is older than the welcome delay (default 1 hour) and who has **never** been sent a welcome email (no `welcome_email_sent_at` in `email_user_campaign_state` for that user).  
   - In a valid UTC digest window (or set `digest_utc_windows` so current hour is included), call:  
     `POST /api/notifications/cron` with `Authorization: Bearer <CRON_SECRET>`.  
   - Check the JSON response: `welcomeSent` should be ≥ 1 if such a user existed.  
   - Check inbox for `delivered@resend.dev` (or Resend dashboard): one “Welcome to parascene” email.  
   - Call the cron again (same or next run): `welcomeSent` for that user should be 0 and no second welcome email.

2. **First-creation nudge (once per user, no creations)**  
   - Ensure at least one user exists who has **zero** creations and has **never** been sent the first-creation nudge (no `first_creation_nudge_sent_at` for that user).  
   - Call the cron again (same conditions as above).  
   - Check response: `firstCreationNudgeSent` should be ≥ 1 if such a user existed.  
   - Check inbox/Resend: one “Your first creation is waiting” email.  
   - Call the cron again: `firstCreationNudgeSent` for that user should be 0 and no second nudge.

3. **Dry run**  
   - Turn on `email_dry_run` (or set digest dry run so no emails are sent). Trigger cron.  
   - No welcome or first-creation-nudge emails should be sent; `welcomeSent` and `firstCreationNudgeSent` should be 0.  
   - Turn dry run off and confirm the next run can send again (e.g. use a different eligible user or reset state in DB for one user to re-test).
