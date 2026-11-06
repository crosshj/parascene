/**
 * Minimal smoke test for the public API using a Bearer key.
 *
 * Set PRSN_API_KEY in .env (repo root), then from the repo root:
 *   node scripts/test-api.js
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const API_BASE = "https://api.parascene.com";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const key = process.env.PRSN_API_KEY?.trim();
if (!key) {
	console.error("Missing PRSN_API_KEY in environment (.env at repo root).");
	process.exit(1);
}

const authHeaders = {
	Authorization: `Bearer ${key}`,
	Accept: "application/json"
};

async function fetchJson(url) {
	const res = await fetch(url, { headers: authHeaders });
	const text = await res.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}
	return { res, body };
}

function isFeedCreationItem(item) {
	if (!item || typeof item !== "object") return false;
	if (item.type === "tip") return false;
	return item.created_image_id != null || item.id != null;
}

async function main() {
	const profileUrl = `${API_BASE}/api/profile`;
	const { res: profileRes, body: profileBody } = await fetchJson(profileUrl);

	console.log(`${profileRes.status} ${profileRes.statusText}  ${profileUrl}`);
	if (!profileRes.ok) {
		console.error(profileBody);
		process.exit(1);
	}

	const safe =
		typeof profileBody === "object" && profileBody !== null
			? {
					id: profileBody.id,
					email: profileBody.email,
					plan: profileBody.plan,
					credits: profileBody.credits
				}
			: profileBody;
	console.log(JSON.stringify(safe, null, 2));

	// Ask for extra rows so we still get 20 creations if the newbie feed inserts tip cards.
	const feedLimit = 30;
	const feedUrl = `${API_BASE}/api/feed?limit=${feedLimit}&offset=0`;
	const { res: feedRes, body: feedBody } = await fetchJson(feedUrl);

	console.log("");
	console.log(`${feedRes.status} ${feedRes.statusText}  ${feedUrl}`);
	if (!feedRes.ok) {
		console.error(feedBody);
		process.exit(1);
	}

	const rawItems = Array.isArray(feedBody?.items) ? feedBody.items : [];
	const creations = rawItems.filter(isFeedCreationItem).slice(0, 20);

	const listed = creations.map((item) => ({
		created_image_id: item.created_image_id,
		id: item.id,
		title: item.title ?? null,
		author_user_name: item.author_user_name ?? null,
		created_at: item.created_at ?? null,
		like_count: item.like_count,
		comment_count: item.comment_count
	}));

	console.log("");
	console.log(`Feed creations (up to 20 of ${rawItems.length} items in response):`);
	console.log(JSON.stringify(listed, null, 2));
	if (feedBody?.hasMore != null) {
		console.log(`hasMore: ${feedBody.hasMore}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
