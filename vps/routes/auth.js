import bcrypt from "bcryptjs";
import express from "express";
import { clearSessionCookie, hashToken, issueToken, SESSION_MS, setSessionCookie } from "./utils/session.js";
import { requireAuth } from "./middleware/auth.js";

function publicUser(user, profile) { return user ? { id: user.id, email: user.email, role: user.role, created_at: user.created_at, last_active_at: user.last_active_at, profile: profile || null } : null; }
async function createSession(db, req, res, userId) { const token = issueToken(userId); await db.createSession(userId, hashToken(token), new Date(Date.now() + SESSION_MS).toISOString()); setSessionCookie(res, token, req); }

export function createAuthRoutes(db) {
	const router = express.Router();
	router.get("/api/auth/session", async (req, res, next) => { try { if (!req.auth?.userId) return res.json({ authenticated: false, user: null }); const [user, profile] = await Promise.all([db.userById(req.auth.userId), db.profileByUserId(req.auth.userId)]); return res.json({ authenticated: Boolean(user), user: publicUser(user, profile) }); } catch (error) { next(error); } });
	router.post("/api/auth/login", async (req, res, next) => { try { const identifier = String(req.body?.email || req.body?.username || "").trim(); const normalized = identifier.toLowerCase(); const user = identifier.includes("@") ? await db.userByEmail(normalized) : (await db.userByUsername(normalized) || await db.userByEmail(normalized)); if (!user || !user.password_hash || !bcrypt.compareSync(String(req.body?.password || ""), user.password_hash)) return res.status(401).json({ error: "Unauthorized", message: "Invalid email or password" }); if (user.meta?.suspended === true) return res.status(403).json({ error: "Forbidden", message: "Account suspended" }); await createSession(db, req, res, user.id); return res.json({ authenticated: true, user: publicUser(user, await db.profileByUserId(user.id)) }); } catch (error) { next(error); } });
	router.post("/api/auth/signup", async (req, res, next) => { try { const email = String(req.body?.email || "").trim().toLowerCase(); const password = String(req.body?.password || ""); if (!email.includes("@") || password.length < 8) return res.status(400).json({ error: "Bad request", message: "A valid email and 8-character password are required" }); if (await db.userByEmail(email)) return res.status(409).json({ error: "Conflict", message: "An account already exists" }); const userId = await db.createUser(email, bcrypt.hashSync(password, 12)); await createSession(db, req, res, userId); return res.status(201).json({ authenticated: true, user: publicUser(await db.userById(userId), await db.profileByUserId(userId)) }); } catch (error) { next(error); } });
	router.post("/api/auth/logout", async (req, res, next) => { try { if (req.auth?.token) await db.deleteSession(hashToken(req.auth.token), req.auth.userId); clearSessionCookie(res, req); return res.json({ authenticated: false, user: null }); } catch (error) { next(error); } });
	router.get("/api/me", requireAuth, async (req, res, next) => { try { const [user, profile] = await Promise.all([db.userById(req.auth.userId), db.profileByUserId(req.auth.userId)]); return res.json({ user: publicUser(user, profile) }); } catch (error) { next(error); } });
	return router;
}
