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

### Comments, Explore, My Files, Library and User Menu (2026-10-04)

The requested five surfaces are implemented in VPS-owned client and server modules.
At this point, Feed remained the existing beta progress placeholder; its port is
recorded in the 2026-10-05 entry below.

- Comments: recent stream, rich text/replies/reactions, creation/profile links,
  composite cursor pagination, refresh, NSFW visibility and authorized mutations.
- Explore: community browse, incremental keyword/semantic search, pagination,
  square grid and large cards, seed handoff and native creator navigation.
- My Files: My Creations grid presentation, image/audio/video previews, multiple
  uploads and drag/drop, copy/share links, owner deletion and paging offsets.
- Library: styles, personas/default selection and audio clips; native style/audio
  detail overlays, founder/admin style actions, audio recording, artwork and edits.
- User Menu: owned Profile, Connections, Settings, Help, About and Logout;
  profile edits/creation tabs, follows/presence, credential/application management,
  Google Photos OAuth routes and the existing local development Reports link.

Validation: VPS build and client import boundary pass. The server graph imports
successfully and all 150 relative-import modules stay inside `vps/`. Ten mounted-view tests
cover loading, navigation, paging, edits/uploads and teardown; eight API tests
cover access/visibility, cursors, privacy, Library and Help. Full suite: 122 pass,
6 fail, 18 skip. The same six failures occur on the starting revision: sidebar
server mock dependencies, startup lifecycle fixture, two conversation fixtures,
Messages CSS parity and a removed resource-module import. Mounted tests require
`node --experimental-vm-modules --test test/migration-surfaces.test.js`.

Live review before cutover:

1. Compare desktop and mobile presentation with WWW; walk Comments → creation →
   creator and Explore search/grid/large modes. Test Back/Forward, refresh,
   scroll retention, close/reopen during loading and session expiry.
2. Upload multiple files, preview image/video/audio, copy a link, delete and page
   older files; verify range playback, size limits and separate-user isolation.
3. Review Library tabs, default persona, style creation/editing and thumbnails,
   audio recording permission/cancel/save, clip edits and playback on real devices.
4. Review Profile edits including avatar generation; test Settings persistence,
   credential rotation/revocation, application grants and actual Google Photos
   redirects. These external provider/OAuth paths have not been exercised live.
5. Verify deployment secrets, proxy/storage body limits and server module graph
   inside the Docker image before enabling production traffic.

No deployment or production cutover was performed for this port.

### Browse presentation follow-up (2026-10-04)

User review requested shared native presentation rather than separate Files and
Library layouts. Files now use exact My Creations grid sizing and move all
metadata/actions into the actual chat lightbox. The lightbox supports a title
over the backdrop, explainer text below the item and custom actions. Unknown
files retain the generic graphic and a solid backing card; audio/video badges
come from the shared creation grid helper.

Library removes its redundant header and tables, retains its tabs, uses shared
grids/lightboxes and appends later rows on scroll. Its conditional Add style and
Record clip actions are visible outlet-header buttons. Explore search occupies
the normal bottom composer slot. Files, Library and Explore use grid skeletons
without loading text; Comments uses the existing thread skeleton.

Validation: VPS build/import boundary and 15 mounted-view tests pass, including
layout placement, tab header actions, pagination, modal editing/recording,
unknown-file presentation, shared lightbox actions and ownership cleanup.
The full suite retains the same six baseline failures; desktop/mobile visual
review is still required.

### 2026-10-04 — Library modal and Explore badge follow-up

- Styles show full details directly in a standard dialog with Copy style key;
  removed See All Styles. Add style and Record clip use standard modal chrome.
- Audio clip cards and direct links open a single details modal over Library,
  with playback on load and media/request cleanup on close.
- Library audio pages request oldest-first ordering, applied before pagination.
- Explore hides publication globes in both card modes and during shared card
  publication updates.
- Validation: 17 mounted surface tests pass, 9 migration API tests passed for
  the server ordering changes, VPS build passes, and diff whitespace check passes.
  Browser visual/cutover review remains pending.

## Profile overlay visual parity — 2026-10-04

The active WWW SPA resolves profile routes through `src/shared/spaPageOverlay.js` into the profile embed. Its actual child markup/behavior is `public/pages/user-profile.js`, with `public/pages/user-profile.css` and the embed/main, shared grid, form, modal, and skeleton rules in `public/global.css`. These embedded dependencies are the reference here; guest/standalone page shells are excluded.

The native VPS UserProfile view now owns the embed's 16px mobile / 24px desktop gutters, 1400px content cap, 1em gap below shell-owned 58px overlay chrome, inherited typography, five/four/two-column profile grid, shared profile skeleton layout, edit dialog/form presentation, and WWW profile action button treatment. Persona action selectors now match the native root rather than requiring a second nested `.user-profile-page`. All selectors are scoped to this feature; history, overlay lifecycle and scroll ownership remain with VPS router/layout. No external runtime imports or build aliases were introduced.

Validation: all 18 migration surface tests pass, including a mounted persona regression for hero structure, action layout, initially hidden edit UI, open/cancel and native creation navigation. Browser screenshot parity has not been verified: no browser automation capability is available in this session. Font metrics, viewport breakpoints, native squircle support, dark theme and scrolling/edit-dialog focus still need live visual review before claiming pixel-perfect parity.

### Feed and Doom Scroll (2026-10-05)

- Replaced the beta progress overview with the active WWW SPA feed. Ported desktop cards, mobile alternating spotlight strips, deferred challenge engagement, card actions, ranking, cursor/acknowledgement pagination, editorial pins, blog/tip composition and impression tracking into VPS-owned modules.
- Ported Doom Scroll together with Feed because they share the selection timeline and card/media helpers. Native and grouped videos retain playback, mute, progress, follow, likes and sharing; YouTube Shorts retain their embed controls. Comments use the existing native creation-comments thread in a dialog. Router-owned dialog history lets Back close comments before dismissing the timeline.
- Feed owns a mounted controller and uses the VPS request adapter. Challenge voting acquires shared Threads history and writes through its durable vote queue. Doom slide URL replacements retain its mounted timeline; layout retains the underlying feed DOM and scroll position. Media pauses under overlays and teardown aborts requests, releases media, and removes observers/listeners.
- Validation: VPS build and client boundary check pass; the feed server dependency graph resolves entirely inside VPS. Seventeen focused feed/challenge tests pass, including ranked API output, authentication, NSFW/hidden filtering, cursors, retry, retained cards and late-response teardown. Chrome fixture checks cover desktop/mobile cards, native video playback, comments, slide URL replacement, retained feed DOM and cold deep-link dismissal.
- The broader VPS suite reports seven failures outside these focused checks (sidebar mock API, client lifecycle/send tests, message source/CSS parity and the resource test module). Live beta review has since been completed. No deployment was performed by this port.
