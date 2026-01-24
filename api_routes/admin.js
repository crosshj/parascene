import express from "express";

export default function createAdminRoutes({ queries }) {
  const router = express.Router();

  async function requireAdmin(req, res) {
    if (!req.auth?.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }

    const user = await queries.selectUserById.get(req.auth?.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return null;
    }

    if (user.role !== 'admin') {
      res.status(403).json({ error: "Forbidden: Admin role required" });
      return null;
    }

    return user;
  }

  router.get("/admin/users", async (req, res) => {
    const user = await requireAdmin(req, res);
    if (!user) return;

    const users = await queries.selectUsers.all();
    
    // Fetch credits for each user
    const usersWithCredits = await Promise.all(
      users.map(async (user) => {
        const credits = await queries.selectUserCredits.get(user.id);
        return {
          ...user,
          credits: credits?.balance ?? 0
        };
      })
    );
    
    res.json({ users: usersWithCredits });
  });

  router.get("/admin/moderation", async (req, res) => {
    const items = await queries.selectModerationQueue.all();
    res.json({ items });
  });

  router.get("/admin/providers", async (req, res) => {
    const providers = await queries.selectProviders.all();
    res.json({ providers });
  });

  router.get("/admin/policies", async (req, res) => {
    const policies = await queries.selectPolicies.all();
    res.json({ policies });
  });

  router.get("/admin/servers/:id", async (req, res) => {
    const user = await requireAdmin(req, res);
    if (!user) return;

    const serverId = parseInt(req.params.id, 10);
    if (isNaN(serverId)) {
      return res.status(400).json({ error: "Invalid server ID" });
    }

    const server = await queries.selectServerById.get(serverId);
    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    res.json({ server });
  });

  router.post("/admin/servers/:id/test", async (req, res) => {
    const user = await requireAdmin(req, res);
    if (!user) return;

    const serverId = parseInt(req.params.id, 10);
    if (isNaN(serverId)) {
      return res.status(400).json({ error: "Invalid server ID" });
    }

    const server = await queries.selectServerById.get(serverId);
    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    const serverUrl = server.server_url;
    if (!serverUrl) {
      return res.status(400).json({ error: "Server URL not configured" });
    }

    // Normalize server_url (remove trailing slash)
    const normalizedUrl = serverUrl.toString().replace(/\/$/, '');

    // Call provider server to get capabilities
    try {
      const response = await fetch(normalizedUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        return res.status(400).json({ 
          error: `Provider server returned error: ${response.status} ${response.statusText}`,
          server_url: normalizedUrl
        });
      }

      const capabilities = await response.json();

      // Validate response structure
      if (!capabilities.methods || typeof capabilities.methods !== 'object') {
        return res.status(400).json({ 
          error: "Provider server response missing or invalid 'methods' field",
          server_url: normalizedUrl
        });
      }

      return res.status(200).json({ 
        capabilities,
        server_url: normalizedUrl
      });
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        return res.status(400).json({ 
          error: "Provider server did not respond within 10 seconds",
          server_url: normalizedUrl
        });
      }
      return res.status(400).json({ 
        error: `Failed to connect to provider server: ${fetchError.message}`,
        server_url: normalizedUrl
      });
    }
  });

  router.post("/admin/servers/:id/refresh", async (req, res) => {
    const user = await requireAdmin(req, res);
    if (!user) return;

    const serverId = parseInt(req.params.id, 10);
    if (isNaN(serverId)) {
      return res.status(400).json({ error: "Invalid server ID" });
    }

    const server = await queries.selectServerById.get(serverId);
    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    const serverUrl = server.server_url;
    if (!serverUrl) {
      return res.status(400).json({ error: "Server URL not configured" });
    }

    // Normalize server_url (remove trailing slash)
    const normalizedUrl = serverUrl.toString().replace(/\/$/, '');

    // Call provider server to get capabilities
    try {
      const response = await fetch(normalizedUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        return res.status(400).json({ 
          error: `Provider server returned error: ${response.status} ${response.statusText}`,
          server_url: normalizedUrl
        });
      }

      const capabilities = await response.json();

      // Validate response structure
      if (!capabilities.methods || typeof capabilities.methods !== 'object') {
        return res.status(400).json({ 
          error: "Provider server response missing or invalid 'methods' field",
          server_url: normalizedUrl
        });
      }

      // Update server config in database
      const updateResult = await queries.updateServerConfig.run(serverId, capabilities);
      
      if (updateResult.changes === 0) {
        return res.status(500).json({ 
          error: "Failed to update server configuration"
        });
      }

      return res.status(200).json({ 
        success: true,
        capabilities,
        server_url: normalizedUrl
      });
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        return res.status(400).json({ 
          error: "Provider server did not respond within 10 seconds",
          server_url: normalizedUrl
        });
      }
      return res.status(400).json({ 
        error: `Failed to connect to provider server: ${fetchError.message}`,
        server_url: normalizedUrl
      });
    }
  });

  return router;
}
