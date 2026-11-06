/**
 * Smoke test for chat API (Bearer API key).
 *
 * Requires PRSN_API_KEY in .env and Supabase schema from db/schemas/supabase_03.sql applied.
 * Optional: CHAT_TEST_TAG (default testroom), CHAT_TEST_OTHER_USER_ID for DM branch.
 *
 *   node scripts/test-chat.js
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
	Accept: "application/json",
	"Content-Type": "application/json"
};

async function fetchJson(url, opts = {}) {
	const res = await fetch(url, { ...opts, headers: { ...authHeaders, ...opts.headers } });
	const text = await res.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}
	return { res, body };
}

async function main() {
	const profileUrl = `${API_BASE}/api/profile`;
	const { res: profileRes, body: profileBody } = await fetchJson(profileUrl);

	console.log(`${profileRes.status} ${profileRes.statusText}  ${profileUrl}`);
	if (!profileRes.ok) {
		console.error(profileBody);
		process.exit(1);
	}

	const tag = (process.env.CHAT_TEST_TAG || "testroom").trim().replace(/^#+/, "") || "testroom";

	const chUrl = `${API_BASE}/api/chat/channels`;
	const { res: chRes, body: chBody } = await fetchJson(chUrl, {
		method: "POST",
		body: JSON.stringify({ tag })
	});

	console.log("");
	console.log(`${chRes.status} ${chRes.statusText}  POST ${chUrl}`);
	if (!chRes.ok) {
		console.error(chBody);
		process.exit(1);
	}

	const threadId = chBody?.thread?.id;
	if (threadId == null) {
		console.error("Missing thread id in response:", chBody);
		process.exit(1);
	}
	console.log(JSON.stringify({ thread: chBody.thread }, null, 2));

	const postMsgUrl = `${API_BASE}/api/chat/threads/${threadId}/messages`;
	const { res: postRes, body: postBody } = await fetchJson(postMsgUrl, {
		method: "POST",
		body: JSON.stringify({ body: `test message ${new Date().toISOString()}` })
	});

	console.log("");
	console.log(`${postRes.status} ${postRes.statusText}  POST ${postMsgUrl}`);
	if (!postRes.ok) {
		console.error(postBody);
		process.exit(1);
	}
	console.log(JSON.stringify(postBody, null, 2));

	const listUrl = `${API_BASE}/api/chat/threads/${threadId}/messages?limit=20`;
	const { res: listRes, body: listBody } = await fetchJson(listUrl);

	console.log("");
	console.log(`${listRes.status} ${listRes.statusText}  ${listUrl}`);
	if (!listRes.ok) {
		console.error(listBody);
		process.exit(1);
	}

	const msgs = Array.isArray(listBody?.messages) ? listBody.messages : [];
	console.log(`messages: ${msgs.length}, hasMore: ${listBody?.hasMore}`);
	console.log(JSON.stringify(listBody, null, 2));

	const otherId = process.env.CHAT_TEST_OTHER_USER_ID?.trim();
	if (otherId && /^\d+$/.test(otherId)) {
		const dmUrl = `${API_BASE}/api/chat/dm`;
		const { res: dmRes, body: dmBody } = await fetchJson(dmUrl, {
			method: "POST",
			body: JSON.stringify({ other_user_id: Number(otherId) })
		});
		console.log("");
		console.log(`${dmRes.status} ${dmRes.statusText}  POST ${dmUrl}`);
		console.log(JSON.stringify(dmBody, null, 2));
		if (!dmRes.ok) process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
