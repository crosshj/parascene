import { describeUnhandledRequest, isTrackedApiPath } from "../../services/http/unhandledRequest.js";

/**
 * Last stop for a request no route claimed.
 * API and OAuth misses are counted for the DNS cutover. The response stays a 404.
 */
export function createUnhandledRequestMiddleware({ log, appVersion } = {}) {
	return function unhandledRequest(req, res, next) {
		if (res.headersSent) return next();
		const path = String(req.path || "");
		if (isTrackedApiPath(path)) {
			const entry = describeUnhandledRequest(req, appVersion);
			if (entry) log?.record(entry);
			return res.status(404).json({ error: "Not found" });
		}
		return next();
	};
}
