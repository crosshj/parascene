import { expressjwt } from "express-jwt";
import crypto from "crypto";

const COOKIE_NAME = "ps_session";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getJwtSecret() {
  return process.env.SESSION_SECRET || "dev-secret-change-me";
}

function authMiddleware() {
  return expressjwt({
    secret: getJwtSecret(),
    algorithms: ["HS256"],
    credentialsRequired: false,
    requestProperty: "auth",
    getToken: (req) => req.cookies?.[COOKIE_NAME]
  });
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sessionMiddleware(queries = {}) {
  if (!queries.selectSessionByTokenHash || !queries.refreshSessionExpiry) {
    return (req, res, next) => next();
  }

  return async (req, res, next) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token || !req.auth?.userId) {
      return next();
    }

    const tokenHash = hashToken(token);
    const session = await queries.selectSessionByTokenHash.get(
      tokenHash,
      req.auth.userId
    );

    if (!session) {
      clearAuthCookie(res);
      req.auth = null;
      if (req.path.startsWith("/api/") || req.path === "/me") {
        return res.status(401).json({ error: "Unauthorized" });
      }
      return next();
    }

    const expiresAtMs = Date.parse(session.expires_at);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      await queries.deleteSessionByTokenHash?.run(tokenHash, req.auth.userId);
      clearAuthCookie(res);
      req.auth = null;
      if (req.path.startsWith("/api/") || req.path === "/me") {
        return res.status(401).json({ error: "Unauthorized" });
      }
      return next();
    }

    const refreshedAt = new Date(Date.now() + ONE_WEEK_MS).toISOString();
    await queries.refreshSessionExpiry.run(session.id, refreshedAt);
    setAuthCookie(res, token);
    return next();
  };
}

function probabilisticSessionCleanup(queries = {}, options = {}) {
  if (!queries.deleteExpiredSessions) {
    return (req, res, next) => next();
  }

  const chance =
    Number.isFinite(options.chance) && options.chance > 0
      ? options.chance
      : 0.01;

  return async (req, res, next) => {
    if (Math.random() > chance) {
      return next();
    }

    try {
      await queries.deleteExpiredSessions.run(new Date().toISOString());
    } catch (error) {
      console.warn("Session cleanup failed:", error);
    }

    return next();
  };
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_WEEK_MS
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

export {
  COOKIE_NAME,
  ONE_WEEK_MS,
  getJwtSecret,
  authMiddleware,
  sessionMiddleware,
  probabilisticSessionCleanup,
  hashToken,
  setAuthCookie,
  clearAuthCookie
};
