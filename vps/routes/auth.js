import bcrypt from "bcryptjs";
import express from "express";
import { requireAuth } from "./middleware/auth.js";
import { clearSessionCookie, hashToken, issueToken, SESSION_MS, setSessionCookie } from "./utils/session.js";

function publicUser(user, profile) {
	return user ? {
		id: user.id,
		email: user.email,
		role: user.role,
		plan: user.meta?.plan === 'founder' ? 'founder' : 'free',
		created_at: user.created_at,
		last_active_at: user.last_active_at,
		profile: profile || null
	} : null;
}

async function issueSession(sessions, req, res, userId) {
	const token = issueToken(userId);
	const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
	await sessions.create(userId, hashToken(token), expiresAt);
	setSessionCookie(res, token, req);
}

async function userWithProfile(users, userId) {
	const [user, profile] = await Promise.all([
		users.byId(userId),
		users.profileByUserId(userId)
	]);
	return publicUser(user, profile);
}

export function createAuthRoutes({ users, sessions }) {
	const router = express.Router();

	router.get("/api/auth/session", async (req, res, next) => {
		try {
			if (!req.auth?.userId) return res.json({ authenticated: false, user: null });
			const user = await userWithProfile(users, req.auth.userId);
			return res.json({ authenticated: Boolean(user), user });
		} catch (error) {
			return next(error);
		}
	});

	router.post("/api/auth/login", async (req, res, next) => {
		try {
			const identifier = String(req.body?.email || req.body?.username || "").trim();
			const normalized = identifier.toLowerCase();
			const user = identifier.includes("@")
				? await users.byEmail(normalized)
				: (await users.byUsername(normalized) || await users.byEmail(normalized));
			const password = String(req.body?.password || "");
			if (!user?.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
				return res.status(401).json({ error: "Unauthorized", message: "Invalid email or password" });
			}
			if (user.meta?.suspended === true) {
				return res.status(403).json({ error: "Forbidden", message: "Account suspended" });
			}
			await issueSession(sessions, req, res, user.id);
			return res.json({ authenticated: true, user: publicUser(user, await users.profileByUserId(user.id)) });
		} catch (error) {
			return next(error);
		}
	});

	router.post("/api/auth/signup", async (req, res, next) => {
		try {
			const email = String(req.body?.email || "").trim().toLowerCase();
			const password = String(req.body?.password || "");
			if (!email.includes("@") || password.length < 8) {
				return res.status(400).json({
					error: "Bad request",
					message: "A valid email and 8-character password are required"
				});
			}
			if (await users.byEmail(email)) {
				return res.status(409).json({ error: "Conflict", message: "An account already exists" });
			}
			const userId = await users.create(email, bcrypt.hashSync(password, 12));
			await issueSession(sessions, req, res, userId);
			return res.status(201).json({ authenticated: true, user: await userWithProfile(users, userId) });
		} catch (error) {
			return next(error);
		}
	});

	router.post("/api/auth/logout", async (req, res, next) => {
		try {
			if (req.auth?.token) await sessions.delete(hashToken(req.auth.token), req.auth.userId);
			clearSessionCookie(res, req);
			return res.json({ authenticated: false, user: null });
		} catch (error) {
			return next(error);
		}
	});

	router.get("/api/me", requireAuth, async (req, res, next) => {
		try {
			return res.json({ user: await userWithProfile(users, req.auth.userId) });
		} catch (error) {
			return next(error);
		}
	});

	return router;
}
