# Local finance ledger

The local app serves this page at `/finance/` (for example
`http://localhost:3000/finance/`). It is mounted like Reports: development
only, and only for a loopback client. `npm run dev` sets
`LOCAL_FINANCE_ENABLED=1`, which also enables the route when `NODE_ENV` is
`production`. Deployments leave it unmounted.

The page stores one JSON ledger in the notes-to-self DM for user 219. It does not add
tables.

The server requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and writes
a local JSON backup before each save.

A standalone loopback server is still available:

```bash
node scripts/finance/server.js
```

Open <http://127.0.0.1:2391>.

The initial recurring list includes clearly marked estimates for services
referenced by the app: Supabase, Vercel, Upstash Redis/QStash, Resend, and a
domain. Replicate is represented in the notes as an irregular cost; enter
actual top-ups as transactions. Stripe revenue and fees are left for actual
figures because the repository contains price identifiers but not the prices.
Stripe processing is intentionally not tracked separately; record Stripe
receipts as income transactions.
