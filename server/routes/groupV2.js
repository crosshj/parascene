import express from "express";
import {
	applyGroupV2Patch,
	insertGroupV2,
	jsonGroupV2,
	loadOwnedGroupV2,
} from "../services/create/groupV2Ops.js";

export default function createGroupV2Routes({ queries }) {
	const router = express.Router();
	router.post("/api/create/group", async (req, res, next) => {
		if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
		try {
			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) return res.status(404).json({ error: "User not found" });
			const created = await insertGroupV2(queries, user.id, req.body);
			if (created.error) return res.status(created.status || 500).json({ error: created.error });
			return res.json(jsonGroupV2(created.row, req, { title: created.row.title || created.title || null }));
		} catch (error) { next(error); }
	});
	router.patch("/api/create/group/:id", async (req, res, next) => {
		if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
		try {
			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) return res.status(404).json({ error: "User not found" });
			const loaded = await loadOwnedGroupV2(queries, req.params.id, user.id);
			if (!loaded) return res.status(404).json({ error: "Group not found" });
			const patched = await applyGroupV2Patch(queries, loaded, user.id, req.body);
			if (patched.error) return res.status(patched.status || 500).json({ error: patched.error });
			const row = await queries.selectCreatedImageById.get(loaded.row.id, user.id);
			return res.json(jsonGroupV2(row, req, { title: row?.title || patched.title || loaded.row.title || null }));
		} catch (error) { next(error); }
	});
	return router;
}
