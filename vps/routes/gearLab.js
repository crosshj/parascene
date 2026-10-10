import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pageFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lab", "gear-lab.html");

export function isGearLabUser(userName) {
	return String(userName || "").trim().toLowerCase() === "oceanman";
}

/** Standalone generating-gears lab. Oceanman only, outside the app shell. */
export function createGearLabRoutes({ users, file = pageFile } = {}) {
	const router = express.Router();

	router.get(["/gear-lab", "/gear-lab/"], async (req, res, next) => {
		if (!req.auth?.userId) {
			const returnUrl = req.originalUrl || "/gear-lab";
			return res.redirect(`/auth?returnUrl=${encodeURIComponent(returnUrl)}#login`);
		}
		try {
			const profile = await users?.profileByUserId?.(req.auth.userId);
			if (!isGearLabUser(profile?.user_name)) return res.status(404).type("txt").send("Not found");
			const html = await fs.readFile(file, "utf8");
			return res.type("html").send(html);
		} catch (error) {
			return next(error);
		}
	});

	return router;
}
