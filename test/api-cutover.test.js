import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { once } from "node:events";
import { getCreditTopupPack } from "../server/services/billing/creditPacks.js";
import { resolveInvoiceSubscriptionId, verifyStripeSignature } from "../server/services/billing/stripeBilling.js";
import { buildEmbeddingText } from "../server/services/create/embeddingJob.js";
import { createBillingRoutes } from "../server/routes/billing.js";

test("credit packs stay on the server", () => {
	assert.equal(getCreditTopupPack("300").credits, 300);
	assert.equal(getCreditTopupPack("nope"), null);
});

test("invoice subscription id walks the newer Stripe shapes", () => {
	assert.equal(resolveInvoiceSubscriptionId({ subscription: "sub_top" }), "sub_top");
	assert.equal(resolveInvoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_parent" } } }), "sub_parent");
	assert.equal(resolveInvoiceSubscriptionId({ lines: { data: [{ parent: { subscription_item_details: { subscription: "sub_line" } } }] } }), "sub_line");
	assert.equal(resolveInvoiceSubscriptionId({}), null);
});

test("stripe signature accepts the current v1 header and rejects a stale one", () => {
	const secret = "whsec_test";
	const body = Buffer.from('{"id":"evt_1"}');
	const timestamp = Math.floor(Date.now() / 1000);
	const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
	assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret), true);
	assert.equal(verifyStripeSignature(body, `t=${timestamp - 1000},v1=${signature}`, secret), false);
});

test("embedding text keeps missing creation fields explicit", () => {
	assert.equal(buildEmbeddingText({ title: "Night", prompt: "moon" }), "Title: Night Description: (none) Prompt: moon");
});

test("stripe webhook reads the raw body ahead of json parsing", async () => {
	process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
	const app = express();
	app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }));
	app.use("/api", express.json());
	app.use(createBillingRoutes({
		client: {},
		credits: { get: async () => ({}) },
		adjust: async () => {}
	}));
	const server = app.listen(0);
	await once(server, "listening");
	const port = server.address().port;
	const body = '{"id":"evt_unused","type":"unknown.event"}';
	const timestamp = Math.floor(Date.now() / 1000);
	const signature = crypto.createHmac("sha256", "whsec_test").update(`${timestamp}.${body}`).digest("hex");
	const response = await fetch(`http://127.0.0.1:${port}/api/webhooks/stripe`, {
		method: "POST",
		headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` },
		body
	});
	const payload = await response.json();
	server.close();
	assert.equal(response.status, 200);
	assert.equal(payload.received, true);
});
