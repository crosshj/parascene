# Local finance ledger

This is a local-only finance page. It stores one JSON ledger in the existing
notes-to-self DM; it does not add tables or production routes.

Set one of these in `.env`:

```text
FINANCE_USER_ID=123
# or
FINANCE_EMAIL=you@example.com
# or
FINANCE_USERNAME=awesome
```

Then run:

```bash
node scripts/finance/server.js
```

Open <http://127.0.0.1:2391>. The server requires `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`, and creates a local JSON backup before each save.

The initial recurring list includes clearly marked estimates for services
referenced by the app: Supabase, Vercel, Upstash Redis/QStash, Resend, and a
domain. Replicate is represented in the notes as an irregular cost; enter
actual top-ups as transactions. Stripe revenue and fees are left for actual
figures because the repository contains price identifiers but not the prices.
Stripe processing is intentionally not tracked separately; record Stripe
receipts as income transactions.
