# parascene

## dev server (express)

```sh
npm install --include=dev
npm run dev
```

Open `http://localhost:3000/` to reach the app (routes are served only
from `/`).

Pages are served from `pages/`. Static assets are served from `public/`
(including `global.css`).

## local db + auth

- Database: Supabase (set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in `.env`)
- Auth routes: `POST /signup`, `POST /login`, `POST /logout`
- Session check: `GET /me`

To wipe and re-seed a **dev** Supabase project (destructive; not an npm script):

1. In `.env`: `ALLOW_DB_RESET=true` and `RESET_SUPABASE_PROJECT_REF` = project ref from Supabase → Settings → General (must match `SUPABASE_URL`).
2. Run: `node db/reset.js`

Seeded accounts after reset:

- `consumer@example.com` / `p123@#`
- `creator@example.com` / `p123@#`
- `provider@example.com` / `p123@#`
- `admin@example.com` / `p123@#`