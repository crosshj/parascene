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
/try
/auth
/*
