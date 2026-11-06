import express from "express";
import {
	formatLibraryFoldersSnapshot,
	normalizeLibraryFolderOperations,
	parseBaseRevision
} from "./utils/libraryFolders.js";

export default function createLibraryFoldersRoutes({ queries }) {
	const router = express.Router();

	router.get("/api/library/folders", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const fn = queries.getLibraryFoldersSnapshot?.get;
			if (typeof fn !== "function") {
				return res.status(501).json({ error: "Library folders are not available" });
			}
			const snapshot = await fn(req.auth.userId);
			const body = formatLibraryFoldersSnapshot(snapshot);
			res.set("Cache-Control", "private, no-store");
			return res.json(body);
		} catch (err) {
			console.error("[library/folders get]", err);
			return res.status(500).json({ error: "Failed to load library folders" });
		}
	});

	router.post("/api/library/folders/mutate", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const mutateFn = queries.mutateLibraryFolders?.run;
			if (typeof mutateFn !== "function") {
				return res.status(501).json({ error: "Library folders are not available" });
			}

			const body = req.body && typeof req.body === "object" ? req.body : {};
			const baseRaw = body.base_revision ?? body.baseRevision;
			const parsedRevision = parseBaseRevision(baseRaw);
			if (parsedRevision.error) {
				return res.status(400).json({ error: parsedRevision.error });
			}

			const normalized = normalizeLibraryFolderOperations(
				body.operations ?? body.ops ?? null
			);
			if (normalized.error) {
				return res.status(400).json({ error: normalized.error });
			}

			const result = await mutateFn(
				req.auth.userId,
				parsedRevision.revision,
				normalized.operations
			);

			if (!result || result.ok !== true) {
				if (result?.error === "conflict") {
					const snapshot = formatLibraryFoldersSnapshot(result);
					res.set("Cache-Control", "private, no-store");
					return res.status(409).json({
						error: "conflict",
						message: "base_revision is stale; pull and retry",
						...snapshot
					});
				}
				return res.status(400).json({
					error: result?.message || result?.error || "Invalid library folder mutation"
				});
			}

			const snapshot = formatLibraryFoldersSnapshot(result);
			res.set("Cache-Control", "private, no-store");
			return res.json(snapshot);
		} catch (err) {
			console.error("[library/folders mutate]", err);
			// If RPC is missing (migration not applied), surface a clear error.
			const msg = String(err?.message || "");
			if (msg.includes("prsn_library_folders_mutate") || msg.includes("Could not find the function")) {
				return res.status(501).json({ error: "Library folders are not available" });
			}
			return res.status(500).json({ error: "Failed to mutate library folders" });
		}
	});

	return router;
}
