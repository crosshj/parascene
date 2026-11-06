# Mobile WWW → VPS parity contract

Status: product contract and implementation in progress, 2026-10-06. The user
authorized the mobile port. This document records the agreed requirements and
current implementation; proposed checks are not claimed as passed unless logged
below.

Confirmed user requirements: VPS follows WWW scroll behavior. Every mobile page
must support pulling down at its top to refresh the app. These requirements are
settled; the remaining presentation details are still under discussion.

Confirmed implementation boundary: the existing pages should already accommodate
mobile pull-to-refresh without substantial DOM/layout changes. Inspect and test
that structure first; prefer minimal, mobile-scoped corrections. Stop and discuss
the specific finding and proposed change with the user before making any major
change to desktop scrolling, DOM/layout, overflow or scroll restoration. The
refresh requirement does not authorize a desktop shell redesign.

## Product model

Mobile is a distinct shell composition sharing feature data and lifetimes with
desktop. It is not just a narrower desktop panel. Preserve the active WWW SPA's
navigation, hierarchy, density, chrome, scrolling, and transitions. Existing
explicit VPS product departures still apply; resolve conflicts before porting
the affected surface.

| Surface | Mobile contract |
| --- | --- |
| Primary lanes | WWW app header and five-action footer: Home/Feed (current label), Challenges, Create, Creations, Chat. Preserve icons, order, active state and badges. Create opens its workflow. |
| Chat entry | Chat opens the mobile roster presentation of channels/DMs. Share the Sidebar data/controller where appropriate; do not independently fetch and maintain a second roster. |
| Conversation | Contextual conversation header replaces the app header; app footer is absent. Mobile message composer, reply/attachment states and keyboard behavior follow WWW. |
| Page overlay | Overlay header supersedes app chrome; app footer is absent and reserves no space. Retain background route, data and scroll; dismiss restores them. |
| Canvas, nested dialogs, Doom Scroll | Inventory separately. Do not infer identical header, dismissal or scroll behavior from their all being overlays. |
| Content geometry | Remove desktop shell insets and panel rounding where WWW is full bleed. Preserve WWW's intentional internal content padding, card rounding and reading widths. |

Confirm exact per-route behavior against WWW before implementing it. In
particular, secondary routes such as Explore and challenge details must not
inherit primary-tab chrome merely because they contain browse content.

## Reference and mapping record required before each slice

Migration source of truth remains [the migration guidance](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md).
Start with the active SPA entry/import graph, not a similarly named legacy file.
For each slice, record:

1. WWW entry, builder, event handlers and actual rendered parent/child tree.
2. Winning styles from shell through content: stylesheet load order, selector,
   media/container query, variables, inherited properties and computed values.
3. Width/height constraints, positioning containing block, stacking context,
   clipping ancestors and the element that owns scrolling.
4. VPS destination owner and equivalent DOM tree. Explain wrapper additions or
   removals and selector adaptations; preserve structural relationships required
   by CSS. A different class name is fine; a different layout needs justification.
5. State transitions, data lifetime, route/history behavior and teardown.
6. Baseline screenshots and interaction observations at matching viewport,
   theme, content, auth state and scroll position.

Initial source landmarks (not a completed stylesheet/import audit):

| Concern | WWW reference | VPS owner |
| --- | --- | --- |
| Footer structure/actions | `src/shared/components/navigation/mobile.js`; `public/global.css` mobile-bottom-nav rules | `views/MobileNavigation`; router owns navigation |
| App header | `src/shared/components/navigation/index.js` and its active stylesheet chain | Shell-owned header view; confirm destination during design |
| Chrome/roster mode | `src/chat/chatPage.js`: `applyComposerState`, `setMobileSidebarMode`, mobile chrome builders | `app/routes.js`/state resolve presentation; `core/layout.js` applies it; Sidebar owns roster |
| Mobile layout/composer/scroll | `public/pages/chat.css`, including mobile-composer-overlay and viewport-scroll rules; `public/global.css` | `core/layout.css`, conversation/composer and feature styles |
| Page overlays | `src/shared/spaPageOverlay.js`; specialized mobile creation detail mount | Router and layout overlay region; feature owns content |

Initial audit findings: beta MobileNavigation was a simple link grid, and beta
mobile outlet sizing subtracted a fixed footer height while retaining shell
margins. The navigation slice now ports the five-action dock/header and applies
route-specific chrome; the browse scroll slice maps WWW viewport scrolling onto
the existing VPS shell at the mobile breakpoint. Full style-chain and screenshot
comparisons remain outstanding for the other surfaces.

## Ownership and CSS rules

- Resolve mobile presentation centrally from route/state and responsive mode.
  Define named presentation states and a visibility table before implementation.
  Views must not independently toggle app header/footer or write history.
- Layout owns shell geometry, region visibility, focus, background interaction
  suppression and scroll restoration. Features own internal spacing and content.
- At most one primary header is visible for the active surface. Hidden chrome
  must be absent from focus/accessibility navigation and leave no layout gap.
- Each surface declares its primary scroller. Explicitly map WWW document scroll
  to VPS and preserve WWW scroll behavior; do not retain beta's internal outlet
  scroller merely for implementation convenience. Review pagination observers,
  sticky elements, media visibility, scroll-to-message and restoration together.
  This is an audit requirement, not permission to replace shared layout or
  desktop scrolling. First verify whether the existing structure already works;
  apply the desktop-change discussion boundary above if it does not.
- Safe-area and keyboard clearance have one owner per edge. Do not stack footer,
  composer and content compensations for the same inset. Measure dynamic composer
  height rather than guessing from its collapsed state.
- Scope responsive rules to the owning shell/component. Do not use blanket
  descendant radius/padding resets, accumulating override tails, or unexplained
  `!important` to compensate for incorrect DOM or specificity.
- Preserve shared feature/controller instances through chrome changes where the
  composition still needs them. Resizing must not duplicate providers/listeners,
  discard drafts or reset scroll.
- Record each breakpoint from the active reference. WWW mobile chat uses 768px;
  beta also has 1023px shell rules. Audit their interaction rather than treating
  tablet widths as implicitly desktop or mobile.

## Pull-to-refresh requirement

Every mobile page must allow a deliberate downward pull at its top to refresh
the app, including short/empty/error pages, conversations and route overlays.
A refresh means an actual app reload at the current URL, not just re-rendering
the current list or showing a refresh animation. Existing persisted drafts must
retain their normal reload behavior.

Prefer native browser pull-to-refresh. Audit the complete scroll ancestor chain
for fixed-height overflow containers, root/body scroll locks,
`overscroll-behavior`, `touch-action` and touch handlers calling `preventDefault`.
Do not introduce app-wide gesture suppression that blocks refresh. Do not assume
that making one browse page document-scrollable proves support elsewhere.
Treat existing DOM/layout as the starting constraint. Do not preemptively move
scroll ownership, restructure wrappers or introduce custom refresh gestures.
Establish a reproducible failure first and identify the smallest mobile-scoped
correction. Discuss substantial desktop impacts before implementing them.

Preserve background inertness and scroll retention while overlays are open.
Simply unlocking the background to expose browser refresh is not acceptable.
Where WWW's pane/overlay behavior or a supported browser prevents native refresh,
record the conflict and design a shared layout-owned fallback before completing
that surface. Do not silently waive refresh or change WWW scrolling. Any fallback
must trigger only at the active surface's top after an intentional pull, avoid
interfering with normal scrolling/media gestures, and release its listeners on
teardown. The exact fallback is not decided by this document.

Maintain a route inventory covering every page and route overlay, with its WWW
scroll owner, VPS scroll owner, refresh mechanism and verification result.
Nested dialogs and media gesture surfaces require explicit interaction coverage
rather than an assumption that the underlying page's result applies.

## Repeatable verification to implement with the port

### Before

Capture a reference matrix and small deterministic fixtures: populated/empty
roster, long titles, unread badges, long conversation, multiline composer,
attachments/replies, populated browse grid, loading/error and overlay states.
Store reference provenance (WWW revision, route/state, viewport, theme).
Agree the presentation table and DOM mapping before changing the shell.

### During

Implement tests alongside each vertical slice:

- Pure presentation tests: route × mobile/desktop × overlay/roster state produces
  the intended header, footer, composer and scroll policy.
- Mounted DOM/lifecycle tests: expected ancestry/siblings, unique chrome,
  interaction handlers, retained instances, cleanup, focus and history behavior.
- Real browser geometry tests: full-bleed outer edges, intended padding/radii,
  no horizontal overflow, correct scroll owner, no covered last item, footer
  absent without leftover clearance, composer/header hit targets unobscured.
- Screenshot comparisons with reviewed WWW baselines. Mask only nondeterministic
  media/timestamps, never layout chrome. Do not accept regenerated baselines
  automatically to make a failing test pass.

Use geometry/style assertions for actionable failures as well as screenshots.
DOM tests and CSS text checks cannot prove rendered CSS parity. Browser harness
and baseline tooling need to be established; they are not currently supplied by
this document.

### After each slice

Exercise 360/390px phones, 768px, 769px, 1023px, 1024px and a wide desktop;
include landscape, light/dark and long content. Check Chromium and WebKit.
Test real iOS Safari and Android Chrome keyboard/browser-toolbar behavior before
claiming keyboard parity; desktop emulation alone is insufficient.

Required flows: primary tabs → Chat roster → channel/DM → back; Create → dismiss;
grid → detail → profile → return; direct overlay load; browser Back/Forward;
canvas open/close; nested dialog dismissal; composer focus/type/attach/reply/send;
resize/orientation while conversation or overlay is open. Check scroll retention,
message bottom anchoring, active footer state, safe areas, background inertness
and no duplicate subscriptions after repeated transitions.

For every route in the inventory, verify pull-to-refresh at the top with both
long and short/empty content. Verify an actual reload occurs, the current URL
reopens correctly (including direct overlay URLs), and normal downward gestures
away from the top do not reload. Repeat after navigation and overlay dismissal.
Check conversation history loading and message anchoring alongside refresh.
Automated DOM/geometry tests must cover scroll policy and gesture regressions;
native browser refresh must also be verified on real iOS Safari and Android
Chrome. Record installed-app behavior separately if that mode is supported.
No page is complete while its refresh result is missing or failing.

Run relevant existing tests plus `npm run build` in `vps/`. Report separately:
automated results, browser comparisons, physical-device checks and unverified
states. Build success is not visual acceptance. Keep desktop regression coverage
in every mobile slice.

## Port progress

### Navigation slice (in progress)

- Ported the WWW `mobile.js` footer structure/actions and the corresponding
  `public/global.css` dock rules into `views/MobileNavigation`. The five buttons,
  order, Home/Trophy SVGs, center Create action, active Home treatment, unread
  badge slots and gradient dock are retained. VPS route navigation, Create overlay
  opening, and thread-provider unread state supply the application seams.
- Added a mobile app header with the WWW logo/action arrangement and moved the
  existing VPS route actions into it while it is active. Notifications, credits
  and account actions call the existing Sidebar controller. Desktop header DOM
  and CSS are untouched.
- `/chat#channels` resolves to a roster route. It retains the app Sidebar's
  existing roster/controller/provider and applies WWW's mobile full-screen,
  viewport-scrolling roster presentation. It does not mount another roster.
- Conversations hide the app footer/header and show a Back to Chat control with
  the existing route title/actions. Route overlays hide app chrome; overlay's
  own header remains visible.
- `mobilePresentation.test.js` covers primary lanes, roster, conversations,
  secondary pages and overlays. Layout/CSS use the declared presentation state.
- Rendered a representative 390×844 Chromium fixture using the built stylesheet:
  header and dock were visible, the outlet spans x=0..390 and ends directly above
  the 72px dock, and there was no horizontal overflow. This was not a WWW
  screenshot comparison or a mounted app/route test. iOS/Android behavior has
  not been checked.
- Mobile pull-to-refresh remains unverified for every route. The browse scroll
  slice below records the routes now using WWW's document scroll owner; remaining
  routes retain their existing VPS scroll owners pending audit. Do not claim
  refresh parity until native-device checks pass.

### Browse scroll slice (in progress)

The active WWW \`setMobileSidebarMode\` enables viewport scroll for Feed, Explore,
Creations, Challenges and the mobile roster. Conversation routes retain their
message-pane owner; challenge subpages retain viewport scroll while hiding the
primary app chrome. Doom Scroll and route overlays own their visible scroll
surface while the background route stays retained.

The VPS layout now gives Feed, Explore, Creations, Comments, Challenges
(including their subpages) and \`/chat#channels\` document scroll at the 768px
mobile breakpoint.
This is mobile scoped; desktop still uses \`.beta-outlet__scroll\`. Feed/creation
pagination, feed media visibility, thumbnail lookahead, Explore pagination and
Creations' scroll-to-top follow the active scroll owner. Crossing the breakpoint
rebinds their observers without replacing the feature/controller.

Follow-up density corrections from the mobile review: Feed no longer inherits
the desktop 24px inline gutter and its loading cards use mobile spacing; the VPS
right sidebar becomes a full-viewport surface above app chrome; Profile reduces
overlay gutters and hero, stats and tab spacing on phones. These are mobile-only
CSS changes. A rendered comparison is still pending.

Current scroll inventory:

| VPS route/surface | WWW mobile owner | VPS mobile owner | Refresh status |
| --- | --- | --- | --- |
| \`/feed\`, \`/explore\`, \`/creations\`, \`/comments\`, \`/challenges\`, challenge subpages | Document/viewport | Document/viewport | Native-device check pending |
| \`/chat#channels\` | Document/viewport | Document/viewport | Native-device check pending |
| \`/ch/:slug\`, \`/dm/:slug\`, \`/notes\`, \`/feedback\` | Conversation/message surface | Existing outlet/message surface | Not yet verified |
| \`/files\`, \`/library\`, other page routes | Route-specific; audit pending | Existing outlet surface | Not yet verified |
| Creation/profile/Create/Doom route overlays | Overlay surface; background retained | Overlay content; background retained | Not yet verified |

The layout locks the document position while an overlay covers a document-scrolled
background and restores the captured position on dismissal. This needs browser
Back/Forward and device verification before the slice is complete.

### Conversation chrome/composer slice (in progress)

WWW's active mobile rules are in `public/pages/chat.css` (the 768px composer
rules and contextual topbar rules), with the conversation tree keeping its
message pane and composer as siblings. VPS already has the same shell-owned
composer controls and a route-owned message pane, so the implementation leaves
that DOM/lifetime intact. Mobile-only `layout.css` now removes the desktop shell
inset for conversations, applies the safe-area offset to the contextual header
and message content, and gives the composer the WWW translucent tray, input
shell, and touch target sizing. The breakpoint does not alter desktop geometry.

Build and targeted route/layout/feed checks pass after these styles. A rendered
conversation screenshot comparison, keyboard/attachment/reply flows, mobile
resize behavior, and native pull-to-refresh have not been verified; this slice
remains in progress until those checks are recorded.

### Feed skeleton and Creation Detail corrections (in progress)

The Feed loading skeleton now uses WWW's separate author row and action row,
with narrower action spacing below 480px. Creation Detail's nested `main` no
longer adds its standalone 56px mobile offset inside the overlay; the overlay
already reserves the 58px header plus safe area. Its mobile hero track now uses
the full available width for square, portrait and landscape media while keeping
each image's aspect-driven height. Structural tests and build pass; rendered
mobile comparison remains pending.

## Proposed sequence

1. Agree presentation matrix and capture WWW baselines; establish browser checks.
2. Port primary header/footer and mobile roster as one navigation slice.
3. Port full-bleed shell/scroll geometry across representative browse and chat views.
4. Port conversation chrome/composer, keyboard and canvas behavior.
5. Verify overlay variants and all return/deep-link flows, then remaining routes.

Each slice must pass its structural, behavioral and rendered checks before being
called complete. Do not substitute a handful of visually plausible CSS changes
for completion of the matrix.
