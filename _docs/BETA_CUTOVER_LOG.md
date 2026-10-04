# Beta cutover log

Dated observations and decisions. The current outstanding scope is tracked in the [VPS migration tracker](BETA_VPS_MIGRATION_TRACKER.md); requirements live in [migration guidance](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md).

## 2026-09-30

- At the time, My Creations was improving and Creation Detail/overlays were selected as the next useful implementation slice.
- The VPS should replace Vercel once the main flows work. Beta provides room to encounter failures before production cutover.
- Open concerns: mobile, crash recovery, logging, deployment reliability, and clear shared modules that support both web and desktop.

## 2026-10-01

- At the time, My Creations and core Creation Detail media flows were working; chat was selected as the next implementation slice.
- The initial sequence considered was chat → composers → Create workflow → remaining views. Create and reusable composer migration are now complete (see 2026-10-04).
- Longer-term direction: center Parascene on developing characters and worlds. Social features should support that creative work.
- Future ideas: reusable character/world resources, user-controlled organization and compaction, and less prominent server UI while retaining the underlying architecture.

### Creation Detail API observations (2026-10-01)

- Base creation and media loads succeeded; dependent profile, notification, like, activity, NSFW, related and lineage requests returned 404s.
- Those API routes were ported to VPS that day. Successful initial loads did not establish complete action or lifecycle parity.

## 2026-10-02

- Threads is the broader foundation for conversations and sidebar activity.
- Core channel/DM flows, message hydration, shared media, lightbox and canvas/right-sidebar behavior are in place.
- Known remaining conversation work: private channel creation/invitations and canvas notification parity.
- At that point, profile surfaces and right-sidebar profile/note/detail content were still planned; see the current tracker for what remains.
- A focused mobile pass is deferred until the main desktop flows are working.

## 2026-10-03

- The implementation sequence was to complete Create services before reusable composers, then port both workflows into VPS. This sequence is complete; the active tracker records the completion and remaining site scope.

## 2026-10-04

- Create workflow and reusable composers are complete. Their old port plans are retained as completed implementation references, not active migration tasks.
- The [VPS migration tracker](BETA_VPS_MIGRATION_TRACKER.md) is the single current list for remaining product surfaces, public pages, crawler support, APIs, background services, administration, and cutover work.
