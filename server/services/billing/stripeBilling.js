import crypto from "node:crypto";
import { createChallengeQueries } from "../../db/challenges.js";
import { sendTemplatedEmail } from "../../email/index.js";
import { getBaseAppUrl } from "../create/url.js";
import { getCreditTopupPack, getCreditTopupPriceId } from "./creditPacks.js";

export const FOUNDER_CREDITS_GRANT = 700;
const ADMIN_OPS_EMAIL = "parascene.admin@crosshj.com";
const processedEventIds = new Set();

function metaOf(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

async function readUser(client, userId) {
	const { data, error } = await client.from("prsn_users").select("id,email,role,created_at,meta").eq("id", userId).maybeSingle();
	if (error) throw error;
	return data || null;
}

async function writeMeta(client, userId, meta) {
	const { error } = await client.from("prsn_users").update({ meta }).eq("id", userId);
	if (error) throw error;
}

async function patchMeta(client, userId, change) {
	const user = await readUser(client, userId);
	if (!user) return null;
	const meta = change(metaOf(user.meta));
	await writeMeta(client, userId, meta);
	return { ...user, meta };
}

function claimId(meta, key, id, max) {
	const list = Array.isArray(meta[key]) ? meta[key].map(String) : [];
	if (list.includes(id)) return { meta, granted: false };
	meta[key] = [...list, id].slice(-max);
	return { meta, granted: true };
}

export function checkoutReturnBaseUrl(req) {
	const origin = typeof req?.get === "function" ? req.get("origin") : req?.headers?.origin;
	if (origin === "https://www.parascene.com" || origin === "https://beta.parascene.com") return origin;
	return getBaseAppUrl();
}

export function resolveInvoiceSubscriptionId(invoice) {
	if (!invoice || typeof invoice !== "object") return null;
	const take = (value) => {
		if (typeof value === "string" && value.trim()) return value.trim();
		if (value && typeof value === "object" && typeof value.id === "string" && value.id.trim()) return value.id.trim();
		return null;
	};
	const top = take(invoice.subscription);
	if (top) return top;
	const parent = take(invoice.parent?.subscription_details?.subscription);
	if (parent) return parent;
	for (const line of Array.isArray(invoice.lines?.data) ? invoice.lines.data : []) {
		const legacy = take(line?.subscription);
		if (legacy) return legacy;
		const nested = take(line?.parent?.subscription_item_details?.subscription || line?.parent?.subscription_details?.subscription);
		if (nested) return nested;
	}
	return null;
}

export function verifyStripeSignature(rawBody, header, secret, now = Date.now()) {
	const text = String(header || "");
	const timestamp = text.split(",").map((part) => part.split("=")).find(([key]) => key === "t")?.[1];
	const signatures = text.split(",").filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
	if (!timestamp || !signatures.length || !secret) return false;
	const age = Math.abs(now / 1000 - Number(timestamp));
	if (!Number.isFinite(age) || age > 300) return false;
	const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
	const expectedBuf = Buffer.from(expected);
	return signatures.some((signature) => {
		const actual = Buffer.from(signature);
		return actual.length === expectedBuf.length && crypto.timingSafeEqual(actual, expectedBuf);
	});
}

async function stripeRequest(secret, method, path, params) {
	const body = new URLSearchParams();
	for (const [key, value] of Object.entries(params || {})) {
		if (value != null && value !== "") body.set(key, String(value));
	}
	const response = await fetch(`https://api.stripe.com/v1${path}`, {
		method,
		headers: { Authorization: `Bearer ${secret}` },
		body: method === "GET" ? undefined : body
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data?.error?.message || "Stripe request failed");
	return data;
}

export async function createCheckoutSession({ secret, mode, priceId, userId, email, successUrl, cancelUrl, metadata }) {
	const params = {
		mode,
		"line_items[0][price]": priceId,
		"line_items[0][quantity]": 1,
		client_reference_id: String(userId),
		success_url: successUrl,
		cancel_url: cancelUrl
	};
	if (email) params.customer_email = email;
	for (const [key, value] of Object.entries(metadata || {})) params[`metadata[${key}]`] = value;
	return stripeRequest(secret, "POST", "/checkout/sessions", params);
}

async function grantCredits(credits, adjust, userId, amount) {
	await credits.get(userId);
	await adjust(userId, amount);
}

async function notifyPurchase(client, { userId, kind, credits, meta }) {
	const amount = Math.round(Number(credits) || 0);
	const copy = kind === "founder"
		? { title: "Welcome to Founder", message: `You're a Founder. ${amount} credits have been added to your account.`, template: "founderWelcome" }
		: kind === "founder_renewal"
			? { title: "Credits added", message: `Your ${amount} monthly Founder credits have been added.`, template: "founderRenewal" }
			: { title: "Credits added", message: `You received ${amount} credits.`, template: "creditTopup" };
	try {
		await createChallengeQueries(client).insertNotification.run(userId, null, copy.title, copy.message, "/pricing", null, "credits", null, { kind, credits: amount, ...(meta || {}) });
	} catch (error) {
		console.error("[stripe] purchase notification failed", error?.message || error);
	}
	if (!process.env.RESEND_API_KEY || !process.env.RESEND_SYSTEM_EMAIL) return;
	try {
		const user = await readUser(client, userId);
		const email = String(user?.email || "").trim();
		if (!email.includes("@")) return;
		const settings = await client.from("prsn_policy_knobs").select("key,value").in("key", ["email_dry_run", "email_use_test_recipient"]);
		const values = new Map((settings.data || []).map((row) => [row.key, String(row.value || "").toLowerCase()]));
		if (values.get("email_dry_run") === "true") return;
		const to = values.get("email_use_test_recipient") === "true" ? "delivered@resend.dev" : email;
		const name = email.split("@")[0] || "there";
		await sendTemplatedEmail({ to, template: copy.template, data: { recipientName: name, credits: amount } });
	} catch (error) {
		console.error("[stripe] purchase email failed", error?.message || error);
	}
}

async function userBySubscription(client, subscriptionId) {
	const { data, error } = await client.from("prsn_users").select("id,email,meta").contains("meta", { stripeSubscriptionId: subscriptionId }).maybeSingle();
	if (error) throw error;
	return data || null;
}

async function claimOnce(client, userId, key, id, max) {
	const current = await readUser(client, userId);
	if (!current) return false;
	const list = Array.isArray(current.meta?.[key]) ? current.meta[key].map(String) : [];
	if (list.includes(id)) return false;
	await patchMeta(client, userId, (meta) => claimId(meta, key, id, max).meta);
	return true;
}

async function releaseClaim(client, userId, key, id) {
	await patchMeta(client, userId, (meta) => {
		const list = Array.isArray(meta[key]) ? meta[key].map(String).filter((item) => item !== id) : [];
		if (list.length) meta[key] = list;
		else delete meta[key];
		return meta;
	});
}

export async function handleStripeEvent({ client, credits, adjust, event }) {
	if (processedEventIds.has(event.id)) return;
	if (event.type === "checkout.session.completed") {
		const session = event.data?.object || {};
		const userId = String(session.client_reference_id || "").trim();
		const sessionId = String(session.id || "").trim();
		if (session.mode === "payment" || session.metadata?.type === "credit_topup") {
			const pack = getCreditTopupPack(session.metadata?.pack);
			if (!userId || !pack || !sessionId) return;
			if (session.payment_status && session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return;
			if (!(await claimOnce(client, userId, "grantedStripeCheckoutSessionIds", sessionId, 40))) return;
			try {
				await grantCredits(credits, adjust, userId, pack.credits);
				await notifyPurchase(client, { userId, kind: "topup", credits: pack.credits });
			} catch (error) {
				await releaseClaim(client, userId, "grantedStripeCheckoutSessionIds", sessionId);
				throw error;
			}
			processedEventIds.add(event.id);
			return;
		}
		if (!userId) return;
		const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
		await patchMeta(client, userId, (meta) => {
			meta.plan = "founder";
			delete meta.pendingCheckoutSessionId;
			delete meta.pendingCheckoutReturnedAt;
			if (subscriptionId) meta.stripeSubscriptionId = subscriptionId;
			return meta;
		});
		const shouldGrant = !sessionId || await claimOnce(client, userId, "grantedStripeCheckoutSessionIds", sessionId, 40);
		if (shouldGrant) {
			try {
				await grantCredits(credits, adjust, userId, FOUNDER_CREDITS_GRANT);
				await notifyPurchase(client, { userId, kind: "founder", credits: FOUNDER_CREDITS_GRANT });
			} catch (error) {
				if (sessionId) await releaseClaim(client, userId, "grantedStripeCheckoutSessionIds", sessionId);
				throw error;
			}
		}
		processedEventIds.add(event.id);
		return;
	}
	if (event.type === "customer.subscription.deleted") {
		const subscriptionId = event.data?.object?.id;
		if (!subscriptionId) return;
		const user = await userBySubscription(client, subscriptionId);
		if (!user) return;
		await patchMeta(client, user.id, (meta) => {
			meta.plan = "free";
			delete meta.stripeSubscriptionId;
			return meta;
		});
		processedEventIds.add(event.id);
		return;
	}
	if (event.type === "invoice.paid") {
		const invoice = event.data?.object || {};
		if (invoice.billing_reason !== "subscription_cycle") return;
		const invoiceId = typeof invoice.id === "string" ? invoice.id : "";
		const subscriptionId = resolveInvoiceSubscriptionId(invoice);
		if (!subscriptionId) return;
		const user = await userBySubscription(client, subscriptionId);
		if (!user) {
			await notifyAdminRenewal({ status: "failed", reason: `No user found for subscription ${subscriptionId}`, invoiceId, subscriptionId, eventId: event.id });
			return;
		}
		if (invoiceId && !(await claimOnce(client, user.id, "grantedStripeInvoiceIds", invoiceId, 48))) {
			processedEventIds.add(event.id);
			return;
		}
		try {
			await grantCredits(credits, adjust, user.id, FOUNDER_CREDITS_GRANT);
			await notifyPurchase(client, { userId: user.id, kind: "founder_renewal", credits: FOUNDER_CREDITS_GRANT, meta: { stripe_invoice_id: invoiceId || null, stripe_subscription_id: subscriptionId } });
			await notifyAdminRenewal({ status: "success", userId: user.id, userEmail: user.email || "", invoiceId, subscriptionId, eventId: event.id, credits: FOUNDER_CREDITS_GRANT });
			processedEventIds.add(event.id);
		} catch (error) {
			if (invoiceId) await releaseClaim(client, user.id, "grantedStripeInvoiceIds", invoiceId);
			await notifyAdminRenewal({ status: "failed", reason: error?.message || "grant failed", userId: user.id, invoiceId, subscriptionId, eventId: event.id });
			throw error;
		}
	}
}

async function notifyAdminRenewal(payload) {
	if (!process.env.RESEND_API_KEY || !process.env.RESEND_SYSTEM_EMAIL) return;
	try {
		await sendTemplatedEmail({
			to: ADMIN_OPS_EMAIL,
			template: "founderRenewalAdmin",
			data: {
				status: payload.status === "success" ? "success" : "failed",
				reason: payload.reason || "",
				userId: payload.userId ?? null,
				userEmail: payload.userEmail || "",
				subscriptionId: payload.subscriptionId || "",
				invoiceId: payload.invoiceId || "",
				credits: payload.credits || FOUNDER_CREDITS_GRANT,
				eventId: payload.eventId || ""
			}
		});
	} catch (error) {
		console.error("[stripe] admin renewal mail failed", error?.message || error);
	}
}

export async function recordCheckoutReturn(client, userId, sessionId) {
	await patchMeta(client, userId, (meta) => {
		meta.pendingCheckoutSessionId = sessionId;
		meta.pendingCheckoutReturnedAt = new Date().toISOString();
		return meta;
	});
}

export async function setPlan(client, userId, plan) {
	const user = await readUser(client, userId);
	if (!user) return null;
	let subscriptionId = null;
	const raw = user.meta?.stripeSubscriptionId;
	if (plan === "free") {
		if (typeof raw === "string" && raw.startsWith("sub_")) subscriptionId = raw;
		else if (raw && typeof raw.id === "string" && raw.id.startsWith("sub_")) subscriptionId = raw.id;
	}
	await patchMeta(client, userId, (meta) => {
		meta.plan = plan === "founder" ? "founder" : "free";
		if (plan === "founder") {
			delete meta.pendingCheckoutSessionId;
			delete meta.pendingCheckoutReturnedAt;
		}
		if (plan === "free") delete meta.stripeSubscriptionId;
		return meta;
	});
	return { subscriptionId, plan: plan === "founder" ? "founder" : "free" };
}

export async function cancelSubscription(subscriptionId) {
	const secret = process.env.STRIPE_SECRET_KEY;
	if (!secret || !subscriptionId) return;
	await stripeRequest(secret, "DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export function topupPrice(packId) {
	const pack = getCreditTopupPack(packId);
	return { pack, priceId: pack ? getCreditTopupPriceId(pack) : "" };
}
