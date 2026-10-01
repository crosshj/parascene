# Beta cutover log

This is a dated log of thoughts, decisions, concerns, and observations during the VPS/beta cutover.

## 2026-09-30

I’m feeling a little better about it today. I’ve gotten My Creations working better.

I could build out the feed and make Files consistent with My Creations. I could bring over the chat functionality, or I could get the composers working correctly. All of those would be valuable, but I want to establish the overlay pattern we already have in the app.

That is one reason I’ve been working on My Creations: I need a place where I can click something and open a creation detail view. Bringing creation detail over may be challenging, although it could also be straightforward. If I can move it over cleanly, I’ll have a working example of a view appearing over the app.

I also need to fix the mobile view. It is currently in poor shape. Even after these pieces are in place, there will still be problems to work through, but I think having creation detail, overlays, and a functional mobile view would put the beta in a much better position. At that point, a cutover could become realistic. I would like to leave Vercel behind and continue with the VPS, because I think it will be a better foundation.

One VPS concern I still need to solve is what happens when the app crashes. That will be painful if it affects production directly. Continuing with the beta program gives me a place to encounter those failures before promoting the system to production. That separation is valuable because errors in beta will not immediately affect production. The logging situation is related, including runtime, build, deployment, and container issues.

There is probably much more to bring over before I can fully deprecate the old system. After everything is migrated, I also need to make sure the resulting patterns support continued operation and do not confuse AI coding agents.

Shared areas should be extracted into clear modules. The overall structure needs to make sense, including how client-side views are loaded into the outlet and how the application is organized around them. The backend also needs to serve both the frontend and the desktop client correctly.

These may ultimately be cleanup tasks, but they are important to the long-term health of the system. I’ll leave it there for now.

### AI feedback (GPT-5.6-Luna medium)

This seems like the right direction. Using creation detail and overlays as the next vertical slice is especially strong because it proves an application-wide pattern while advancing a real feature.

The main concerns are already present: migration completeness, outlet and overlay behavior, mobile layout, crash handling, logging, shared modules, backend consumers, and keeping the code understandable for future AI-assisted work.

The areas still needing explicit attention are:

- A beta exit checklist defining what must work before promotion and what can remain imperfect.
- Deployment recovery, including health checks, automatic restart, rollback, and database migration safety.
- Stable API and data contracts shared by the web and desktop clients.
- Authentication, permissions, and privacy for detail views, files, messages, and creations.
- Performance on slower devices and connections, including caching, media loading, request counts, and startup time.
- Smoke tests for login, navigation, creation detail, uploads, mobile layout, and deployment health.
- Accessibility and browser behavior, including keyboard navigation, focus management, and back-button behavior.
- Clear user-facing states when the API, media service, or VPS is unavailable.

The key distinction is between proving that a feature can be migrated and proving that the resulting architecture is healthy enough to operate and extend. Creation detail can test both. A concise beta-readiness checklist would turn the broader concerns into measurable criteria.

### Farther-reaching future direction

After the current pushes are more stable, I want to return to the larger idea behind Parascene: helping people build characters and worlds. I want the product to be less centered on social activity for its own sake. The social layer should support the work of building characters, worlds, and shared creative settings.

That could lead to workflows that help people review their creations, identify recurring characters, and turn them into character sheets or other structured creative resources. The goal is to help people develop characters in a meaningful, almost three-dimensional sense, and to create media that travels naturally to the platforms around us. Parascene should not become a warehouse for an ever-growing pile of undifferentiated files.

This raises the possibility of resource limits on stored creations and files, along with tools for compacting or distilling a body of work into more useful summaries and reusable assets. The analogy is to compaction in an AI coding session: at some point, accumulated material needs to be condensed so the important structure remains usable. This could also help control infrastructure costs that are not supported by subscribers or other contributors.

I need stronger safeguards around these resources. That includes thinking about how to protect Parascene itself and how to safely protect connected servers if the broader network model becomes more active. At the same time, I may want to reduce the prominence of the server concept in the product. There are not currently enough users interested in running servers to justify making that use case central to the interface.

This does not mean abandoning the server architecture or the original peer-to-peer vision. It means simplifying the product around the use case that is active now, while keeping the underlying capabilities available for a later stage. The two related goals are to expose fewer distractions and to provide stronger tools that guide people toward the creative work Parascene is meant to support.

#### AI feedback

This is a coherent and potentially stronger product thesis: Parascene would be organized around persistent creative entities—characters, worlds, styles, and relationships—rather than around an endless stream of generated media. Social features would remain, but as infrastructure for collaboration, feedback, and shared development.

The most important caution is not to turn “fewer stored files” into “users must delete their work.” A useful compaction system should be additive and reversible where possible. It could distinguish between source material, working variations, canonical creations, character/world records, and externally published exports. Users should be able to archive, export, restore, or rehydrate material, with clear warnings before anything is deleted.

The character and world idea also needs a concrete first workflow. A good pilot might let a user select several creations, identify or define a character, review the extracted traits and references, edit the resulting character sheet, and use it in a later generation. That would test whether the concept creates real value before introducing a broad knowledge-management system.

The product should be careful about automatically inferring identity, canon, or ownership from a collection of creations. Extraction should be presented as a draft for the user to confirm. Provenance, permissions, privacy, and the distinction between a private working character and a publicly shareable one will matter as soon as these resources can be reused by other people.

The server simplification is sensible as a product decision, but it should be validated rather than treated as permanent. Measure whether server UI is confusing, unused, or merely difficult to discover. Keep provider APIs, credits accounting, and connection boundaries stable underneath while reducing their prominence in the main experience. This preserves optionality without forcing the current audience to understand the entire network model.

There are three separate future initiatives here:

- **Creative direction:** make characters, worlds, and reusable creative context central to the product.
- **Information lifecycle:** help users organize, distill, archive, export, and eventually remove accumulated media.
- **Platform simplification:** make servers and providers less prominent for ordinary users while preserving them as infrastructure.

They should not be implemented as one large redesign. The safest sequence is to validate the creative workflow first, establish user-controlled lifecycle primitives second, and then simplify the server-facing product based on observed usage. The main measures should be whether users return to develop a character or world, whether extracted resources are reused in later creations, whether users understand what is canonical, and whether storage costs become more predictable without undermining trust.

## Migration-critical constraints — treat as on fire

### Creation-detail overlay and routing must mirror the www SPA

Creation detail is not a normal route rendered into the page outlet. The overlay is app functionality owned by the layout/app shell, with the detail view mounted inside an app-level overlay host. It must remain independent of the underlying view that opened it.

Routing and overlay state are one system:

- A deep-loaded `/creations/:id` URL must resolve a valid underlying/default route but leave it dormant, reveal and mount creation detail first, and only start the background when detail signals a terminal ready/error state or the overlay is dismissed—whichever happens first. Session refresh and background loading must not delay or flash ahead of detail.
- A card click must preserve the already-loaded creation row/seed, update history, and open the same overlay path used by a deep link.
- The overlay must preserve the underlying route and scroll state while open.
- Closing, dismissing, or pressing Back must restore the correct underlying URL and state rather than leaving a detail route in the outlet or producing a blank shell.
- Navigating between details must update overlay history and content without tearing down the app shell.
- The detail view must be mounted into the layout's app-level overlay region, not by `CreationsView` and not as a normal router outlet page. There is no separate overlay controller; region occupancy is the overlay lifecycle.

Do not continue the beta creation-detail migration until the www SPA routing/overlay lifecycle has been traced clearly enough to reproduce these behaviors. If any part of the www implementation, deep-link defaulting, history ownership, or seed handoff is unclear, stop and resolve that detail before adapting code.

### Known incomplete creation-detail seam after the client-architecture refactor

The app shell, route composition, retained background, seed handoff, and layout-owned overlay are now represented by the VPS client architecture. The copied `CreationDetailView.js` is **not** thereby considered migrated. Its dependencies now use canonical static VPS imports, but it still contains document-wide selectors and delayed listeners. The initial-load API contracts observed below are ported and covered by VPS contract tests; action-specific requests elsewhere in the view still need verification as their controls are enabled. Treat any claim that creation detail is complete while those lifecycle seams remain as a release blocker.

#### Observed Creation Detail 404s (2026-10-01)

The following `GET` requests returned `404` while opening creations `31921` and `31885` in the VPS Creation Detail overlay. They were implemented in the self-contained VPS server on 2026-10-01, along with the like and notification acknowledgement mutations used by the same UI. The VPS implementation owns its routes and stores and does not import from `api_routes/` or another non-VPS source tree.

- `/api/profile` — current viewer profile; repeated across shell/detail initialization.
- `/api/users/:creatorId/profile` — creation-author profile. DevTools displays this and the viewer request as `profile`; `CreationDetailView.js` issues both route shapes.
- `/api/notifications` — notification list loaded by the shared navigation runtime; repeated on detail navigation.
- `/api/created-images/:creationId/like` — like metadata; observed for creations `31921` and `31885`.
- `/api/creations/nsfw-flags?ids=31773,31880,31884` — lineage NSFW flags.
- `/api/created-images/31885/activity?order=asc&limit=50&offset=0` — Creation Detail comments/activity.
- `/api/creations/31885/related?limit=40` — related creations.
- `/api/create/images/:lineageId?lineage_of=31885` — lineage item detail; observed for lineage IDs `31773`, `31880`, `31884`, and `31885`, with some requests repeated.

The primary creation loads for `31921` and `31885`, plus their PNG media requests, returned `200` in the same trace. The failures are therefore the dependent profile/social/lineage requests above rather than the base Creation Detail fetch.
