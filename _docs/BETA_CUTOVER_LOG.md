# Beta cutover log

Dated observations and decisions. Current requirements live in [migration guidance](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md); implementation plans are linked below.

## 2026-09-30

- My Creations is improving. Creation Detail and overlays are the next useful slice: they establish how views open over the app.
- The VPS should replace Vercel once the main flows work. Beta provides room to encounter failures before production cutover.
- Open concerns: mobile, crash recovery, logging, deployment reliability, and clear shared modules that support both web and desktop.

## 2026-10-01

- My Creations and core Creation Detail media flows are working; full lifecycle and action parity still need review.
- Chat is the next slice: channels, DMs, Notes, servers, and shared conversation behavior.
- Initial sequence considered: chat → composers → creation → remaining views.
- Longer-term direction: center Parascene on developing characters and worlds. Social features should support that creative work.
- Future ideas: reusable character/world resources, user-controlled organization and compaction, and less prominent server UI while retaining the underlying architecture.

### Creation Detail API observations (2026-10-01)

- Base creation and media loads succeeded; dependent profile, notification, like, activity, NSFW, related and lineage requests returned 404s.
- Those API routes were ported to VPS that day. Successful initial loads did not establish complete action or lifecycle parity.

## 2026-10-02

- Threads is the broader foundation for conversations and sidebar activity.
- Core channel/DM flows, message hydration, shared media, lightbox and canvas/right-sidebar behavior are in place.
- Known remaining conversation work: private channel creation/invitations and canvas notification parity.
- Profiles remain to be brought over. Right sidebars could show profiles, notes and creation details while retaining the current view; mobile would use overlays.
- Related images in compact creation detail remain undecided.
- A focused mobile pass is deferred until the main desktop flows are working.

## 2026-10-03

- **Decision: bring Create over before composers.** Both need the same creation services; Create establishes submission, provider configuration, credits, settings and completion handling first. The creation composer’s Advanced action also needs a working Create destination.
- Port the full Create workflow faithfully, excluding reusable composers. Add a basic Create entry point on Feed.
- Then port composers using the completed Create services. Conversation composer work is largely independent.
- Plans: [Create](BETA_VPS_CREATE_PLAN.md) → [composers](BETA_VPS_COMPOSERS_PLAN.md).
