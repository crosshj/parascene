import crypto from "crypto";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "./utils/supabaseService.js";

/**
 * Phase 1: bridge Parascene cookie auth → Supabase Auth session for Realtime (private channels).
 * Password is derived with SESSION_SECRET (HMAC) so we never store a password; same derivation every time.
 */
function getBridgeSecret() {
	const session = process.env.SESSION_SECRET?.trim();
	return session || null;
}

function deriveSupabasePassword(userId) {
	const secret = getBridgeSecret();
	if (!secret) return null;
	const id = String(Number(userId));
	if (!Number.isFinite(Number(id)) || Number(id) < 1) return null;
	return crypto.createHmac("sha256", secret).update(`prsn:${id}`).digest("base64url").slice(0, 48);
}

function createAnonAuthClient() {
	const url = process.env.SUPABASE_URL?.trim();
	const anon = process.env.SUPABASE_ANON_KEY?.trim();
	if (!url || !anon) return null;
	return createClient(url, anon, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
			detectSessionInUrl: false
		}
	});
}

function isDuplicateUserError(err) {
	if (!err) return false;
	const msg = String(err.message || err.msg || "");
	return (
		msg.includes("already registered") ||
		msg.includes("already been registered") ||
		msg.includes("User already registered") ||
		err.code === "user_already_exists"
	);
}

/** Find auth user id by email (admin listUsers is paginated; cap pages for safety). */
async function findAuthUserIdByEmail(admin, email) {
	const target = String(email || "").trim().toLowerCase();
	if (!target) return null;
	for (let page = 1; page <= 10; page++) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
		if (error) throw error;
		const users = data?.users;
		if (!Array.isArray(users)) break;
		const found = users.find((u) => String(u?.email || "").toLowerCase() === target);
		if (found?.id) return found.id;
		if (users.length < 200) break;
	}
	return null;
}

export default function createSupabaseSessionRoutes({ queries }) {
	const router = express.Router();

	// POST /api/auth/supabase-session — cookie session required; returns tokens for supabase.auth.setSession.
	router.post("/api/auth/supabase-session", async (req, res) => {
		const userId = req.auth?.userId;
		if (!userId) {
			return res.status(401).json({ error: "Unauthorized", message: "Not signed in" });
		}

		if (!getBridgeSecret()) {
			return res.status(503).json({
				error: "Service unavailable",
				message: "SESSION_SECRET is not configured"
			});
		}

		const admin = getSupabaseServiceClient();
		const anon = createAnonAuthClient();
		if (!admin || !anon) {
			return res.status(503).json({
				error: "Service unavailable",
				message: "SUPABASE_URL and SUPABASE_ANON_KEY must be set"
			});
		}

		if (!queries?.selectUserById?.get) {
			return res.status(500).json({ error: "Server error", message: "Database not available" });
		}

		let user;
		try {
			user = await queries.selectUserById.get(userId);
		} catch (err) {
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
		if (!user?.email || typeof user.email !== "string" || !user.email.includes("@")) {
			return res.status(400).json({ error: "Bad request", message: "User email missing" });
		}

		const email = user.email.trim().toLowerCase();
		const password = deriveSupabasePassword(userId);
		if (!password) {
			return res.status(500).json({ error: "Server error", message: "Could not derive password" });
		}

		let session = null;
		try {
			const signIn1 = await anon.auth.signInWithPassword({ email, password });
			if (signIn1.data?.session) {
				session = signIn1.data.session;
			} else {
				const create = await admin.auth.admin.createUser({
					email,
					password,
					email_confirm: true,
					user_metadata: { prsn_user_id: userId }
				});
				if (create.error && !isDuplicateUserError(create.error)) {
					return res.status(500).json({
						error: "Server error",
						message: create.error.message || "Supabase createUser failed"
					});
				}
				if (create.error && isDuplicateUserError(create.error)) {
					const authUid = await findAuthUserIdByEmail(admin, email);
					if (!authUid) {
						return res.status(500).json({
							error: "Server error",
							message: "Supabase user exists but could not be resolved for password sync"
						});
					}
					const upd = await admin.auth.admin.updateUserById(authUid, { password });
					if (upd.error) {
						return res.status(500).json({
							error: "Server error",
							message: upd.error.message || "Supabase password update failed"
						});
					}
				}
				const signIn2 = await anon.auth.signInWithPassword({ email, password });
				if (signIn2.error || !signIn2.data?.session) {
					return res.status(500).json({
						error: "Server error",
						message: signIn2.error?.message || "Supabase sign-in failed after create"
					});
				}
				session = signIn2.data.session;
			}
		} catch (err) {
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}

		if (!session?.access_token || !session?.refresh_token) {
			return res.status(500).json({ error: "Server error", message: "No session" });
		}

		return res.status(200).json({
			access_token: session.access_token,
			refresh_token: session.refresh_token,
			expires_in: session.expires_in ?? null,
			expires_at: session.expires_at ?? null,
			token_type: session.token_type ?? "bearer"
		});
	});

	return router;
}
