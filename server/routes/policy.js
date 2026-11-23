import crypto from "node:crypto";
import express from "express";
import { Redis } from "@upstash/redis";

const SEEN_KEY_PREFIX = "policy:seen:";
const FINGERPRINT_TTL_SEC = 60 * 60 * 24;
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
let redis = null;

function getRedis() {
	if (!redis) redis = Redis.fromEnv();
	return redis;
}

function sanitizeUa(ua) {
	if (typeof ua !== "string") return "";
	return ua.trim().replace(/[\x00-\x1F\x7F]/g, "").slice(0, 200);
}

function buildFingerprint(req, bodyOrQuery) {
	const tz = bodyOrQuery?.tz != null ? String(bodyOrQuery.tz).trim().slice(0, 64) : "";
	const screen = bodyOrQuery?.screen != null ? String(bodyOrQuery.screen).trim().slice(0, 32) : "";
	const raw = [sanitizeUa(req.get?.("user-agent")), tz, screen].filter(Boolean).join("|");
	return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

export function createPolicyRoutes() {
	const router = express.Router();

	router.get("/api/policy", async (req, res) => {
		try {
			if (req.cookies?.ps_cid) return res.json({ seen: true });
			const seen = await getRedis().get(SEEN_KEY_PREFIX + buildFingerprint(req, req.query));
			return res.json({ seen: seen != null });
		} catch {
			return res.status(500).json({ seen: null, error: "policy_unavailable" });
		}
	});

	router.post("/api/policy/seen", async (req, res) => {
		try {
			if (!req.cookies?.ps_cid) {
				res.cookie("ps_cid", crypto.randomUUID(), {
					httpOnly: true,
					secure: process.env.NODE_ENV === "production",
					sameSite: "lax",
					path: "/",
					maxAge: COOKIE_MAX_AGE_MS
				});
			}
			const body = req.body && typeof req.body === "object" ? req.body : {};
			await getRedis().set(SEEN_KEY_PREFIX + buildFingerprint(req, body), "1", { ex: FINGERPRINT_TTL_SEC });
			return res.json({ ok: true, seen: true });
		} catch {
			return res.status(500).json({ ok: false, error: "policy_unavailable" });
		}
	});

	return router;
}
