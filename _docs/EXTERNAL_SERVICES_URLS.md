# External services: URLs you configure

Reminder of every **external service** where you set a **URL that points at your app**. When you change domain, move env, or add a new environment, update these.

---

## Subdomain setup (Cloudflare)

- **api** — **Passthrough (DNS only)**, not proxied. Use for all external callbacks (Stripe, QStash schedules, QStash job callbacks) so requests are not challenged by Cloudflare.
- **sh** — **Passthrough (DNS only)**, not proxied. Used for share links and link-unfurling bots.

Use the **api** subdomain for any URL you configure in Stripe or QStash below (e.g. `https://api.yourdomain.com`).

---

## 1. Stripe (webhooks)

**Where:** [Stripe Dashboard](https://dashboard.stripe.com/webhooks) → Developers → Webhooks → your endpoint → **Endpoint URL**

**URL you set:**  
`https://api.yourdomain.com/api/webhooks/stripe`

**Method:** POST  
**Auth:** Stripe signs the request; your app verifies with `STRIPE_WEBHOOK_SECRET` (Signing secret from the same Stripe webhook page).

**Why:** Stripe sends events (subscription created/updated/deleted, checkout completed, etc.) to this URL.

---

## 2. QStash Schedules (notifications cron)

**Where:** [Upstash QStash](https://console.upstash.com/) → Schedules. The schedule that triggers the notifications/digest cron.

**URL you set:**  
`https://api.yourdomain.com/api/worker/notifications`

**Method:** POST  
**Auth:** QStash signs the request (your app verifies with QStash signing keys). Optionally you can also use `CRON_SECRET` Bearer if the handler allows it.

**Why:** The cron runs digest emails, welcome emails, nudges, re-engagement, and creation highlights. Use the **api** subdomain so the request is passthrough and not proxied/challenged by Cloudflare.

---

## 3. QStash (job callbacks from publish)

**Where:** You don’t configure a URL in the Upstash dashboard. Your **app** tells QStash where to POST when it *publishes* a job (creation jobs, generic jobs). That callback base URL comes from your app’s API hostname (see `api_routes/utils/url.js` → `getQStashCallbackBaseUrl()`).

**URLs QStash will call (built by the app):**
- `https://<api-host>/api/worker/jobs` — generic jobs (e.g. embedding)
- `https://<api-host>/api/worker/create` — creation/landscape jobs

**What you need to do:** Ensure the app’s API hostname (e.g. in `url.js` or env) is the **api** subdomain (e.g. `api.yourdomain.com`) so these callbacks go to passthrough and don’t hit Cloudflare proxy/challenge.

---

## 4. Cloudflare

- **api** and **sh** are set to **passthrough (DNS only)**, not proxy — so external callbacks and unfurling bots reach your origin without challenge.
- **DNS:** When you change domain or host, update DNS for the api and sh subdomains so they still point at Vercel (or your host).

---

## Quick checklist when changing domain or environment

| Service                | What to update |
|------------------------|----------------|
| **Stripe**             | Webhook endpoint URL → `https://api.<domain>/api/webhooks/stripe` |
| **QStash Schedules**   | Notifications schedule destination URL → `https://api.<domain>/api/worker/notifications` |
| **QStash (publish)**   | No URL in dashboard; ensure app `url.js` / env uses `api.<domain>` so job callbacks use api subdomain |
| **Cloudflare**         | DNS for api and sh; keep api and sh as passthrough for callbacks and unfurling |
