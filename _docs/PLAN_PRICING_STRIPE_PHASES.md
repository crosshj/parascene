# Stripe Integration — What’s Left

Plan is stored in `users.meta.plan` (`'free' | 'founder'`). Checkout, webhook (`checkout.session.completed`), initial Founder credits, and storing `stripeSubscriptionId` are done.

---

## Tier definition

| Tier      | Price     | Benefits                                      |
|-----------|-----------|-----------------------------------------------|
| **Free**  | $0        | Default; daily claims; create/share/participate. |
| **Founder** | $12/month | 700 credits/month; priority support; permanent founder flair. |

(Adjust price/credits in copy and in Stripe as needed.)

---

## Remaining: Phase D — Switch to Free (cancel subscription)

**Goal:** When the user clicks “Switch to Free”, cancel the Stripe subscription and set plan back to free.

1. **Cancel on “Switch to Free”**
   - In **PUT /api/profile/plan** (`api_routes/user.js`): when the new plan is `'free'`, if the user has `users.meta.stripeSubscriptionId`, call Stripe to cancel that subscription (e.g. `stripe.subscriptions.cancel(subscriptionId)`), then set plan to `'free'` and clear `stripeSubscriptionId`. If there’s no subscription ID, just set plan to free (current behavior).

2. **Policy: credits and other edge cases when someone cancels**
   - Document how you’ll handle cases like: user subscribes, receives 700 credits, then cancels; or subscription ends due to payment failure; or they cancel mid-cycle.
   - Example decisions to record here:
     - **Credits already granted:** Keep them (no clawback). User keeps any credits they received for the current period.
     - **Refunds:** No refunds for unused time or credits (standard subscription terms).
     - **Access after cancel:** Plan flips to free immediately on “Switch to Free”; Founder flair and premium benefits stop. If you use “cancel at period end” in Stripe, decide whether plan stays founder until period end or switches to free immediately when they click.
   - Implement any logic that depends on this (e.g. if you ever do clawback, you’d need to reduce balance in the cancel path or in `customer.subscription.deleted`).

**Done when:** User can subscribe via Checkout, see Founder benefits, then use “Switch to Free” to cancel in Stripe and return to Free in the app.

---

## Optional: Webhook — `customer.subscription.deleted`

- **Goal:** When a subscription is canceled (from Stripe Dashboard, payment failure, or your app), keep the app in sync.
- **In** `api/webhooks/stripe.js`: handle event `customer.subscription.deleted`. Find the user with that `stripeSubscriptionId` (or look up by subscription id in Stripe then match to your user), set `plan = 'free'`, clear `stripeSubscriptionId`.
- **Stripe:** Add `customer.subscription.deleted` to the webhook destination’s event list in the Dashboard.

---

## Optional: Webhook — `invoice.paid` (monthly credits top-up)

- **Goal:** Grant 700 credits on each successful recurring charge (monthly), not only at checkout.
- **In** `api/webhooks/stripe.js`: handle event `invoice.paid`. Determine the user (e.g. from subscription → `client_reference_id` or stored mapping), then grant 700 credits (e.g. `updateUserCreditsBalance.run(userId, 700)`). Avoid double-granting the first invoice if you already granted at checkout (e.g. skip when invoice is the first for that subscription, or use `billing_reason` / idempotency).
- **Stripe:** Add `invoice.paid` to the webhook destination’s event list in the Dashboard.

---

## Summary checklist (remaining)

| Item | Status |
|------|--------|
| **Phase D** | Cancel subscription in Stripe when user clicks “Switch to Free” (in PUT /api/profile/plan) |
| **Optional** | Handle `customer.subscription.deleted` in webhook (set plan to free, clear subscription id) |
| **Optional** | Handle `invoice.paid` in webhook (grant 700 credits per recurring payment) |

**Files to touch:** `api_routes/user.js` (PUT /api/profile/plan — cancel via Stripe when switching to free). Optional: `api/webhooks/stripe.js` (add handlers for `customer.subscription.deleted`, `invoice.paid`).
