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
      clearAuthCookie(res, req);
      req.auth = null;
      if (req.path.startsWith("/api/") || req.path === "/me") {
        return res.status(401).json({ error: "Unauthorized" });
      }
      return next();
    }

    const expiresAtMs = Date.parse(session.expires_at);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      await queries.deleteSessionByTokenHash?.run(tokenHash, req.auth.userId);
      clearAuthCookie(res, req);
      req.auth = null;
      if (req.path.startsWith("/api/") || req.path === "/me") {
        return res.status(401).json({ error: "Unauthorized" });
      }
      return next();
    }

    const refreshedAt = new Date(Date.now() + ONE_WEEK_MS).toISOString();
    await queries.refreshSessionExpiry.run(session.id, refreshedAt);
    setAuthCookie(res, token, req);
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

function isSecureRequest(req) {
  // Check if request is over HTTPS
  // Vercel sets x-forwarded-proto header
  if (req) {
    return (
      req.secure ||
      req.headers["x-forwarded-proto"] === "https" ||
      process.env.NODE_ENV === "production"
    );
  }
  // Fallback to NODE_ENV check if req not available
  return process.env.NODE_ENV === "production";
}

function setAuthCookie(res, token, req = null) {
  const isSecure = isSecureRequest(req);
  // For Vercel/production, use 'none' with secure to ensure cookies work with fetch requests
  // 'lax' doesn't send cookies with cross-site fetch requests, even on same domain
  const sameSite = isSecure ? "none" : "lax";
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: sameSite,
    secure: isSecure,
    maxAge: ONE_WEEK_MS,
    path: "/"
  });
}

function clearAuthCookie(res, req = null) {
  const isSecure = isSecureRequest(req);
  // Must match the same options used in setAuthCookie for clearCookie to work
  const sameSite = isSecure ? "none" : "lax";
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: sameSite,
    secure: isSecure,
    path: "/"
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
