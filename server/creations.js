import express from "express";

export default function createCreationsRoutes({ queries }) {
  const router = express.Router();

  router.get("/api/creations", async (req, res) => {
    if (!req.auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await queries.selectUserById.get(req.auth.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const creations = await queries.selectCreationsForUser.all(user.id);
    return res.json({ creations });
  });

  return router;
}
