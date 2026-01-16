import express from "express";

export default function createProviderRoutes({ queries }) {
  const router = express.Router();

  function requireUser(req, res) {
    if (!req.session.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }

    const user = queries.selectUserById.get(req.session.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return null;
    }

    return user;
  }

  router.get("/api/provider/status", (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    const statuses = queries.selectProviderStatuses.all();
    return res.json({ statuses });
  });

  router.get("/api/provider/metrics", (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    const metrics = queries.selectProviderMetrics.all();
    return res.json({ metrics });
  });

  router.get("/api/provider/grants", (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    const grants = queries.selectProviderGrants.all();
    return res.json({ grants });
  });

  router.get("/api/provider/templates-hosted", (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    const templates = queries.selectProviderTemplates.all();
    return res.json({ templates });
  });

  return router;
}
