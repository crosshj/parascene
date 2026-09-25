# Plan: beta frontend pattern pilot

## Purpose

Use the current VPS file-management pages as the first contained example of the new beta frontend. This pilot is where we prove the construction model before rebuilding the larger Parascene application.

The pilot is successful when the page is easier to understand and extend, its requests are deliberate and observable, and the resulting patterns can be reused for chat, feed, creations, profiles, and creation workflows.

This is a frontend architecture pilot. It should not become a disguised migration of the old site or a reason to import old standalone-page patterns into the beta.

## Boundary

The pilot remains behind the beta/VPS origin. It does not change the old `www` site, route old users through the new pages, or require the old frontend to consume new VPS endpoints.

It may use the existing shared Supabase database and the existing VPS file API. Any write behavior must retain the current authorization and ownership rules, and any new metadata or cache state must have an explicit owner.

## What we are proving

1. HTML fragments can be imported into JS and inlined into the bundle as template strings.
2. CSS can be imported beside a component or view and emitted into a separate CSS bundle.
3. Components form a reusable site library.
4. Views form the rendered product surfaces—modals, panes, forms, and larger sections—and coordinate layout, data, and state.
5. API calls are made through a small data layer rather than scattered through rendering code.
6. Initial loading, empty, error, refreshing, uploading, and deleting states are designed explicitly.
7. Repeated requests are deduplicated and user/media resources are cached deliberately.
8. The build and test workflow is understandable enough to repeat for the next view.

HTML files are optional. Small, obvious markup—such as a button’s single
element—belongs directly at the top of the JS module. A separate `.html` file
is appropriate when the markup is large enough that keeping it beside the
behavior improves readability, such as a view shell or a substantial form.

Routes and views are intentionally separate. The file-manager view is a pilot
surface, not necessarily a primary navigation item. The router should be able
to mount it in the appropriate presentation slot—such as a pane—without making
the view responsible for menu placement. Future routes may mount views as
full-sized popovers or other layered surfaces and restore the underlying view
when dismissed.

The application layout is persistent across those route changes. It owns the
menu view and the named content slots. Home and File Manager are both views
loaded into a pane inside that layout; neither one is the layout itself. The
pilot should preserve this distinction even if the current beta has only one
main pane today.

## Development loop

The pilot should be developed through the VPS-local dev server, not by manually
assembling production assets. From `vps/`:

```sh
npm install
npm run dev
```

The dev command runs the existing Express beta server and Rollup in watch mode.
Client changes rebuild the beta JS/CSS assets, server changes restart Express,
and page-file changes are visible after a browser refresh. This deliberately
keeps the development path close to the deployed path: the same page routing,
asset manifest, cookie/session behavior, and API origins are exercised.

The first loop does not need HMR. A reliable rebuild plus refresh is preferable
while the component/view and CSS ownership model is still changing. Browser
live reload can be added later if repeated refreshes become a meaningful drag.

## Pilot surface

Keep the user-facing scope narrow:

- authenticated entry/session restoration;
- the file-management view;
- file list loading and rendering;
- large-file upload with visible progress/state;
- delete with confirmation and rollback/error handling;
- file metadata and access/display behavior;
- responsive layout and basic mobile behavior;
- sign-out or account action if it is already part of the current VPS page.

Do not add chat, feed, creation generation, billing, challenges, or old-site compatibility work to this pilot except where the existing page already needs a minimal shared contract.

## Proposed source shape

Names are illustrative; the important distinction is ownership:

```text
src/beta/
  app/
    betaMain.js
    router.js
    session.js
    layout.js
  design/
    tokens.css
    foundation.css
  components/
    Button/
      Button.js             # one-line markup stays here
      Button.css
    Avatar/
    EmptyState/
    ErrorState/
    FileRow/
    LoadingIndicator/
    ProgressBar/
  views/
    Home/
      HomeView.js
    FileManager/
      FileManagerView.js
      FileManagerView.html
      FileManagerView.css
  data/
    apiClient.js
    fileResource.js
    sessionResource.js
    cache.js
  utils/
    dom.js               # template mounting, data-ref binding, HTML escaping
  beta.css
```

The exact directory can change during implementation, but a reviewer should be able to tell whether a file is a component, view, application concern, or data concern without opening the whole graph. A component or view does not need both an HTML file and a CSS file; files are split when that makes the code easier to read. Larger HTML stays next to the component or view that owns it—there is no generic fragments directory.

Shared DOM utilities should absorb repetitive mechanics such as mounting an
imported view template, cloning native `<template>` elements, binding
`[data-ref]` elements to a refs object, and escaping values before token
replacement. Repeated or structured markup should live in native HTML
templates and be cloned; `createElement()` is reserved for cases where the
element itself is genuinely selected dynamically or no stable template exists.
Views should describe behavior and state, not repeat the same query-selector,
template, and escaping boilerplate.

## Build proof

Add the smallest possible Rollup proof before refactoring the entire page:

- one `.html` import that becomes a JS string export;
- one `.css` import that is collected into a separate emitted CSS asset;
- one beta entry bundle and one beta CSS bundle;
- one beta HTML shell that links the CSS asset and loads the JS bundle;
- development asset versioning/cache busting consistent with the VPS deployment;
- a build check that fails clearly when an HTML or CSS import cannot be resolved.

Do not optimize code splitting yet. The first pilot should favor a simple, deterministic entry graph and one predictable CSS output. More granular bundle splitting can be evaluated after the ownership model is stable.

## Component rules

Components should:

- own a focused piece of markup and styling;
- use the shared design tokens and primitives;
- expose explicit inputs/options and intentional DOM events;
- avoid fetching application data directly unless the component is explicitly a data component;
- avoid knowing which view contains them;
- represent visual states such as disabled, busy, selected, invalid, and destructive consistently.

The first shared components should likely be `Button`, `IconButton`, `FileRow`, `ProgressBar`, `EmptyState`, `ErrorState`, and `LoadingIndicator`. Do not build a giant component library in advance; extract a component when the pilot demonstrates that it is shared or when consistency requires a single owner.

## View rules

The file-manager view should:

- own the page layout and responsive structure;
- own the resource lifecycle: initial load, refresh, upload, delete, and retry;
- coordinate the components without leaking data-fetching concerns into them;
- render explicit loading, empty, error, and success states;
- provide stable DOM anchors for later navigation and automated tests;
- make its data dependencies and emitted user actions visible in one module.

The view should not become a single giant JS file. If it grows, split its state/data controller, rendering functions, and subviews while preserving the view boundary.

## Data and request plan

Create a small file resource module rather than calling `fetch` from each click handler:

- one API client handles credentials, JSON parsing, request IDs, abort signals, and consistent errors;
- `listFiles()` has a stable cache key and deduplicates concurrent requests;
- upload state is local and explicit, then invalidates or updates the file-list resource after success;
- delete is idempotent from the UI’s perspective and restores/refetches state on failure;
- user/session data is fetched once and shared with the view/components that need it;
- file URLs are treated as media resources with clear cache and authorization behavior;
- refresh behavior is explicit rather than triggered by every component mount.

Record the expected request graph for the page:

```text
initial load -> session/me + file list
upload       -> upload request -> list update or one list refetch
delete       -> delete request -> local removal or one list refetch
manual retry -> only the failed resource
```

If the actual API requires more calls, document why. The goal is predictable work, not an artificial zero-request target.

## CSS ownership for the pilot

- Global/foundation CSS: reset, tokens, typography, focus treatment, reduced motion, document background, and shared layer rules.
- Component CSS: button variants, rows, progress, empty/error/loading visuals, and component states.
- View CSS: file-manager layout, columns, spacing, responsive breakpoints, and view-level loading/list composition.

Avoid adding a file-manager selector to global CSS merely because it is convenient. Avoid putting button rules inside the file-manager view merely because the button first appears there.

## Validation

The pilot is complete when:

- the VPS page builds from the new beta entry point;
- HTML imports are inlined and CSS is emitted separately;
- the page works on direct load and reload with an authenticated session;
- list, upload, progress, delete, retry, empty, and error states work;
- no request storm occurs on mount, refresh, or repeated interactions;
- duplicate avatar/media requests are avoided where caching is expected;
- desktop and mobile layouts are usable;
- component and view boundaries are understandable to someone who did not write them;
- the old `www` site is unchanged;
- the next view can reuse the build, data, component, and testing patterns without copying the file-manager implementation.

## Deliberate non-goals

- Rebuilding every old page.
- Introducing React or a new UI framework.
- Converting all existing CSS in one pass.
- Making every component maximally generic.
- Solving the complete caching strategy for the whole site.
- Moving DNS or making the VPS canonical.
- Treating the old site’s DOM or standalone pages as the target.

## First implementation sequence

1. Identify the exact VPS file-management entry page and its current API calls.
2. Add the beta Rollup entry and prove `.html`/`.css` imports.
3. Build the global foundation and first primitives: `Button`, `LoadingIndicator`, `EmptyState`, and `ErrorState`.
4. Build `FileRow`, upload progress, and the file-manager view.
5. Move the existing list/upload/delete behavior behind `fileResource.js`.
6. Add request logging or a development request inspector for the expected request graph.
7. Test slow responses, failed upload, failed delete, session expiry, reload, empty list, and repeated retry.
8. Record what should become a shared pattern before starting the next view.
