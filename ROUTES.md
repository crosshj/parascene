# Routes

## Chat page (`pages/chat.html`)

Served to logged-in users whose role is not `admin`. (`/` and `/index.html` use the landing page when logged out; admins get `app-admin.html` for the paths below.)

/
/index.html
/feed
/feed/
/explore
/explore/
/creations
/creations/
/challenges
/challenges/
/chat
/chat/
/chat/*

Fullscreen vertical feed videos (mobile doom scroll from `#feed` video cards): `/chat/c/feed/doom/:creationId` (numeric creation id).

## Other routes (`api_routes/pages.js`)

/s/:version/:token/:bust?
/welcome
/user
/user/:id
/p/:personality
/t/:tag
/styles/new
/styles/:slug
/audio-clips/:id
/create
/prompt-library
/create/blog/:id
/creations/:id/mutate
/creations/:id/edit
/creations/:id
/auth.html
/pricing
/pricing.html
/integrations
/try
/party
/auth
/*

Note: `src/`-only pattern applies to bundled code (chat: `src/chat/main.js` → `public/build/chat.bundle.js` + `chat.bundle.css`; shared UI web components in `src/shared/components/`; other deps in `src/shared/`, `src/chat/`). Unbundled routes stay on `public/`. Other routes listed here may need case-by-case handling (entry module, server-rendered HTML, service worker) when/if they move behind a `src/` bundle.

## SPA page overlay (embed)

On feed, explore, creations, challenges, and chat shells, these routes open in a full-viewport iframe overlay (`spaPageOverlay.js`) when navigated from the lane (not on direct URL load):

- `/prompt-library` (+ hash tabs)
- `/p/:handle`, `/user`, `/user/:id` (profiles)
- `/styles/:slug`, `/styles/new`
- `/audio-clips/:id`
- `/creations/:id`, `/creations/:id/edit`, `/creations/:id/mutate`
- `/create`
- `/integrations` (Connections)

Iframe pages use `?embed=1` (stripped nav, embed body class). Back navigates the overlay stack; Escape / close dismisses to the lane. Shell-out (full navigation) remains for `/chat/*`, `/auth`, `/pricing`, and off-origin links.

Manual back-stack checks:

- Prompt library → persona / style / audio clip → back
- Creation detail → creator profile → back
- Creation detail → `$style` in description → style → back
- Chat DM header profile → overlay (lane stays on DM)
- Account menu View Profile → overlay
- Feed card avatar (`data-profile-link`) → overlay
- Chat `@mention` / `$style` → overlay
- Audio clip hub → creation → creation detail in-overlay
- Style save → `/styles/{tag}` in-overlay
- Direct URL (no overlay history) → standalone full page
- Escape / X dismisses stack; lane scroll restored
