import express from "express";
import { sendTemplatedEmail } from "../email/index.js";
import { getThumbnailUrl } from "../services/create/url.js";
import { isValidClientLandingEvent, recordLandingFunnelToRedis, resolveLandingVisitorKey } from "../services/feed/landingFunnel.js";

const ADMIN_EMAIL = "parascene.admin@crosshj.com";

function displayName(user, profile) {
	const display = typeof profile?.display_name === "string" ? profile.display_name.trim() : "";
	if (display) return display;
	const handle = typeof profile?.user_name === "string" ? profile.user_name.trim() : "";
	if (handle) return handle;
	const name = typeof user?.name === "string" ? user.name.trim() : "";
	if (name) return name;
	const email = String(user?.email || "");
	return (email.includes("@") ? email.split("@")[0] : email) || "Someone";
}

function metaObject(value) {
	if (value && typeof value === "object") return value;
	if (typeof value === "string") {
		try { return JSON.parse(value); } catch { return {}; }
	}
	return {};
}

export function createSiteApiRoutes({ client }) {
	const router = express.Router();

	router.get("/api/templates", async (req, res) => {
		if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
		const user = await client.from("prsn_users").select("id").eq("id", req.auth.userId).maybeSingle();
		if (user.error) return res.status(500).json({ error: "Failed to load templates" });
		if (!user.data) return res.status(404).json({ error: "User not found" });
		const templates = await client.from("prsn_templates").select("id,name,category,description,created_at").order("id", { ascending: true });
		if (templates.error) return res.status(500).json({ error: "Failed to load templates" });
		return res.json({ templates: templates.data || [] });
	});

	router.post("/api/landing/event", async (req, res) => {
		const body = req.body && typeof req.body === "object" ? req.body : {};
		const eventType = typeof body.event === "string" ? body.event.trim() : "";
		if (!isValidClientLandingEvent(eventType)) return res.status(400).json({ error: "invalid_event" });
		const variant = typeof body.variant === "string" && body.variant.trim() ? body.variant.trim().slice(0, 32) : "video";
		try {
			await recordLandingFunnelToRedis({ visitorKey: resolveLandingVisitorKey(req), eventType, variant });
			return res.json({ ok: true });
		} catch (error) {
			console.warn("[POST /api/landing/event]", error?.message || error);
			return res.status(500).json({ error: "landing_event_failed" });
		}
	});

	router.post("/api/feature-requests", async (req, res) => {
		const sent = await sendAdminMail(req, res, client, "featureRequest");
		if (sent) return;
	});

	router.post("/api/support-report", async (req, res) => {
		await sendAdminMail(req, res, client, "supportReport");
	});

	router.get("/api/party/groups", async (req, res) => {
		if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
		const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
		const rows = await client.from("prsn_created_images")
			.select("id,title,status,file_path,filename,meta,created_at")
			.eq("user_id", req.auth.userId)
			.order("created_at", { ascending: false })
			.limit(200);
		if (rows.error) return res.status(500).json({ error: "Failed to list party groups" });
		const parties = [];
		for (const image of rows.data || []) {
			const meta = metaObject(image.meta);
			if (meta?.party?.mode !== true || meta?.group?.kind !== "group_creations") continue;
			const sourceIds = Array.isArray(meta.group?.source_creation_ids) ? meta.group.source_creation_ids : [];
			const name = (typeof meta.party?.name === "string" && meta.party.name.trim())
				|| (typeof meta.party?.settings?.partyName === "string" && meta.party.settings.partyName.trim())
				|| (typeof image.title === "string" && image.title.trim())
				|| "Party Mode";
			const rawUrl = image.status === "completed" ? image.file_path || (image.filename ? `/api/images/created/${image.filename}` : null) : null;
			parties.push({
				id: Number(image.id),
				title: typeof image.title === "string" && image.title.trim() ? image.title.trim() : name,
				name,
				updated_at: meta.group?.updated_at || meta.group?.grouped_at || image.created_at,
				photo_count: sourceIds.length,
				queue_count: Array.isArray(meta.party.queue) ? meta.party.queue.length : 0,
				pushed_count: Array.isArray(meta.party.pushed) ? meta.party.pushed.length : 0,
				thumbnail_url: rawUrl ? getThumbnailUrl(rawUrl) : null
			});
			if (parties.length >= limit) break;
		}
		return res.json({ parties });
	});

	return router;
}

async function sendAdminMail(req, res, client, template) {
	if (!req.auth?.userId) {
		res.status(401).json({ error: "Unauthorized" });
		return true;
	}
	const userResult = await client.from("prsn_users").select("id,email,role,name,created_at").eq("id", req.auth.userId).maybeSingle();
	if (userResult.error || !userResult.data) {
		res.status(userResult.data ? 500 : 404).json({ error: userResult.data ? "Failed to load user" : "User not found" });
		return true;
	}
	const profileResult = await client.from("prsn_user_profiles").select("display_name,user_name").eq("user_id", req.auth.userId).maybeSingle();
	const user = userResult.data;
	const profile = profileResult.data || null;
	if (!process.env.RESEND_API_KEY || !process.env.RESEND_SYSTEM_EMAIL) {
		res.status(503).json({ error: "Email is not configured on this environment." });
		return true;
	}
	const requesterEmail = String(user.email || "").trim();
	const data = {
		requesterName: displayName(user, profile),
		requesterEmail,
		requesterUserId: user.id,
		requesterUserName: typeof profile?.user_name === "string" ? profile.user_name.trim() : "",
		requesterDisplayName: typeof profile?.display_name === "string" ? profile.display_name.trim() : "",
		requesterRole: typeof user.role === "string" ? user.role : "",
		requesterCreatedAt: user.created_at ?? null,
		userAgent: String(req.get("user-agent") || "").trim(),
		acceptLanguage: String(req.get("accept-language") || "").trim(),
		referer: String(req.get("referer") || "").trim(),
		ip: String(req.ip || "").trim(),
		submittedAt: new Date().toISOString()
	};
	if (template === "featureRequest") {
		const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 5000) : "";
		if (!message) {
			res.status(400).json({ error: "Details are required." });
			return true;
		}
		const context = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
		data.message = message;
		data.context = context;
		data.referer = data.referer || context.referrer || "";
		data.forwardedFor = String(req.get("x-forwarded-for") || "").trim();
		data.ips = Array.isArray(req.ips) ? req.ips.map((value) => String(value || "").trim()).filter(Boolean) : [];
	} else {
		data.report = req.body?.report && typeof req.body.report === "object" ? req.body.report : {};
	}
	try {
		await sendTemplatedEmail({ to: ADMIN_EMAIL, template, replyTo: requesterEmail || undefined, data });
		res.json({ ok: true });
	} catch (error) {
		res.status(500).json({ error: error?.message || "Failed to send." });
	}
	return true;
}
