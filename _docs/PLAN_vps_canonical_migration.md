# Plan: VPS as the canonical Parascene web runtime

## Why this document exists

Parascene currently has working pieces split across the older hosted web deployment and a newer VPS runtime. The VPS can now accept and track large files, and it already connects to Supabase. The long-term goal is for the VPS to serve the canonical `www` site so that Vercel can eventually be retired or reduced to a temporary compatibility layer.

This is a migration of an existing product, not a greenfield rewrite. The safest path is to move ownership in stages while keeping the current site usable and making every stage reversible.

## Current product surface

The product is broader than the file-upload proof of concept. The canonical logged-in experience is intended to be one chat-first application with several lanes or destinations:

### Identity and account

- Sign up, log in, log out, session restoration, and auth-gated pages.
- User account settings, credits/plan information, help, and related account utilities.
- Public profiles and profile links from other parts of the application.
- Admin and moderation capabilities.

### Chat and connection

- A chat-first shell with a persistent sidebar/navigation area.
- Public or group chat rooms/channels.
- Direct messages, including a right-side conversation pane.
- File and link sharing in conversations.
- Presence, unread state, mentions, replies/threads, reactions, pins, and chat history behavior.
- Realtime updates/broadcasts through Supabase and/or the application server.

### Discovery and social activity

- Feed of creations and activity.
- Explore/discovery, whose meaning may evolve beyond “people I do not follow.”
- Recent comments and other feed-like/channel-like views.
- Likes, follows, comments, replies, notifications, sharing, and profile navigation.
- Creation detail pages with media, metadata, comments, actions, and related navigation.

### Creation and media workflows

- A creation list/library.
- Basic composers for image, video, audio, mutation, and related quick actions.
- Advanced/legacy creation screens for more complete control.
- Uploading, storing, serving, deleting, and tracking large files.
- Generation jobs, provider integrations, queues/wait states, thumbnails/posters/covers, and media processing.
- Creation editing, publishing, NSFW/content-safety state, and visibility/access rules.

### Challenges and community programs

- Challenge discovery and detail views.
- Submission, voting, scoring, results, rewards, and organizer/admin workflows.
- Challenge history and challenge-related media/status in feeds and creation detail.

### Libraries and adjacent surfaces

- Prompt library for characters, styles, and future reusable assets.
- Styles/personas/audio-clip surfaces and related detail pages.
- Integrations and external connections.
- Blog/help/terms/privacy/pricing/landing pages, embeds, share pages, and public SEO routes.
- Credits, subscriptions/tipping, billing, provider/server management, email, and webhooks.

## What the repository tells us about the transition

The codebase already has an incremental migration shape:

- `/feed`, `/explore`, `/creations`, `/challenges`, and `/chat/*` use the chat-first shell for ordinary users.
- Detail and workflow routes can run standalone or inside the chat shell as overlays.
- The old `app.html` shell still exists, particularly for admin and legacy paths.
- There are parallel `public/` and `src/` shared modules, so some behavior currently has two copies.
- Supabase is the database/auth/realtime foundation; Redis/QStash and provider integrations support asynchronous work.
- The VPS large-file API is a new capability, but it is only one bounded subsystem. It should not become the accidental owner of the rest of the application until the contracts around it are explicit.

## Things that were easy to miss

The visible screens are only part of the migration. Before declaring the VPS canonical, we also need to account for:

1. **Every route and entry mode** — logged-out landing/auth/help/public pages, logged-in chat lanes, overlays, direct URL loads, embeds, share pages, admin pages, and API endpoints.
2. **Authentication and authorization** — cookie/session behavior, Supabase token refresh, role checks, admin access, public/private creation rules, and cross-origin assumptions.
3. **Background work** — generation jobs, file processing, thumbnail/poster creation, feed/catalog rebuilds, QStash schedules, retries, dead-letter behavior, and startup recovery.
4. **Media delivery** — upload limits, resumability, storage location, signed URLs, range requests, caching, deletion, orphan cleanup, and backups. “The file exists” is not enough; the application needs durable metadata and a recoverable lifecycle.
5. **External boundaries** — image/video/audio providers, Stripe, email, OAuth/integrations, webhooks, Discord or other notification paths, and provider-server APIs.
6. **Realtime behavior** — chat broadcasts, presence, notifications, optimistic updates, reconnect behavior, and whether the VPS or Supabase is authoritative for each event.
7. **Operational safety** — deploys, migrations, environment/secrets, TLS, DNS, process supervision, logs, metrics, alerts, backups, restore drills, rate limits, abuse controls, and rollback.
8. **Product data semantics** — canonical IDs, ownership, publication state, credit accounting, billing state, moderation state, and idempotency for retries.
9. **Compatibility and search** — stable URLs, redirects, canonical metadata, sitemap/robots behavior, embed behavior, and old links shared by users.
10. **The migration itself** — traffic split, read/write ownership, cutover criteria, rollback procedure, and a way to compare VPS and current-site behavior before users are moved.

## Migration strategies

### A. Big-bang replacement

Move the whole site, DNS, and all runtime responsibilities to the VPS in one release.

**Pros:** one obvious architecture; no long-lived split-brain period; less routing complexity after the cutover.

**Cons:** highest blast radius; difficult to test all workflows together; failures in an obscure route can affect the whole site; rollback may be complicated by writes, jobs, and media created during the cutover.

**Assessment:** unsuitable for the current surface area unless the product is deliberately frozen and there is a tested restore/cutover rehearsal.

### B. Copy the old site into the VPS

Replicate the existing Vercel behavior on the VPS, then gradually replace pieces.

**Pros:** preserves more existing behavior initially; can provide a fast visual parity milestone.

**Cons:** likely preserves the old shell/route duplication and makes the VPS a larger pile of transitional code; behavior can drift between copies; it does not answer which implementation is authoritative.

**Assessment:** useful only as a short-lived compatibility step, not as the target architecture.

### C. Strangler migration by route or capability

Keep the current site serving traffic while the VPS takes ownership of bounded slices. Route only those slices to the VPS, with explicit API/data contracts and rollback per slice.

**Pros:** small blast radius; each slice can be tested with real users; supports the existing chat-first direction; makes gaps visible; reversible.

**Cons:** temporary routing complexity; some cross-surface flows span both runtimes; requires clear ownership rules and good observability.

**Assessment:** useful for internal sequencing, but not recommended as the user-facing migration shape here. The beta should remain behind its own origin until deliberate cutover.

### D. Separate frontend and backend migration

Move the API, jobs, and media services first while keeping the current frontend deployment; move the SPA and public pages later.

**Pros:** isolates infrastructure work; makes large-file and async-job reliability testable; frontend can continue shipping.

**Cons:** the browser must understand two origins or a proxy must hide them; auth, CORS, cookies, signed media URLs, and realtime connections become central risks.

**Assessment:** useful inside the parallel beta, especially for uploads, jobs, and media; not sufficient by itself for canonical-site status.

### E. Run both sites and compare them

Send mirrored reads or controlled shadow traffic to the VPS, compare responses and key workflows, then promote it.

**Pros:** strongest evidence before cutover; reveals route and data differences.

**Cons:** writes cannot be naively mirrored; media generation and billing must not be duplicated; implementation cost is higher.

**Assessment:** use selectively for read APIs, route checks, and synthetic workflows rather than trying to clone every side effect.

## Revised recommendation: parallel beta with a hard user-facing boundary

Use a **parallel beta site**, not a gradual takeover of `www`.

The old and new sites should have distinct origins and clear responsibilities:

```text
www.parascene.example  -> old site, stable and canonical during beta
beta.parascene.example -> new VPS site, separately testable product

                         eventual decision
                    beta becomes www in one deliberate cutover
```

The new site and old site can share the same Supabase database and selected foundations. The hard boundary is primarily at the user-facing origin and application runtime: `www` remains a complete old-site experience, while `beta` is a complete new-site experience. The old site should not depend on new VPS routes during beta. This keeps an unfinished beta feature from becoming a hidden production dependency and makes rollback simple: stop sending people to the beta.

The goal is to build and validate a complete replacement candidate. The beta can still be built in vertical slices internally, but those slices remain behind the beta boundary until the new site is ready.

Supabase should remain the durable system of record where it is already serving that role. Avoid ambiguous writes from both runtimes to the same data. For beta-only capabilities, prefer separate tables/schema or clearly namespaced records and storage paths. For shared data, document which runtime may write, how the other runtime sees it, and how rollback behaves.

### Where the line is drawn

The migration has three related boundaries:

1. **User-facing boundary:** `www` and `beta` have separate origins, shells, deployments, release cycles, and failure domains. A user on `www` should not unexpectedly cross into the beta because a route happens to be implemented there.
2. **Data boundary:** both sites may read shared Supabase tables, but each important write workflow has one clear owner at a time. Shared rows do not mean shared authority.
3. **Job boundary:** generation, media processing, notifications, billing, and scheduled work must have an explicit worker owner and idempotency rules. A job must not run twice merely because both runtimes can see the same database row.

This is therefore a **parallel application migration over a shared data plane**. It gets the practical benefits of a strangler—capabilities can be rebuilt and adopted incrementally—without making the old website a patchwork of old and new user experiences.

### What carries over—and what does not

The old site is a source of product knowledge, user data, route behavior to preserve where it matters, and real workflows to test against. It is not the architectural template for the beta.

Carry forward deliberately:

- the product capabilities users rely on;
- identities, permissions, creations, comments, messages, files, credits, and other durable data;
- stable public URLs when they are valuable or externally shared;
- important semantics such as ownership, publishing, visibility, moderation, and billing;
- lessons from old bugs and user behavior.

Do not carry forward by default:

- non-SPA standalone page patterns for logged-in product surfaces;
- the legacy `app.html` shell and its all-routes-in-one-document assumptions;
- iframe overlays used to make separate pages feel like one application;
- duplicated `public/`/`src/` implementations and compatibility shims;
- navigation, layout, or route names that exist only because of the old implementation;
- old loading, caching, or lifecycle patterns that are known to cause duplicate work or confusing state.

The beta should have one coherent SPA shell, one navigation/state model, and native in-app transitions for its logged-in product surfaces. Standalone documents may still be appropriate for deliberately public or document-like surfaces—such as help, terms, privacy, blog, share pages, or authentication—but they should be an explicit product decision, not the default escape hatch for an unfinished SPA route.

The old site should therefore be treated as a **reference implementation and compatibility oracle**, not a codebase to copy wholesale. “Feature parity” means that a user can accomplish the needed task; it does not mean reproducing the old DOM, page boundaries, or interaction mechanics.

## Frontend-first construction model

The first implementation work should be the beta frontend and its contracts, not a wholesale backend migration. Build a coherent SPA shell, establish the visual/component system, and add API calls only as the next user-facing slice requires them. This makes the new architecture visible early and prevents the old API surface from dictating every new interaction.

### CSS and HTML as module source files

The goal is source-level organization, not runtime CSS optimization. A JS module should be able to import the HTML and CSS that define its visual surface:

```js
import template from './Button.html';
import './Button.css';

export function renderButton(props) {
	// create or render the imported fragment, then bind behavior
}
```

Rollup can treat HTML imports as strings/fragments and CSS imports as build inputs. The build may eventually extract and combine CSS for delivery, but that is an output concern. During development, the important property is that a module’s behavior, markup, and styling are easy to find together.

The intended build contract is:

- `import template from './Thing.html'` becomes a JavaScript string export, usable anywhere a template string would be used.
- `import './Thing.css'` registers that stylesheet as a dependency of the importing bundle.
- Rollup gathers each imported stylesheet once, preserves a predictable order, and emits a separate CSS asset such as `beta.bundle.css`.
- The HTML fragment is inlined into the JavaScript bundle; it does not create an additional browser request.
- The CSS bundle is linked or preloaded by the beta HTML shell, so styling does not depend on runtime JavaScript injecting `<style>` elements.

Rollup does not process HTML or CSS imports by itself, so this requires small build plugins or a project-local plugin. The HTML plugin can return `export default ${JSON.stringify(source)}`. The CSS plugin can collect imported file contents during the build and emit one asset during `generateBundle`. The existing chat CSS bundling script is a useful starting point, but the beta should give CSS ownership to the import graph rather than maintain a manually curated list.

This is compatible with vanilla JavaScript. It does not require React or a runtime CSS-in-JS library. A small Rollup HTML-string plugin and a CSS import/extraction plugin—or a project-local equivalent—can establish the convention. The first implementation should prove the import pipeline with one component and one view before it is applied broadly.

CSS namespacing should be deliberate. Component and view classes can use stable prefixes such as `.ps-button-*` and `.ps-view-chat-*`; a later hashed CSS-module convention is optional. Stable names are often easier to inspect while the beta design system is being established.

The beta stylesheet should have four deliberate layers:

1. **Global foundation:** reset, document defaults, typography, color/theme tokens, spacing scale, motion/accessibility preferences, media defaults, and z-index/layer rules.
2. **Components:** buttons, links, inputs, menus, dialogs, tooltips, avatars, badges, skeletons, tabs, cards, media blocks, and loading/error/empty states. These establish the shared visual language.
3. **Views:** chat, feed, explore, creations, profile, creation detail, challenges, prompt library, and creation workflows. These are rendered product surfaces—modals, panes, forms, and larger sections—that assemble components and coordinate data/state.
4. **View composition:** responsive placement, view-level layout, view-specific states, and relationships between components within a surface. A view may style its layout; it should not redefine the visual contract of a shared component.

The key rule is that global CSS contains foundations, not convenient homes for component or view styling. A selector belongs globally only when it is truly document-wide or a deliberate token/foundation. Otherwise it lives beside the module that owns the markup. Every new module should answer: is this a component or a view, which layer owns this rule, what is its public state/event API, and which existing component should it reuse?

### Layout, routes, views, and presentation slots

Routes are not one-to-one with views, and they are not the same thing as menu items. A route represents navigable application state or user intent. A view is a reusable rendered surface. A presentation slot determines where that view is mounted: the main canvas, a side pane, a modal, a drawer, a popover, a full-sized takeover, or another surface layered over what is already present.

The layout is the persistent application composition. It owns the stable shell and named presentation slots, including the menu view, primary pane, optional secondary pane, and layered surfaces. The menu view is available across routes; it is not itself the route content. Home is also a view mounted into a pane, not a special replacement for the layout. The file manager may have a route and a `FileManagerView`, but appear as a pane without being one of the primary menu destinations.

Another route may resolve to a full-sized popover; dismissing it removes the top presentation layer and reveals the underlying view beneath it without reconstructing the layout or losing the underlying view’s state.

The router should therefore resolve route state into a presentation description rather than directly assuming “route equals page”:

```text
URL/state -> route resolver -> view + presentation slot + parameters
                                      |
                                      v
              persistent layout -> menu + pane(s) + modal/popover/drawer
```

Route state should preserve the presentation stack, back/dismiss behavior, direct-link behavior, menu state, and the underlying view’s state. A view should be mountable in more than one appropriate slot when its interaction contract supports that use. Layout and views should have separate ownership: the layout composes slots and persistent chrome; views implement the content and interactions inside those slots.

### Components versus views

Components are the site library. They should be reusable, visually consistent, and relatively narrow in responsibility. A component receives data or state, renders a recognizable piece of interface, emits intentional events, and does not know which view contains it. Examples include `Button`, `TextField`, `Avatar`, `UserChip`, `MediaPreview`, `Dialog`, `Tabs`, `Skeleton`, and `ErrorState`.

Views are product surfaces. They own layout, composition, route-level state, loading/error/empty transitions, data loading, and coordination between components. A view can be a modal, pane, form, frame, or larger section, and it should expose a clear boundary to the application shell. Examples include `ChatView`, `FeedView`, `ExploreView`, `CreationDetailView`, and `CreateWorkflowView`.

The distinction is useful because it prevents two opposite failures: putting application behavior into tiny visual components, or allowing every view to invent its own buttons, inputs, spacing, and loading states. Components provide the vocabulary; views provide the sentences.

### Network and client-state model

The frontend should also establish a small data-access layer rather than letting every component call `fetch` independently:

- one API client for auth, headers, errors, request IDs, and cancellation;
- resource modules with stable cache keys and request deduplication;
- explicit freshness rules for user profiles, avatars, lists, messages, and creation detail;
- optimistic updates only where rollback behavior is defined;
- cursor-based pagination for feeds, messages, comments, and large lists;
- shared media URL handling with browser caching, signed-URL refresh, and image/video lazy loading;
- realtime subscriptions only for resources that need them, with reconnect and resynchronization behavior;
- route-level data loaders that can batch initial requests and avoid N+1 component fetches.

The goal is not the fewest possible requests at any cost. It is a predictable request graph: the shell loads once, each route has a known initial data set, repeated resources are deduplicated, and background refresh does not compete with the user’s first interaction.

### Suggested beta source structure

The exact names can change, but the separation should be recognizable:

```text
src/beta/
  app/                 shell, router, session, global providers
  design/              tokens, primitives, shared visual rules
  components/          site-library components; each may import .html and .css
  views/               modals, panes, forms, and larger surfaces
  routes/              route resolution, presentation stacks, and URL state
  data/                API client, resource loaders, cache, realtime
  media/               images, avatars, previews, uploads, playback
```

This should be a new beta entry point and bundle. It should not require the old `public/shared` tree or the legacy overlay runtime just to get started. Shared backend contracts may be reused; frontend ownership should be earned through an intentional module boundary.

### Frontend-first parity loop

For each slice:

1. Define the user task and the smallest coherent route experience.
2. Build the shell, loading state, empty state, error state, and responsive behavior.
3. Establish or document the API contract needed by that experience.
4. Implement the data loader, caching, pagination, and invalidation behavior.
5. Add the write path and its optimistic/rollback behavior if applicable.
6. Compare the result with the old site for capability and trust, not DOM similarity.
7. Test network behavior, reload/direct-link behavior, slow connections, and stale sessions.

The first slice should be small enough to finish, but architectural enough to prove the system: for example, the beta shell plus session restoration, sidebar navigation, a user/avatar resource, one feed or chat lane, and one shared composer. Once that slice feels solid, subsequent features can follow its patterns instead of inventing new ones.

## Suggested phases

### Phase 0 — establish the beta boundary and inventory

Before moving another major feature:

- Choose the beta hostname and make its deployment, cookies, media URLs, API origin, and realtime origin explicit.
- Create a route/capability matrix covering all public, authenticated, admin, API, webhook, worker, and embed routes for the new site.
- Record current and target owners for each route, database table, object-storage path, queue/job, and external integration.
- Write down cookie scope, CORS policy, TLS termination, upload limits, media URL policy, and the rule that the old site must not require the beta to function.
- Define a deployment/rollback runbook and a minimal health endpoint.
- Add request IDs, structured logs, error reporting, and basic uptime checks on the VPS.
- Identify the few user journeys that must never regress: sign in, open chat, send a DM, upload/share a large file, create/publish a creation, open creation detail, comment, and participate in a challenge.

### Phase 1 — make large files production-safe

Treat the current upload/list/delete API as a bounded vertical slice and finish its contract:

- authenticated ownership and authorization;
- durable file metadata and lifecycle states;
- resumable or retry-safe uploads where needed;
- size/type/content-safety checks;
- stable download/range behavior;
- signed or access-controlled URLs;
- idempotent delete and cleanup;
- backup/restore expectations;
- metrics for upload success, failure, latency, and storage growth.

Do not make the VPS canonical yet solely because this slice works. Use it as the first proving ground.

### Phase 2 — build the beta backend and shared-data contracts

Put the new API and worker contracts behind one VPS-controlled beta origin. Build capability by capability: media metadata, creation media processing, generation job status, then chat-adjacent APIs as appropriate. Keep Supabase as the data authority unless a deliberate ownership change is documented. Do not route the old site through these new endpoints merely to prove reuse.

For every moved write, answer: where is it committed, how is it retried, how is it deduplicated, and what happens if the old and new runtime disagree?

### Phase 3 — make the beta a coherent product

Finish the chat-first shell inside the beta. Consolidate duplicated shared modules where practical. Keep standalone public/document-like pages only where they have a clear purpose, and verify that direct URL loads and in-app navigation produce the same destination and permissions.

The beta should have an explicit minimum complete product, rather than an arbitrary percentage of old routes. Advanced creation screens can remain deliberate beta routes while they are modernized, but missing functionality must be visible in the beta’s scope rather than silently falling through to `www`.

### Phase 4 — validate the beta without coupling the old site

- Run route smoke tests against the beta and regression checks against the old site.
- Compare safe read responses and rendered route outcomes where both sites intentionally represent the same data.
- Use a small allowlist of beta users or an explicit beta signup flow; do not silently send ordinary `www` traffic to the VPS.
- Monitor auth failures, API errors, upload failures, job latency, chat reconnects, media 4xx/5xx rates, and database load.
- Keep writes single-owner per capability; never dual-write billing, credits, generation jobs, or user-visible messages without an idempotency design.
- Collect qualitative feedback from beta users about clarity, trust, missing workflows, and whether the new site feels coherent.

## How to judge whether the VPS is better

The VPS should not be promoted because it feels faster during a manual check. Compare the current runtime and VPS using the same journeys, the same user cohort where possible, and the same time window. Measure both **parity** (does it do the same thing?) and **quality** (does it do it reliably and pleasantly?).

### 1. Correctness and coverage

- Percentage of required routes that render successfully on direct load, reload, mobile, desktop, and embed/overlay modes.
- End-to-end journey pass rate for sign-in, chat, DM, file sharing, creation, publishing, comments, challenge participation, and account actions.
- API contract parity: status codes, response shape, authorization behavior, redirects, and error states.
- Realtime parity: message delivery, presence, unread counts, reconnect recovery, and notification delivery.
- Number and severity of regressions, including broken old links and public metadata/SEO failures.

These are release gates. A faster system that loses messages, leaks private files, or breaks creation publishing is worse.

### 2. Reliability and recovery

- Request success rate by route and capability, especially auth, uploads, media delivery, chat, creation, and billing.
- 5xx rate, timeout rate, client error rate, and error rate by browser/device class.
- Upload success rate, retry rate, partial-upload rate, download/range success, and orphaned-file rate.
- Job completion rate, queue age, retry count, stuck-job count, and time from submission to usable media.
- Chat send-to-receive latency and reconnect recovery time.
- Database, storage, memory, CPU, disk, and network saturation.
- Recovery time objective and recovery point objective proven in a restore rehearsal.

Track p50, p95, and p99 for latency-sensitive metrics. Averages alone can hide a bad tail experience.

### 3. User experience

- Time to first usable shell and time to first meaningful content for the main lanes.
- Navigation latency between chat, feed, explore, creations, profiles, and detail views.
- Creation composer open time, submit-to-progress time, and submit-to-result time.
- Upload start-to-visible time and perceived progress accuracy.
- Client crashes, uncaught exceptions, failed dynamic imports, and blank-shell occurrences.
- User-visible abandonment: sign-in abandonment, upload abandonment, composer abandonment, and failed-send abandonment.

These should be segmented by route, device, connection quality, and authenticated state. A desktop-only improvement should not conceal a mobile regression.

### 4. Product outcomes

After correctness and reliability are acceptable, compare whether the runtime helps users complete the product’s purpose:

- Chat messages sent and successfully received.
- Files shared and successfully opened by the recipient.
- Creations started, completed, published, viewed, commented on, and revisited.
- Challenge submissions and participation completion.
- Returning-user rate and meaningful sessions, not merely page views.
- Support issues and user-reported failures per active user.

These metrics should be interpreted cautiously during a canary because traffic composition may differ. Use them as supporting evidence, not as a reason to tolerate correctness failures.

### 5. Cost and operational burden

- Cost per active user, upload, generated asset, and successful session.
- VPS bandwidth, storage growth, backup cost, and provider/API cost.
- Deploy duration, rollback duration, and operator intervention count.
- Time spent diagnosing incidents and number of undocumented manual steps.

The VPS is not genuinely better if it lowers hosting cost but increases failures, maintenance time, or recovery risk.

### Suggested promotion gates

Before increasing VPS traffic, require:

- no unresolved critical correctness or security regression;
- required journey pass rate at or above the current site’s baseline;
- error and timeout rates no worse than baseline, with an agreed tolerance;
- p95 latency no worse than baseline for the migrated capability, or a documented reason to accept the tradeoff;
- upload, chat, and job reliability meeting explicit minimums;
- successful backup restore and rollback rehearsal;
- no unexplained divergence in writes or user-visible state.

The exact thresholds should be filled in from a short baseline run before the canary. Until then, claims that the VPS is “better” should be limited to capability ownership and infrastructure readiness, not product superiority.

## The human side of the migration

This is a long process with a real risk of turning into an endless obligation: every old behavior becomes something to preserve, every new decision creates another document, and the visible product may appear unchanged for weeks. The plan needs measures that protect the person doing the work, not only the service being migrated.

### What can keep the work going

- **A visible finish line:** define a small beta promise such as “a person can sign in, enter the chat, share a large file, open it, and return later.” Everything outside that promise is explicitly later.
- **Vertical slices that feel real:** each phase should produce something you can use and show, not only infrastructure tickets. A working upload shared in a DM is more sustaining than a completed reverse-proxy checklist.
- **Short feedback loops:** use a small trusted cohort, weekly demonstrations, and a simple “what got better?” note. This prevents months of work from becoming one frightening final cutover.
- **Progress that reduces future uncertainty:** prioritize work that answers a question or removes a class of risk. A tested restore, a known route owner, or a proven upload lifecycle is meaningful progress even if users do not see a new button.
- **Permission to stop or change direction:** every phase should have a success condition, a timebox, and a stop rule. “Continue until everything is migrated” is not a safe or motivating plan.
- **Protected creative time:** reserve some time for product improvements that are not migration work. Otherwise the migration can consume the product it is meant to enable.

### What is confusing or hard to measure

- **Parity is not improvement.** A VPS can reproduce the same behavior without making the product better. Track “same,” “better,” and “not yet supported” separately.
- **Averages hide lived experience.** The median user may be fine while a mobile user on a poor connection, a new user, or an admin is having a terrible time. Segment the important journeys.
- **Quiet failures are expensive.** A missing notification, stale unread count, broken deep link, or lost upload may not appear in server uptime or page-load metrics.
- **Small beta samples are noisy.** Engagement can rise or fall because of who happened to visit. Treat qualitative reports and repeated task completion as important evidence, not just dashboard movement.
- **Migration work has delayed value.** Reliability and recovery improvements may not produce immediate usage growth. Record the risk they retired so the work is not judged only by short-term activity.
- **The comparison itself changes the system.** A VPS can look worse while it is receiving new code, different caching, or a different user mix. Record cohort, release, route, and configuration alongside every comparison.

### What is easy to miss or get wrong

- Mistaking “the route loads” for “the user can finish the task.”
- Preserving implementation details that users do not need while accidentally dropping small trust-building behaviors: clear progress, undo, confirmation, sensible errors, remembered state, and reliable back navigation.
- Moving a feature without moving its maintenance surface: admin tools, cleanup scripts, email, webhooks, analytics, moderation, and support diagnosis.
- Treating the VPS as canonical before ownership is actually clear, creating two places where a fix might need to be made.
- Making a temporary compatibility layer permanent because no one wrote down its removal condition.
- Asking an agent to perform a broad migration without giving it boundaries, a route contract, test journeys, and a definition of “do not change.”
- Measuring activity instead of trust. Users may stop reporting failures because they quietly stop using the feature.
- Letting beta scope expand whenever an adjacent gap is discovered. Keep a parking lot; do not turn every discovery into this week’s requirement.

### A practical weekly check-in

At the end of each migration cycle, answer five questions in plain language:

1. What can a real person do now that they could not do safely before?
2. What important behavior is still only working on the old runtime?
3. What did we learn that changed the plan?
4. What is the next smallest demonstrable step?
5. What are we consciously not doing yet?

If these answers cannot be given clearly, the project may need a narrower slice or a rest period before more implementation. The goal is not merely to finish the migration; it is to arrive with a product and a process that are still understandable and enjoyable enough to continue building.

### Phase 5 — deliberate replacement decision

Cut over only after the beta has passed a defined soak period, the required journeys are complete, and a restore/cutback rehearsal has succeeded. The cutover should be an explicit decision with a checklist, not the accidental result of routing more traffic over time.

At cutover, choose one of three outcomes:

- **Promote:** point `www` to the VPS and keep the old deployment available as a time-limited fallback.
- **Extend beta:** keep the old site canonical while addressing specific gaps.
- **Stop or reset:** preserve useful infrastructure and learning without forcing an incomplete replacement into production.

Retire the old deployment only after confirming that no route, cron, webhook, OAuth callback, asset URL, or operational procedure still depends on it.

## Definition of “VPS is canonical”

The VPS can be called canonical when all of the following are true:

- The canonical web origin resolves to the VPS and every required route has an intentional owner.
- Auth/session behavior works across direct loads, reloads, overlays, and mobile/desktop paths.
- Supabase, storage, queues, and external providers have documented ownership and failure behavior.
- Large files survive retries, deploys, and restart scenarios; metadata and blobs can be restored.
- Generation, chat, comments, creation publishing, credits, billing, and challenge flows have been exercised end to end.
- Background jobs and schedules run from the intended runtime with monitoring and recovery.
- There is a tested rollback path that does not silently split writes or lose user data.
- The team can deploy, inspect, and restore the VPS without relying on undocumented manual steps.

## The next concrete step

Do not start by asking an agent to copy the old site wholesale. Start by producing the route/capability matrix and selecting one vertical slice as the migration template. The first implementation pilot is the existing VPS file-management experience, documented separately in [PLAN_beta_frontend_pilot.md](PLAN_beta_frontend_pilot.md).

That pilot will refactor the current VPS pages in place as an example of the new beta frontend pattern. It is intentionally not an attempt to migrate the old site. It should prove the source organization, component/view boundary, HTML/CSS import pipeline, API/data layer, caching conventions, and test approach that later beta surfaces will use.

The candidate slices remain:

1. large-file upload and retrieval;
2. authenticated chat file sharing;
3. creation media upload/processing;
4. one complete creation-detail read path; or
5. one complete chat lane with its API and realtime behavior.

The best immediate choice is probably **large-file upload plus authenticated sharing**, because it exercises identity, authorization, durable metadata, media delivery, UI integration, and failure recovery without requiring the entire generation system to move first.

The output of that slice should be a reusable template: route ownership, API contract, data ownership, deployment, observability, test journey, and rollback. Every later slice should have to meet the same template.

## Open decisions to settle deliberately

- Is the VPS only the web/API runtime, or will it also own durable media storage?
- Which hostname is canonical during beta, and how will cookies work across any temporary split?
- Is Supabase Storage still used for some assets, or is the VPS file store becoming the default?
- Which jobs run on the VPS versus QStash/provider infrastructure?
- What is the minimum beta feature set that must be migrated before public traffic is invited?
- Which legacy pages are intentionally retained, and which are scheduled for removal?
- What are the recovery objectives: acceptable data loss, restore time, and maximum outage?
- What user cohort can safely serve as the first VPS canary?
