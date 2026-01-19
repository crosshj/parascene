import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  COOKIE_NAME,
  ONE_WEEK_MS,
  clearAuthCookie,
  getJwtSecret,
  hashToken,
  setAuthCookie
} from "./auth.js";

export default function createProfileRoutes({ queries }) {
  const router = express.Router();

  router.post("/signup", async (req, res) => {
    const email = String(req.body.username || req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).send("Email and password are required.");
    }

    const existingUser = await queries.selectUserByEmail.get(email);
    if (existingUser) {
      return res.status(409).send("Email already registered.");
    }

    const passwordHash = bcrypt.hashSync(password, 12);
    const info = await queries.insertUser.run(email, passwordHash, "consumer");
    // Support both insertId (standardized) and lastInsertRowid (legacy SQLite)
    const userId = info.insertId || info.lastInsertRowid;
    const token = jwt.sign({ userId }, getJwtSecret(), { expiresIn: "7d" });
    setAuthCookie(res, token);
    if (queries.insertSession) {
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + ONE_WEEK_MS).toISOString();
      await queries.insertSession.run(userId, tokenHash, expiresAt);
    }

    return res.redirect("/");
  });

  router.post("/login", async (req, res) => {
    const email = String(req.body.username || req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).send("Email and password are required.");
    }

    const user = await queries.selectUserByEmail.get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.redirect("/#auth-fail");
    }

    const token = jwt.sign({ userId: user.id }, getJwtSecret(), {
      expiresIn: "7d"
    });
    setAuthCookie(res, token);
    if (queries.insertSession) {
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + ONE_WEEK_MS).toISOString();
      await queries.insertSession.run(user.id, tokenHash, expiresAt);
    }
    return res.redirect("/");
  });

  router.post("/logout", async (req, res) => {
    if (queries.deleteSessionByTokenHash) {
      const token = req.cookies?.[COOKIE_NAME];
      if (token) {
        const tokenHash = hashToken(token);
        await queries.deleteSessionByTokenHash.run(
          tokenHash,
          req.auth?.userId
        );
      }
    }
    clearAuthCookie(res);
    res.redirect("/");
  });

  router.get("/me", (req, res) => {
    res.json({ userId: req.auth?.userId || null });
  });

  router.get("/api/profile", async (req, res) => {
    if (!req.auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await queries.selectUserById.get(req.auth.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json(user);
  });

  router.get("/api/notifications", async (req, res) => {
    if (!req.auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await queries.selectUserById.get(req.auth.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const notifications = await queries.selectNotificationsForUser.all(
      user.id,
      user.role
    );
    return res.json({ notifications });
  });

  router.get("/api/notifications/unread-count", async (req, res) => {
    if (!req.auth?.userId) {
      return res.json({ count: 0 });
    }

    const user = await queries.selectUserById.get(req.auth.userId);
    if (!user) {
      return res.json({ count: 0 });
    }

    const result = await queries.selectUnreadNotificationCount.get(
      user.id,
      user.role
    );
    return res.json({ count: result?.count ?? 0 });
  });

  router.post("/api/notifications/acknowledge", async (req, res) => {
    if (!req.auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await queries.selectUserById.get(req.auth.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const id = Number(req.body?.id);
    if (!id) {
      return res.status(400).json({ error: "Notification id required" });
    }

    const result = await queries.acknowledgeNotificationById.run(
      id,
      user.id,
      user.role
    );
    return res.json({ ok: true, updated: result.changes });
  });

  return router;
}
