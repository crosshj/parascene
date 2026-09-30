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

### AI feedback (FPT-5.6-Luna medium)

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
