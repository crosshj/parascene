import express from "express";
import { createFilesRoutes, createPublicArtworkRoutes, createPublicFileRoutes } from "./files.js";
import { createGenericRoutes } from "./generic.js";
import { createFilesCors } from "./middleware/filesCors.js";

export function createCdnRoutes(input) {
	const { profileFiles, genericFiles, users } = input && input.profileFiles
		? input
		: { profileFiles: input, genericFiles: null, users: null };
	const router = express.Router();

	router.get("/healthz", (_req, res) => {
		res.set("Cache-Control", "no-store");
		return res.json({ ok: true, service: "parascene-cdn" });
	});

	router.use("/s", createPublicFileRoutes(profileFiles));
	router.use("/api/files/artwork", createPublicArtworkRoutes(profileFiles));
	router.use("/api/files", createFilesCors(), createFilesRoutes(profileFiles));
	if (genericFiles && users) router.use("/api/images/generic", createFilesCors(), createGenericRoutes(genericFiles, users));

	router.use((req, res) => {
		res.set("Cache-Control", "no-store");
		res.set("X-Robots-Tag", "noindex, nofollow");
		if (String(req.path || "").startsWith("/api/")) {
			return res.status(404).json({ error: "Not found", service: "parascene-cdn" });
		}
		return res
			.status(404)
			.type("text")
			.send("Parascene CDN service. The beta application is available at https://beta.parascene.com/.\n");
	});

	return router;
}
