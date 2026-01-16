# Vercel Deployment Checklist

## 1) Replace local SQLite
- Vercel functions do not persist local files between invocations.
- Move to a hosted DB (Postgres, MySQL, or remote SQLite/libsql).
- Update `db/index.js` to use the new client/driver and connection URL.
- Add env vars (e.g., `DATABASE_URL`) in Vercel project settings.

## 2) Seed data (optional)
- For demo accounts, add a one-time seed script that runs against the hosted DB.
- Run it locally or via a Vercel deploy hook.

## 3) Deploy
- Import the repo in Vercel.
- Set env vars (DB + session).
- Deploy and verify routes.
