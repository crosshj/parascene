# Stripe Integration Plan

This doc is the single source for adding real subscription payments. Plan is stored in `users.meta.plan` (`'free' | 'founder'`). Founder flair and pricing UI are already driven by that field.

---

## Already in place

- **Plan in API:** GET /api/profile returns `plan`; PUT /api/profile/plan updates `users.meta.plan` (used for “Switch to Free”).
- **Pricing page:** `/pricing` from `pages/pricing.html`; two tiers (Free, Founder); “Current plan” and “Switch to Free” work; “Unlock Founder” exists but has no payment yet.
- **Checkout stub:** POST /api/subscription/checkout returns 503 with `STRIPE_NOT_CONFIGURED`; replace with real Stripe Checkout in the steps below.

---

## Tier definition

| Tier    | Price     | Benefits                                      |
|---------|-----------|-----------------------------------------------|
| **Free**   | $0        | Default; daily claims; create/share/participate. |
| **Founder**| $12/month | 700 credits/month; priority support; permanent founder flair. |

(Adjust price/credits in copy and in Stripe as needed.)

---

## Phase A: Stripe account and product

**Goal:** Have a Stripe Price ID for Founder so the app can create checkout sessions.

1. **Stripe account**
   - Sign up at [stripe.com](https://stripe.com). Use **Test mode** (toggle in Dashboard) until you’re ready to go live.

2. **Create Founder product and price**
   - In Stripe Dashboard: **Products** → **Add product**.
   - Name: e.g. **Founder**.
   - Add a **recurring** price: monthly, amount per your tier (e.g. $12).
   - Save. Copy the **Price ID** (e.g. `price_xxxxx`). You’ll use it as `STRIPE_PRICE_ID_FOUNDER`.

3. **Get API keys**
   - **Developers** → **API keys**.
   - Copy **Secret key** (starts with `sk_test_` in test mode). This is `STRIPE_SECRET_KEY`.

4. **Env vars**
   - In `.env` (and your deployment env), add:
     - `STRIPE_SECRET_KEY=sk_test_...` (or `sk_live_...` when live).
     - `STRIPE_PRICE_ID_FOUNDER=price_...`
   - Do **not** commit real keys. Document required vars in this file or a README.

**Done when:** You have `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID_FOUNDER` set and the Node app can read them.

---

## Phase B: Checkout (user pays and returns to your app)

**Goal:** “Unlock Founder” starts a Stripe Checkout session and redirects the user to Stripe; after payment they return to your success URL.

1. **Install Stripe SDK**
   - `npm install stripe` (or `yarn add stripe`).
   - Use the server-side SDK only (no Stripe.js on frontend required for Checkout).

2. **Implement POST /api/subscription/checkout**
   - **File:** `api_routes/user.js` (or a small `api_routes/stripe.js` if you prefer).
   - Require auth; reject if no `req.auth.userId`.
   - Read `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID_FOUNDER` from env. If missing, return 503 (e.g. same `STRIPE_NOT_CONFIGURED` body as now).
   - Create a Stripe **Checkout Session** (subscription mode):
     - `mode: 'subscription'`
     - `line_items: [{ price: process.env.STRIPE_PRICE_ID_FOUNDER, quantity: 1 }]`
     - `client_reference_id: String(req.auth.userId)` so the webhook knows which user subscribed.
     - `success_url`: your base URL + e.g. `/pricing?success=1` or `/pricing?session_id={CHECKOUT_SESSION_ID}` (Stripe replaces the placeholder).
     - `cancel_url`: e.g. `/pricing?canceled=1`
     - `customer_email`: optional; you can pass the user’s email from your DB so Stripe pre-fills it.
   - Return JSON `{ url: session.url }` so the frontend can redirect with `window.location.href = data.url`.

3. **Wire the pricing page**
   - **File:** `pages/pricing.html` (script section).
   - On “Unlock Founder” button click (when signed in and plan is free): call POST /api/subscription/checkout with credentials. If response is 200 and `data.url`, set `window.location.href = data.url`. Otherwise show an error (e.g. alert or inline message).

**Done when:** Clicking “Unlock Founder” sends the user to Stripe Checkout; after paying (test card `4242...`) they land back on your success URL. Plan is not updated yet—that’s Phase C.

---

## Phase C: Webhook (set plan and grant benefits)

**Goal:** When Stripe confirms payment, your server sets `plan = 'founder'` and grants credits (if desired).

1. **Webhook endpoint**
   - **Route:** e.g. POST /api/webhooks/stripe (or /api/stripe/webhook). Must be a raw body route (Stripe signs the payload).
   - In Express: use `express.raw({ type: 'application/json' })` for this route only so `req.body` is the raw buffer (needed for signature verification).
   - Get **Webhook signing secret** from Stripe Dashboard: **Developers** → **Webhooks** → **Add endpoint** → URL = `https://your-domain.com/api/webhooks/stripe` → select events (see step 2) → copy **Signing secret** (`whsec_...`). Set as `STRIPE_WEBHOOK_SECRET` in env.

2. **Verify signature and parse event**
   - Use `stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)`. If verification fails, return 400.
   - Handle at least:
     - `checkout.session.completed`: subscription created at checkout. Read `client_reference_id` (userId), set `user.meta.plan = 'founder'` via your existing `updateUserPlan.run(userId, 'founder')`. Optionally grant initial credits (e.g. 700) via `updateUserCreditsBalance` or your credits API.
     - `invoice.paid`: recurring payment succeeded. Optional: grant 700 credits each time (if you do monthly credits top-up here instead of only at checkout).

3. **Idempotency**
   - Use the Stripe event `id` or the session `id` to avoid applying the same event twice (e.g. store processed event IDs in a small table or in memory for dev).

**Done when:** After completing Checkout, the user returns to your app and their profile shows Founder (plan updated by webhook). Founder flair and “Current plan” on /pricing reflect it.

---

## Phase D: Switch to Free (cancel subscription)

**Goal:** “Switch to Free” cancels the Stripe subscription and sets plan back to free.

1. **Store Stripe subscription ID**
   - When handling `checkout.session.completed`, you have access to `session.subscription` (subscription ID). Store it (e.g. in `users.meta.stripeSubscriptionId` or a small `subscriptions` table) keyed by userId so you can cancel later.

2. **Cancel on “Switch to Free”**
   - In PUT /api/profile/plan: when the new plan is `'free'`, if the user has a stored subscription ID, call Stripe to cancel that subscription (e.g. `stripe.subscriptions.cancel(subscriptionId)`), then set `user.meta.plan = 'free'` and clear the stored subscription ID. If there’s no subscription ID, just set plan to free (current behavior).

3. **Optional: webhook for canceled subscription**
   - Handle `customer.subscription.deleted`. If the subscription was canceled from Stripe Dashboard or after failure, set that user’s plan back to `'free'` and clear the stored ID so your app stays in sync.

**Done when:** User can subscribe via Checkout, see Founder benefits, then use “Switch to Free” to cancel and return to Free.

---

## Summary checklist

| Phase | What to do |
|-------|------------|
| **A** | Stripe account; Founder product/price; env: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_FOUNDER` |
| **B** | Install `stripe`; implement POST /api/subscription/checkout; pricing page “Unlock Founder” → redirect to Stripe |
| **C** | POST /api/webhooks/stripe; verify signature; handle `checkout.session.completed` (set plan + optional credits); env: `STRIPE_WEBHOOK_SECRET` |
| **D** | Store subscription ID; “Switch to Free” cancels in Stripe and sets plan to free; optional `customer.subscription.deleted` handler |

**Files to add/touch:** `.env` (vars), `api_routes/user.js` or `api_routes/stripe.js` (checkout + webhook), `pages/pricing.html` (button → checkout), and optionally DB/meta for `stripeSubscriptionId`. No change to founder flair or plan display logic—they already use `plan` from profile.
