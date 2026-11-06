import express from "express";
import {
	applyGroupV2Patch,
	insertGroupV2,
	jsonGroupV2,
	loadOwnedGroupV2,
} from "./utils/groupV2Ops.js";

export default function createGroupV2Routes({ queries }) {
	const router = express.Router();

	async function requireUser(req, res) {
		if (!req.auth?.userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}
		const user = await queries.selectUserById.get(req.auth.userId);
		if (!user) {
			res.status(404).json({ error: "User not found" });
			return null;
		}
		return user;
	}

	router.post("/api/create/group", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		try {
			const created = await insertGroupV2(queries, user.id, req.body);
			if (created.error) {
				return res.status(created.status || 500).json({ error: created.error });
			}
			return res.json(jsonGroupV2(created.row, req, { title: created.row.title || created.title || null }));
		} catch (error) {
			return res.status(500).json({
				error: "Failed to create group",
				message: error?.message || "Bad request",
			});
		}
	});

	router.patch("/api/create/group/:id", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		try {
			const loaded = await loadOwnedGroupV2(queries, req.params.id, user.id);
			if (!loaded) {
				return res.status(404).json({ error: "Group not found" });
			}
			const patched = await applyGroupV2Patch(queries, loaded, user.id, req.body);
			if (patched.error) {
				return res.status(patched.status || 500).json({ error: patched.error });
			}
			const row = await queries.selectCreatedImageById.get(loaded.row.id, user.id);
			return res.json(jsonGroupV2(row, req, { title: row?.title || patched.title || loaded.row.title || null }));
		} catch (error) {
			return res.status(500).json({
				error: "Failed to update group",
				message: error?.message || "Bad request",
			});
		}
	});

	return router;
}
