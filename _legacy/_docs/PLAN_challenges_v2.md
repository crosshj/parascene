# Plan: Challenges v2 — organize and participate

Source of truth for challenges v2 (replaces the retired PLAN_challenges_remaining.md).

Already shipped before this plan (do not re-do): SPA `/challenges/organize`, board CRUD + calendar + soft-delete, Draft vs Public in the edit modal, public Next / feed focus ignore unlisted drafts, shared challenges cache + soft live reconcile + save conflict, card chrome polish (pills, track meta, neutral cards).

Phases below are numbered in **ship order**. Phase 1 is song creations (Suno posts) so users can play with that while the rest of challenges v2 is built. Each phase ends with a team validation gate. User-facing journeys are spelled out in **User flows** near the end; phases point at them as `→ User flow Fn`.

## Direction, agreed

- Clock drives phases (unchanged). Pins + feed freshness fire from config (existing pin system). Card **Results** → Stats | Payout is the human payout path. Close voting may stay a card action; promo / winners / theme-vote pins are driven by dated slots on a dedicated **Announce** edit tab (creation URL + window), not one-off card Announce clicks. Organizer promo/winners creations used as editorial pins stay unpublished (feed can still show them while the pin is active).
- Prizes: structured numeric `prizes` on config (main 1st/2nd/3rd + optional top submitters/voters) is the single source of truth. Card copy is generated from the numbers ("400 credits"). Free-text `reward_first/second/third/participation` are RETIRED — existing configs were migrated in place (`db/maintenance/migrate-challenge-prizes.js`, 2026-08-02; backup jsonl beside it) and all legacy read paths removed. Only `reward_custom` stays free text. Participation prize *details* revealed only at results.
- Prize structures are per-challenge config, inherited from the most recent same-track challenge by **submission start date**. Only the first challenge of a track needs full definition (track presets).
- Feed keeps one engagement card — a **status board** (headline by urgency + stacked track sections when 2+ open). At most one active challenge per track; pin windows exclusive (one challenge pin active at a time). `/challenges` multi-track = **stacked pared legacy cards** (hero + image + Vote + More Info); single active keeps the full legacy pane.
- Submit: context carries intent, confirm always names the target, picker when ambiguous, server rejects ambiguous submits (phase 7). Media eligibility per track (`accepted_media`, phase 8).
- Minimal song creations: paste Suno link → completed playable creation (cover + embed). Music track rides on this later (phase 9).
- Music remix source (optional Suno URL on config + Listen on the card) is deferred with phase 9 — not required for theme-only Music challenges.

## Ship order at a glance

1. Song creations (Suno posts) — no deps; ship first
2. Foundations (debt + snapshot freshness)
3–6. Organizer console (prizes → publish → board + Announce tab; dated pin windows fire on the clock — phase 6 collapsed)
7–9. Multi-track participation (feed board + stacked /challenges cards + submit picker → accepted_media → Music wiring)
10. Cleanup + data contract doc

Within 3–6 and 7–9, per-phase "done when" = engineer checkpoint; team validates at the end of each numbered phase below.

## Progress (implementer: keep this current)

Note to the implementer: this is a big plan — progress MUST be visible in this doc. When you finish a phase, edit this checklist: mark `[x] built` with the date. Do NOT mark `validated` yourself — that box belongs to the user/team after they walk the phase's validation checklist (and the matching User flows). A phase is only done-done when both boxes are checked. If a phase ships partially, note what's missing next to it instead of checking the box.

- Phase 1 — Song creations (Suno posts): [x] built (2026-08-02) · [x] validated (2026-08-02)
- Phase 2 — Foundations (debt + snapshot freshness): [x] built (2026-08-02) · [x] validated (2026-08-02)
- Phase 3 — Prize structures + inheritance: [x] built (2026-08-02) · [x] validated (2026-08-02)
- Phase 4 — Results + publish + payouts: [x] built (2026-08-02; tip from admin account; Save order / Pay unpaid; unpaid amounts always from live Prizes; finalize stamps `results_published_at` only — no pin/announce) · [x] validated (2026-08-02)
- Phase 5 — Board actions + Announce tab + review modal: [x] built (2026-08-02: Results Stats|Payout; **Announce** tab with dated slots + upsert/clear on save via organize/pins) · [x] validated (2026-08-02)
- Phase 6 — Auto open-pins: [x] collapsed to a note (2026-08-02) — no build needed; Announce-tab dated windows already fire pins on the clock · [x] validated (2026-08-02, phases 3–6 organizer-console walkthrough)
- Phase 7 — Multi-track surfaces (feed board + /challenges stacked cards + submit picker + pin exclusivity): [x] built (2026-08-02; /challenges multi-track = stacked pared legacy cards, not summary/detail) · [x] validated (2026-08-03)
- Phase 8 — accepted_media + media filtering: [x] built (2026-08-04: track defaults + eligibility/POST filter; create inherits `accepted_media`; creation-detail CTA no longer hard-blocks audio/video) · [ ] validated
- Phase 9 — Music challenge wiring: [ ] built · [ ] validated
- Phase 10 — Cleanup + data contract doc: [ ] built · [ ] validated

---

## Phase 1 — Song creations (Suno posts)

→ User flow F1 (post a Suno song as a creation).

No dependencies on anything else in this plan. Ship first / parallel with phase 2 so users get playable Suno creations while organizer work continues.

Reuse: Suno resolve (`api_routes/suno.js`), embed hydration + `.connect-chat-suno-embed` CSS, video pattern (cover on row, rich object in meta).

- `POST /api/create/import-suno` `{ url }`: auth; strict URL validation (suno.com song URL patterns only — this endpoint fetches remote URLs, treat as SSRF surface); resolve song id/title/creator; scrape og:image (validate resolved host, cap download size) → `storage.uploadImage` cover; per-user rate limit; insert `prsn_created_images` row directly, `status: 'completed'`, no credits/job:

```js
meta: {
	media_type: 'audio',
	import: { provider: 'suno', song_id, url, embed_url, title, creator }
}
```

Provider-keyed `meta.import` (not `meta.suno`) — Suno won't be the last external source.

- Import UX: resolve + cover scrape + upload takes 3–8s. Paste-link modal shows an explicit importing state; scrape has ~10s abort timeout; missing/failed `og:image` → placeholder cover, never a failed import.
- Entry point on create surface: "Import a song" → paste-link modal → open creation detail on success. (Music challenge card entry waits for phase 9.)
- Creation detail: audio branch = cover + Suno iframe, click-to-play (don't mount iframe on page load); gate image-only actions (recreate, poster, Vynly, share-audio).
- Feed card (`src/shared/feedCardBuild.js` ~1225–1286): cover + music badge ONLY — never an iframe in feed, must not hit video branch.
- Publish/unpublish works like other creations (completed + unpublished → publish to feed).

Team validate: paste a Suno link → playable creation with cover in under ~10s; plays on creation detail (click-to-play); publishes to feed as cover + music badge, no iframe in feed; bad/non-suno URL rejected cleanly; image-only actions absent on song detail.

---

## Phase 2 — Foundations (existing debt + snapshot freshness)

→ User flow F2 (Draft → Public shows on feed promptly). Mostly infrastructure; F2 is the user-visible proof.

Correctness bombs found in audit; fix before building organizer/publish paths on them. Can run parallel with phase 1.

Debt:

- Server message cap reads the WRONG END: `MESSAGE_FETCH_LIMIT = 500` + ascending order (`api_routes/utils/challengeSubmitShared.js:30-31, 172-180`) feeds submit eligibility and snapshot rebuild. Past 500 thread messages, both reason about the oldest slice — live challenges vanish, dead ones resurface. Fix: fetch newest-first (or filter to challenge kinds server-side), keep chronological merge order after fetch.
- Stats route scans ALL chat messages site-wide: `globalAverage` query has no thread filter (`api_routes/chat.js:2487-2513`), uncached, recomputed per call. Scope to the challenges thread + cache. Must land before the review modal (phase 5) depends on this route.
- Engagement endpoint bypasses its own cache: `GET /api/feed/challenge-engagement` defaults `fresh !== false` → force-rebuilds snapshot on every feed view (`api_routes/feed/challengeEngagementItem.js:26-34`). Flip default to trust cache; write-triggered invalidation (below) becomes the freshness mechanism. Also: client thumb hydrate re-downloads the entire thread per feed view (`public/.../challengeHistoryThumb.js:215-244`) — reuse the cached channel model instead.

Snapshot invalidation (organizer saves must show immediately; the 20-min TTL was fiction because of the always-fresh default above):

- `api_routes/chat.js` message POST/PATCH: when written `kind` is `challenge_config` (only in the `#challenges` thread; parse body defensively), invalidate `api_routes/feed/challengeFeedSnapshotCache.js` (Redis `feed-beta:challenge-snapshot:v3` + mem).
- Also invalidate from organize pins route (`chat.js` ~2370) and the publish-results route (phase 4).
- Single-flight the rebuild: in-process lock + Redis SETNX so concurrent feed requests after an invalidation don't all rebuild at once. While one rebuild runs, serve stale snapshot if present rather than blocking.
- Verify inactive card copy in `api_routes/feed/engagementAndNewbie.js` (~221–304) after rebuild.

Unpublished editorial pin targets (addendum — settles pin model before phase 6):

- Organizer promo / winners creations used as `created_image_id` on challenge editorial pins must **not** need to be published. Publishing those is the wrong model (and conflicts with challenge-entry publish rules elsewhere).
- Saving challenge_config with hero / results / topic_vote creation URLs stamps `meta.challenge_organizer_refs` on those creations (same trophy annotation + publish/delete/submit locks as entries). Soft-delete clears the stamps.
- Creation detail / library use the same trophy annotation as challenge entries (`meta.challenge_feed_pins` stamped on pin upsert; publish + delete locked while active).
- Feed pin inject + media/detail reads: if a creation id is an active editorial pin (`feed.editorial_pins` policy), non-owners may load its feed card media the same way published feed items do. Inactive / expired pins do not grant access.
- Pins route and Announce / auto-open (phase 6) keep pointing at unpublished creations; do not add a publish step to the pin flow.
- Challenge *entries* stay unpublished for blind judging — unchanged. This addendum is only for organizer pin/promo creations.

Team validate: Draft → Public shows on the feed card on next load; organizer stats modal opens fast; feed card correct with a >500-message thread (seed a test thread); feed latency unchanged after invalidation storm (rapid saves); pin an unpublished promo creation → it appears on the feed with working media for a non-owner; removing/expiring the pin revokes that access.

---

## Phase 3 — Prize structures + track inheritance

→ User flow F3 (create / edit challenge prizes).

Extend `challenge_config` with a structured numeric block — the single source of truth for display, payouts, inheritance, and the review modal. Free-text placement/participation fields are deprecated; card copy is generated from the numbers.

```js
prizes: {
	main: { first, second, third },                      // credit amounts
	top_submitters: { enabled: true, amounts: [n,n,n] }, // by entry count, details at results
	top_voters:     { enabled: true, amounts: [n,n,n] }  // by votes cast, details at results
}
```

- Cutover done (2026-08-02): `db/maintenance/migrate-challenge-prizes.js exec` converted all existing `challenge_config` messages (20 rows) — `prizes.main` parsed from legacy digits, participation off for historical challenges, `reward_participation`/`reward` text folded into `reward_custom`, legacy keys deleted. Backup jsonl in `db/maintenance/backups/`. No legacy read fallback remains in code; a config without a `prizes` block renders no reward cards.
- On create (`src/chat/challenges/mountOrganizerSidebar.js`): prefill `prizes` (+ `reward_custom`) and `accepted_media` from the most recent non-deleted same-track config by **submission start date** (`submission_start_at`); fall back to presets in `model/tracks.js`.
- Track presets: default `prizes` (main + participation categories enabled with starter amounts — customizable in the form). Participation defaults: `[50, 30, 20]` credits each category (tune in `tracks.js`).
- Edit modal (`views/adminView.js`): prizes tab = numeric main amounts, enable/amounts for top submitters and top voters, and the Custom text field.
- Participant cards render medal rows procedurally ("400 credits") from `prizes.main` (>0 only); a Participation card ("Prizes for top 3 voters and top 3 submitters" — spot counts from funded tiers, no amounts) when a category is enabled; Custom card from `reward_custom`. Configs without a `prizes` block render no reward cards. Feed topPrize/totalRewardCredits derive from `prizes.main` only (participation amounts stay hidden until results).
- Remix source: out of scope this phase (phase 9 / later).

Done when: new Weekly pre-fills last Weekly's `prizes` (by start date); first-of-track gets preset defaults; participation prizes editable but amounts hidden until results; card copy generated from numbers.

---

## Phase 4 — Canonical results + publish endpoint with payouts

→ User flow F5 (review + confirm winners / payouts) — server half. UI is phase 5.

Stats route already computes rankings: `GET .../challenges/:challengeId/stats` (`api_routes/chat.js` ~2465–2666: topCreations, topSubmitters, topVoters).

- Unify tie-breaks by deleting both implementations and writing ONE: new `src/chat/challenges/model/ranking.js` (canonical order: weighted score desc → vote count desc → earlier created_at → message id; plus top-submitters/top-voters counting). Client `participantSlice.js` (~148–180) and the stats route (~2576) both import it — the server already imports this model (`phases.js`, `challengeAdmin.js`); follow that pattern. Money rides on rankings; two implementations WILL drift (they already did).
- New route: `POST /api/chat/challenges/organize/:threadId/:challengeId/publish-results`, organizer-gated like pins route. Lives in a new `api_routes/challenges.js`, not appended to `chat.js` (3.6k lines). Body: final winner order (message ids), participation lists (defaulted from stats, overridable), final prize amounts.
- Server: validate winners belong to challenge; refuse if `results_published_at` already set (this guard is the payout idempotency); clamp every payout amount to the challenge's configured `prizes` (plus a hard per-payout ceiling) — NEVER trust client amounts, this route mints credits; authorize against that track's organizers + oceanman; record confirming user id in `results`. Then PATCH config with `results_published_at` plus:

```js
results: {
	version: 1,
	winners:        [{ place, message_id, created_image_id, user_id, score }],
	top_submitters: [{ user_id, count, prize }],
	top_voters:     [{ user_id, count, prize }],
	payouts:        [{ user_id, amount, reason, source, paid_at }]
}
```

- Payouts (DECIDED 2026-08-02, differs from the original draft below): source is the **tip system**, not system_mint — funded by the **platform admin account** (resolved by `role: 'admin'` at publish time), not the confirming organizer. `executeChallengePayouts` (`api_routes/utils/challengePayouts.js`) takes a source arg — `{ type: 'tip', fromUserId: adminUserId }` transfers via `queries.transferCredits`, logs `insertTipActivity`, notifies the recipient. Route pre-checks the admin balance vs total. A future system_mint / sponsor-wallet source slots into the same executor.
- Payout ordering (no ledger exists — get this exact):
  1. One PATCH publishes results with every payout row `{ user_id, amount, reason, source, paid_at: null }` (pending).
  2. Then execute grants; flip each row's `paid_at` as it succeeds.
  3. A crash mid-loop leaves pending rows visible; results card offers "Retry unpaid" which grants only rows with `paid_at: null`. Never pay before publishing (retry would double-pay); never treat publish guard as payment proof.
- Side effects (winners pin targeting `results_creation_url` else 1st-place creation, snapshot invalidation) run via the lifecycle module (see Extensibility guardrails), not inline in the route. Do not post `challenge_announce` into #challenges.

Done when: one confirmed request saves the payout draft, pays every unpaid recipient exactly once via admin tips (with retry for partial failure), and Finalize moves Pending → Complete. (Winners pin / announce deferred — phase 5/6 later.)

Built 2026-08-02: `model/ranking.js` (canonical weighted/average ranking + exclusions), `api_routes/challenges.js` (`publish-results` save_only + pay, `retry-unpaid`, `finalize-results` status-only), `challengePayouts.js` (tip executor, configured prize amounts, congratulatory tip/notification copy, merge unpaid drafts preserving paid), `challengeLifecycle.js` (`onResultsPublished` kept for later pin/announce). Tests: `test/challengeRanking.test.js`, `test/challengePayouts.test.js`.
Validated 2026-08-02: organizer walked payout on a live Pending challenge (order + prizes sync + Pay unpaid + Finalize → Complete); past challenges keep Results → Payout for review.

---

## Phase 5 — Board lifecycle actions + Announce tab + review modal

→ User flows F4 (Announce tab / close voting) and F5 (review + confirm winners).

Click wiring for `[data-organize-action]` exists (`mountOrganizerSidebar.js` ~1342); handlers ~1695–1803.

- Review UI shipped 2026-08-02 as **Results** on the card → modal tabs **Stats | Payout** (`views/reviewResultsView.js` + `organizeResults.js`): appears for `finalizing`/`results` (oceanman/admin); ranked sections; recipients editable until paid; Save when dirty; Pay N unpaid; Finalize → Complete (status only). Paid-row chrome. Calendar pin-window dots still in organize calendar.
- **Announce tab shipped 2026-08-02:** Announce / hero, Results / highlights, and Next challenge — theme vote live on **Announce** (not Details). Each has creation URL + pin starts/ends (defaults from schedule). Save persists `pin_*_ymd` on config and upserts/clears editorial pins (`open` / `winners` / `topic_vote`) via `POST /api/chat/challenges/organize/pins` (`starts_at`/`until`/`clear` + lifecycle helpers). Clear URL removes that pin. No separate card Announce button required for pins.
- Still pending / deferred: Close-voting card button (if kept), optimistic in-place card re-render. Channel `challenge_announce` retired — #challenges is machine-readable only; pins come from the Announce tab.
- Card actions update the local model optimistically and re-render in place — do NOT refetch the whole `#challenges` thread + remount per click. Soft reconcile catches drift.
- Results cards show paid/pending summary from `results.payouts` + "Retry unpaid" when any pending.

Done when: Results/Payout from cards works; Announce tab saves drive feed pins from dated slots; Close voting (if kept) from cards; no JSON edits for payouts/pins.

Built 2026-08-02: Announce tab UI (`adminView.js`), `model/pinSlots.js`, save sync in `mountOrganizerSidebar.js`, pins route accepts dates/clear/`topic_vote` via `challengeLifecycle.js`. Tests: `test/challengePinSlots.test.js`.

---

## Phase 6 — Auto open-pins: collapsed to a note (2026-08-02)

→ User flow F6 (challenge goes live; feed pin appears without organizer clicks).

No build needed. This phase was written for the old design (card Announce clicks at the boundary). Phase 5's Announce tab already covers F6: save upserts pins immediately with full `starts_at`/`until` windows, and `isEditorialPinActive` (`api_routes/feed/editorialPinPolicy.js`) gates injection on the clock — a future-dated open pin activates itself when its window opens, zero clicks. Winners pin also fires from `onResultsPublished`. A snapshot-build reconciler would only cover a pin missing despite a filled slot (failed upsert / hand-edited policy) — not worth building.

Team validate after phases 3–6 (organizer console): create (prizes + Announce tab with dates) → goes live → open pin appears (save and/or auto) → (optional Close voting) → Results → Payout → Finalize → Complete → winners pin if results slot set → past Results still reviewable.

---

## Phase 7 — Multi-track surfaces (feed board + /challenges + submit picker + pin exclusivity)

→ User flows F6 (feed half), F7 (browse + vote concurrent), F8 (submit picker).

Assumption: at most one **active** challenge per track (+ optional upcoming per track). When **2+ challenges are actively open**: feed status board → `/challenges` stacked pared cards (Monthly first). **When only one challenge is active**, keep the legacy feed card (`challenge_stats` / inactive) and the legacy full `/challenges` pane (hero + vote + details + submissions).

### A. Feed card — status board with newsworthy headline

Replace single-focus card with one `challenge_board` engagement card. Headline scored by urgency (ends-soon+can-act → just-opened → unvoted → not-entered → soonest deadline); ties by earlier deadline then Monthly > Weekly > Music. Layout: stacked single-track sections (Monthly first), status chip per track, no per-row CTAs → single CTA "Open challenges". Covers between-rounds too (retires `challenge_stats_inactive`). Snapshot emits all-track active + next-upcoming with per-challenge viewer overlay.

### B. /challenges — stacked pared cards (multi-track)

When 2+ active: one card per track sorted Monthly → Weekly → Music — hero (title/phase/countdown/stats) + hero image + Vote + More Info (no details/rewards blurbs on the card). More Info → `/challenges/details/:challengeId` (breadcrumb Challenges › title). No submissions list; no summary→detail flip. Organize CTA once at top. `?challenge_id=` scrolls/focuses that card (legacy; details use path). Next/Past exclude **all** active ids. Vote modal + submit context keyed by that card's `challenge_id`. Single active: unchanged full legacy pane.

### C. Submit targeting — user picks when multiple accept

Safety half of old phase 8. Eligibility returns full accepting list; POST requires explicit `challenge_id` when >1 accepting (sole-option shortcut stays; delete newest-created fallback). Confirm modal always names target; radio picker when multiple eligible and no context; stale context falls back to picker. Picker module beside `challengeSubmitContext.js`.

### D. One active pin at a time

`upsertChallengeEditorialPin` rejects windows that overlap any other `challenge-*` pin (same pin id excluded); error names the conflict. Announce tab surfaces the error; no auto-shift.

Done when: two open tracks visible on feed board and stacked `/challenges` cards; voting/submit per challenge correct; ambiguous submit requires a pick; overlapping pin windows refused.

Results-from-`config.results` (old F10) deferred — hand-built highlights + pins keep working.

---

## Phase 8 — accepted_media + media filtering

→ User flow F8 media half (songs → Music only). Submit picker already in phase 7.

- `accepted_media` on config: `['image','video']` monthly/weekly, `['audio']` suno; defaulted by track template; on create, inherit from most recent same-track config by submission start date (same rule as `prizes` in phase 3), else template default.
- Server eligibility filters accepting list by creation `meta.media_type` vs `accepted_media`. Validate media eligibility on submit POST.

Done when: song submits only offered to Music; image/video only to monthly/weekly.

---

## Phase 9 — Music challenge wiring (on top of song creations)

→ User flow F9 (enter a Music challenge with a Suno song). Builds on F1 + F8. Remix source listening is part of F9 when configured.

Depends on phases 1, 3, and 8 (`accepted_media`). Songs already exist from phase 1; this makes them first-class Music challenge entries. Submit picker already ships in phase 7.

- `accepted_media: ['audio']` on suno track template (and inheritance from phase 8).
- Optional remix source on config (ship here if still wanted — deferred from phase 3), e.g.:

```js
remix_source: null | { provider: 'suno', url, song_id, title?, creator? }
```

  Set when the challenge is "remix this track"; omit/null for theme-only Music challenges (same shape as today's image theme challenges — brief + prizes, no listen target). Can slip to a later addendum if Music theme-only is enough for first ship.
- Participant Music card: when `remix_source` is set, show a Listen / play control for that source track (click-to-play Suno embed, same rules as song creations — no eager iframe). Theme-only Music cards skip this control.
- Organize edit: paste Suno URL → resolve (reuse `/api/suno/resolve`) → store `remix_source`. Clearable.
- Vote modal `injectVoteMediaFromCreation`: full-sized Suno embed (not cover-only); at most one iframe mounted at a time, unmount on advance to next entry (shipped early with phase 7).
- Entry point: "Import a song" on Music challenge card → paste-link modal → on success, open standard submit confirm with context targeting that challenge.
- Update Music-track how-to copy in `detailsRewardView.js` (says image/video); mention remix source when present vs theme-only.

Done when: paste Suno link → playable creation → submit to Music challenge → votable in modal; theme-only Music works; remix Listen only if `remix_source` shipped.

Team validate after phases 7–9: two concurrent open challenges (one Music); feed status board shows both; `/challenges` shows stacked cards for both (monthly first) with Vote/Submit; voting on each targets the right challenge; `?challenge_id=` focuses that card; submit from a card targets that challenge by name; submit from creation detail with both open shows the picker; song submits only offered to Music; stale submit context recovers to picker; overlapping pin windows refused on Announce save.

---

## Phase 10 — Cleanup + docs

- Write `_docs/CHALLENGES_data_contract.md` (see Extensibility guardrails) once schemas have settled.
- Decision: the participant setup-timeline strip is NOT revived — delete it.
- Delete dead stubs: `setupView.js`, `submitView.js`, `resultsView.js`, `organizeCache.js` shim, `mountChallengesOrganizerSidebar` stub + host in `chat.html`.
- Retire standalone organize: `pages/challenges-organize.html`, `public/pages/challenges-organize-main.js`, `entry/entry-challenges-organize.js`, rollup entry (`src/rollup.config.mjs` ~235–244).
- Remove orphaned `.challenge-pane-setup*` styles from `public/global.css`.

Team validate: /challenges and /challenges/organize regress-free after dead-code removal; data contract matches shipped schemas.

---

## Code placement (modularization that pays rent)

The repo already has the right pattern: `src/chat/challenges/model/` is an isomorphic domain model imported by BOTH client and server (`phases.js`, `participantSlice.js`, `challengeAdmin.js`, `constants.js` are imported by `challengeSubmitShared.js`, `challengeFeedSnapshotShared.js`, `chat.js`). v2 extends this pattern; it does not invent a new one.

Rule: a module earns its existence when v2 gives it a second consumer. Applied:

- `src/chat/challenges/model/ranking.js` — consumers: client lane, stats route, publish validation. (The one existing violation of the pattern — rankings inlined in `chat.js` — is exactly where client/server drift came from.)
- `api_routes/utils/challengeLifecycle.js` — consumers: publish route, snapshot build. Pin upsert helper lives inside it.
- `api_routes/utils/challengePayouts.js` (executor) — consumers: publish route, "Retry unpaid".
- `api_routes/challenges.js` — new challenge routes; existing organize pins + stats routes migrate here when touched.

Do NOT grow the god files: `chatPage.js` (16k), `create.js` (6.2k), `creation-detail.js` (6.9k), `chat.js` (3.6k), `mountOrganizerSidebar.js` (1.8k). New behavior = new module + thin call site.

Explicit non-goals (one consumer, no confirmed second — skip):

- No media renderer registry — three media types is a branch, not a plugin system.
- No event bus / pub-sub — the lifecycle module is three named functions called directly.
- No repository abstraction over chat messages; the existing fetch helpers are the layer.
- No track class hierarchy; the registry object in `model/tracks.js` is enough.
- Views stay template-string functions per existing convention.

## Extensibility guardrails (v2 discipline, not features)

Confirmed direction: sponsored/partner challenges plausible; cross-challenge progression maybe; per-community challenge scopes plausible. Hedges below are structure and contracts only — no speculative features.

- Lifecycle module: one server module (`api_routes/utils/challengeLifecycle.js`) owns `onChallengeOpened`, `onVotingClosed`, `onResultsPublished`. All side effects (pins, announces, invalidation, payouts) route through it. Future notifications/analytics/automations attach here, nowhere else.
- Thread scoping: every new server helper and route takes `threadId` as a parameter; the canonical `#challenges` thread is a default resolved at the edges only. No new code calls `findChallengesChannelThreadId` internally.
- Payout source: the payout executor takes a source arg (`tip` today — admin account balance via transferCredits); system_mint / sponsor-wallet funding slots in later without touching the publish flow. `results.payouts[].source` records it.
- Track discipline: all track behavior reads the registry in `model/tracks.js`; no track-literal branches elsewhere. New tracks stay a one-file change until tracks become data.
- Data contract doc: write `_docs/CHALLENGES_data_contract.md` freezing event kinds and schemas (`challenge_config` fields incl. `prizes`/`accepted_media`/`remix_source`, `challenge_submission`, `challenge_announce`, `results` v1, payout rows). This is the source of truth for any future projection table (leaderboards, seasons, profile wins) — and for the implementer.

## Known non-issues (don't fix ghosts)

- Client-side config merge sees all pages (client paginates until exhausted); the oldest-slice bug is server-only (phase 2).
- `applyChallengeViewerOverlay` is cheap in-memory; the cost was the always-rebuild path (phase 2).
- Feed engagement fetch already defers past first feed paint.
- Participant submission lists are text-only; no image weight there.

## Deferred debt (monitor, not v2)

- Client full-thread fetch on every `/challenges` visit (fat bodies + reactions per message) — degrades linearly with thread growth. Proper fix is a kind-filtered/delta messages API; revisit after v2 or when thread size makes it bite.
- localStorage caches the whole messages array, silently gives up on quota (`challengesChannelCache.js:96-108`); soft refresh re-downloads everything. Same follow-up.

## Cross-cutting traps

- Thread growth: everything scans the `#challenges` thread, which only grows. Phase 2 fixes the correctness cliff (server oldest-500) and the stats scan; the linear-growth bandwidth cost is Deferred debt above.
- Any server-side PATCH to a config message invalidates organizer edit-modal baselines (client conflict fingerprints). Publish-results is acceptable (the actor is the organizer confirming); nothing else should write configs server-side.

## Tests (minimum bar, money paths)

`test/` convention exists (see `challengeResultsHighlights.test.js`). Required:

- `ranking.js`: tie-break order (score → vote count → created_at → message id), top-submitters/top-voters counting, own-entry exclusion.
- Publish-results: idempotency (second call refused), payout clamp vs config, payout ordering (pending → paid, retry pays only unpaid).
- Submit eligibility: media-type filtering, explicit-id requirement when multiple accepting, sole-option shortcut.
- Snapshot invalidation fires on challenge_config writes.

## Rollout & remediation

- Live challenges must survive every phase mid-flight: legacy `reward_*` fallback covers configs; publish-results only touches `finalizing` challenges.
- Payout misfire remediation: `db/maintenance/add_credits.js` with a negative delta (balance clamps at 0). Note it in the results card runbook comment; don't build UI for it.
- Vote integrity (alt accounts) is a known accepted limitation — do not build defenses in v2.
- Mobile: new modals (review, picker, import) and lane pills follow existing 768px patterns; swap controls are buttons (tap-friendly), not drag.

## Success signals (post-ship, derivable from existing data)

- Organizers publish results with zero hand-edited JSON (every results block written by the publish route).
- Submit conversion once picker exists; votes per challenge across concurrent tracks; feed card → /challenges click-through if cheap to observe.
- Song creation publish rate after phase 1 ships.
- No new analytics infrastructure for v2.

## User flows

High points only. Phases implement these; team validation walks them. `→ User flow Fn` in each phase points here.

F1 — Post a Suno song as a creation (phase 1)

1. User opens Create (`/create`).
2. Chooses Import a song (alongside generate).
3. Paste-link modal: pastes a suno.com song URL, confirms.
4. Importing state while server resolves song, stores cover, creates completed audio creation (a few seconds). Bad/non-Suno URL fails cleanly.
5. Lands on creation detail: cover + click-to-play Suno embed. Image-only actions hidden.
6. Edits title/description if wanted, then Publish (same as other creations).
7. Song appears in feed as cover + music badge — no iframe in feed.

F2 — Draft → Public shows on feed promptly (phase 2)

1. Organizer opens Organize, edits a challenge, switches Draft → Public (or changes schedule), saves.
2. Reloads feed (or next feed load): engagement card / Next teaser reflects the change without waiting out a long TTL.
3. Opening Organize stats stays snappy even on a large thread.
4. Organizer promo / winners creation used for an editorial pin stays unpublished; after pin upsert it appears on the feed with working media for other signed-in users. Expiring or removing the pin revokes that access.

F3 — Create / edit challenge with prizes (phase 3)

1. Organizer creates a challenge of a track (e.g. Weekly).
2. Prizes tab is pre-filled from the most recent same-track challenge by submission start date (or track presets if first) — numeric `prizes` plus Custom text when inheriting.
3. Adjusts numeric main amounts, top-submitter / top-voter enable + amounts (defaults on, editable), and optional Custom text.
4. Saves. Participants see generated main prize cards ("400 credits"); when participation is enabled, a Participation card says "revealed at results" (no amounts until results).

F4 — Announce tab + optional close voting (phase 5)

1. Organizer opens Manage → **Announce** tab: sets Announce/hero, Results/highlights, and/or theme-vote creation + date windows; Save upserts pins.
2. Open pin on feed from that slot; no card Announce. Close voting (if still a card action) updates board in place.
3. While voting is open, organizer can Close voting (confirm) → phase moves to finalizing without hand-editing dates.

F5 — Review and confirm winners + payouts (phases 4–5)

1. Challenge is finalizing (Pending). Organizer opens Results → Payout.
2. Ledger shows Places / Top submitters / Top voters with amounts from live Prizes; change recipients as needed (Custom + undo).
3. Save order only appears when something changed; Pay N unpaid tips from the admin account (saves first if dirty), each with a congratulatory tip note + notification.
4. When all paid, Finalize moves Pending → Complete (status only — no pin/announce yet).
5. Past Complete challenges still open Results → Payout read-only for review.

F6 — Challenge goes live; pin appears without clicks (phase 5 Announce windows + feed)

1. Organizer already set open/hero creation + window on the Announce tab (or defaults apply).
2. Scheduled listed challenge crosses into an open phase on the clock.
3. Pin activates when its `starts_at` window opens (policy clock). No card Announce.
4. Feed status board shows all open (+ upcoming) challenges; headline reflects the most urgent moment; single CTA → `/challenges`.

F7 — Browse and vote on concurrent tracks (phase 7)

1. User opens `/challenges`. Sees stacked cards per open challenge (Monthly first: hero + image + Vote + More Info).
2. Opens Vote on challenge A → modal is for A's entries only; scores apply to A.
3. Opens Vote on challenge B → same, keyed to B. No silent cross-wiring.
4. More Info → `/challenges/details/:challengeId` (breadcrumb Challenges › title). `?challenge_id=` scrolls/focuses that card on the stack.
5. From the feed status board, "Open challenges" goes to the lane; Vote from feed still works for the headline challenge and does not re-download the whole channel after each score.

F8 — Submit a creation to a named challenge (phase 7 picker; media filter phase 8)

1. User has a completed unpublished creation eligible for at least one open challenge.
2. From a challenge card: Submit carries that challenge_id; confirm modal names that challenge.
3. From creation detail with no context: if one eligible challenge, confirm names it; if several, radio picker in the same confirm; if none, no submit.
4. Confirm always shows the target name before POST. Server rejects ambiguous/missing id when multiple are open.
5. Stale context (closed challenge): confirm falls back to fresh eligibility / picker — never a dead-end error.
6. (Phase 8) Media type filters the eligible list (songs → Music only).

F9 — Enter a Music challenge with a Suno song (phase 9; uses F1 + F8)

1. Music challenge is open. User on that card sees brief + prizes.
2. If remix source is set: Listen / play on the source Suno track (click-to-play embed) before or while deciding to enter. If theme-only: no Listen control — same as an image theme challenge.
3. Chooses Import a song on the card (or imports via Create first — F1).
4. Paste Suno URL → song creation created (F1 steps 3–5).
5. Submit confirm opens with Music challenge already targeted (F8).
6. Entry appears in that challenge; voters audition entries via full-sized Suno embed in the vote modal (one iframe at a time; torn down on advance).

F10 — View past results in-app (deferred; highlights + pins for now)

1. Finished challenges still use hand-built highlights / results pin when set. In-app winners from `config.results` deferred past phase 7.

## Out of scope

- Notifications (challenge opened / you won).
- Native audio hosting/upload (Suno embed only).
- Auto-publishing results without human confirm.
- Server If-Match on config messages; field-level merge.
- Auto-list N days before start (optional-later idea; still not built).
- Credit ledger (payout audit lives in `results.payouts`; ledger is the follow-up if payouts grow).
