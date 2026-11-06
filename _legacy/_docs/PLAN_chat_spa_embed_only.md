# Plan: Chat SPA is the only shell for nested pages

Goal: nested routes live only inside the chat SPA overlay. Standalone full pages for those routes go away. Inner pages stay as on-demand chunks, slimmed for embed.

Current overlay kinds (`spaPageOverlay.js`): create, creation detail, mutate/edit, profile, style, audio clip, prompt library, integrations. Same rule for any later nested route (party, etc.).

Not in scope: landing, auth, share (`/s/…`), blog, help, pricing, try, and other pages that are not nested in chat.

## Phase 1 — Serve chat SPA for nested URLs

User-facing `/create`, `/creations/:id`, `/creations/:id/mutate`, `/user…`, `/styles/…`, `/audio-clips/…`, `/prompt-library`, `/integrations` always get `chat.html`. Chat then opens the overlay for that path.

Iframe still loads the same path with `?embed=1` (or equivalent). That request must keep serving the inner page, never chat.html.

Refresh / bookmark / paste of a nested URL: chat shell + overlay restored from the address bar. Same history model as today (parent owns history).

Done when:

- Direct hit of a nested URL (no `embed=1`) never renders the old standalone chrome.
- `?embed=1` still returns the inner HTML for the overlay iframe.
- Back / forward / close overlay still returns to the chat lane.
- Logged-out / share / SEO pages that must stay standalone are listed and exempt.

## Phase 2 — Embed-only inner builds

Inner pages currently dual-path through `entry.js` + `entry-*.js` (standalone nav/modals vs embed). After phase 1, standalone is dead; drop that path.

Each nested page gets an embed-only entry: no `app-navigation`, mobile nav, or shell modals the parent already has. Keep page-specific UI (publish, share, tabs, etc.).

Server already strips chrome for embed (`stripStandaloneAppChromeForEmbed`). Align HTML, body flags, and JS so they only assume overlay.

Done when:

- Embed entries do not import standalone chrome.
- Overlay open is fast enough that we are not paying for unused app shell.
- `check:workflow-embed` (or successor) still forbids iframe reloads / same-origin `location` hops.

## Phase 3 — Keep as chunks; fold in only if needed

Do not pull inner page code into the chat bundle by default. Overlay load is already a natural split: chat shell first, then one page chunk in the iframe.

Fold into the chat build only if a page is tiny, always-hot, or the iframe tax is worse than the extra JS. Default is leave them as logical on-demand chunks.

Done when:

- Nested pages work well embed-only.
- Chat bundle does not grow “just in case.”
- Any inlining is a measured exception, not the plan.

## Order

```
phase 1  route serving (chat shell + embed=1 inner)
phase 2  slim embed-only entries (drop standalone)
phase 3  optional inlining — skip unless a page proves it
```

Phase 1 before 2 so we can delete standalone without a dual-serve window. Phase 3 last and optional.
