import express from "express";
import {
	cancelSubscription,
	checkoutReturnBaseUrl,
	createCheckoutSession,
	handleStripeEvent,
	recordCheckoutReturn,
	setPlan,
	topupPrice,
	verifyStripeSignature
} from "../services/billing/stripeBilling.js";

async function userEmail(client, userId) {
	const { data, error } = await client.from("prsn_users").select("email").eq("id", userId).maybeSingle();
	if (error) throw error;
	const email = typeof data?.email === "string" ? data.email.trim() : "";
	return email.includes("@") ? email : undefined;
}

export function createBillingRoutes({ client, credits, adjust }) {
	const router = express.Router();

	router.post("/api/credits/checkout", async (req, res) => {
		if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
		const { pack, priceId } = topupPrice(req.body?.pack);
		if (!pack) return res.status(400).json({ error: "Invalid pack", message: "Choose a credit pack." });
		if (!process.env.STRIPE_SECRET_KEY || !priceId) {
			return res.status(503).json({ error: "STRIPE_NOT_CONFIGURED", message: "Credit checkout is not set up yet." });
		}
		try {
			const base = checkoutReturnBaseUrl(req);
			const session = await createCheckoutSession({
				secret: process.env.STRIPE_SECRET_KEY,
				mode: "payment",
				priceId,
				userId: req.auth.userId,
				email: await userEmail(client, req.auth.userId),
				successUrl: `${base}/pricing?topup=1&session_id={CHECKOUT_SESSION_ID}`,
				cancelUrl: `${base}/pricing?canceled=1`,
				metadata: { type: "credit_topup", pack: pack.id }
			});
			return res.json({ url: session.url });
		} catch (error) {
			console.error("[POST /api/credits/checkout]", error);
			return res.status(500).json({ error: "Checkout failed", message: error.message || "Could not start checkout." });
		}
	});

	router.post("/api/subscription/checkout", async (req, res) => {
		if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
		const priceId = String(process.env.STRIPE_PRICE_ID_FOUNDER || "").trim();
		if (!process.env.STRIPE_SECRET_KEY || !priceId) {
			return res.status(503).json({ error: "STRIPE_NOT_CONFIGURED", message: "Subscription checkout is not set up yet." });
		}
		try {
			const base = checkoutReturnBaseUrl(req);
			const session = await createCheckoutSession({
				secret: process.env.STRIPE_SECRET_KEY,
				mode: "subscription",
				priceId,
				userId: req.auth.userId,
				email: await userEmail(client, req.auth.userId),
				successUrl: `${base}/pricing?success=1&session_id={CHECKOUT_SESSION_ID}`,
				cancelUrl: `${base}/pricing?canceled=1`
			});
			return res.json({ url: session.url });
		} catch (error) {
			console.error("[POST /api/subscription/checkout]", error);
			return res.status(500).json({ error: "Checkout failed", message: error.message || "Could not start checkout." });
		}
	});

	router.post("/api/subscription/checkout-return", async (req, res) => {
		if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
		const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
		if (!sessionId.startsWith("cs_")) {
			return res.status(400).json({ error: "Invalid sessionId", message: "sessionId is required and must be a Stripe checkout session id." });
		}
		try {
			await recordCheckoutReturn(client, req.auth.userId, sessionId);
			return res.json({ ok: true });
		} catch (error) {
			console.error("[POST /api/subscription/checkout-return]", error);
			return res.status(500).json({ error: "Failed to record", message: error.message || "Could not record checkout return." });
		}
	});

	router.put("/api/profile/plan", async (req, res) => {
		if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized", message: "You must be signed in to change your plan." });
		const plan = req.body?.plan;
		if (plan !== "free" && plan !== "founder") {
			return res.status(400).json({ error: "Invalid plan", message: "plan must be 'free' or 'founder'" });
		}
		try {
			const result = await setPlan(client, req.auth.userId, plan);
			if (!result) return res.status(404).json({ error: "User not found" });
			if (plan === "free" && result.subscriptionId) {
				try {
					await cancelSubscription(result.subscriptionId);
				} catch (error) {
					console.error("[PUT /api/profile/plan] Stripe cancel failed", error?.message || error);
					return res.status(502).json({ error: "Cancel failed", message: "Could not cancel subscription. Please try again or contact support." });
				}
			}
			return res.json({ ok: true, plan: result.plan });
		} catch (error) {
			console.error("[PUT /api/profile/plan]", error);
			return res.status(500).json({ error: "Update failed", message: error.message || "Could not update plan." });
		}
	});

	router.post("/api/webhooks/stripe", async (req, res) => {
		const secret = process.env.STRIPE_WEBHOOK_SECRET;
		if (!secret) return res.status(503).json({ error: "Stripe webhook is not configured" });
		const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : "");
		if (!verifyStripeSignature(raw, req.get("stripe-signature"), secret)) {
			return res.status(400).json({ error: "Invalid Stripe signature" });
		}
		let event;
		try {
			event = JSON.parse(raw.toString("utf8"));
		} catch {
			return res.status(400).json({ error: "Invalid Stripe payload" });
		}
		try {
			await handleStripeEvent({ client, credits, adjust, event });
			return res.json({ received: true });
		} catch (error) {
			console.error("[POST /api/webhooks/stripe]", error);
			return res.status(500).json({ error: "Webhook handler failed" });
		}
	});

	return router;
}
