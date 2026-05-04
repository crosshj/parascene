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

## Other routes (`api_routes/pages.js`)

/s/:version/:token/:bust?
/welcome
/user
/user/:id
/p/:personality
/t/:tag
/styles/new
/styles/:slug
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
/auth
/*

Note: `src/`-only pattern applies to bundled code (chat: `src/chat/main.js` → `public/build/chat.bundle.js` + `chat.bundle.css`; shared UI web components in `src/shared/components/`; other deps in `src/shared/`, `src/chat/`). Unbundled routes stay on `public/`. Other routes listed here may need case-by-case handling (entry module, server-rendered HTML, service worker) when/if they move behind a `src/` bundle.
