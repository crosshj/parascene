import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import createShareRoutes from "../server/routes/share.js";
import { ACTIVE_SHARE_VERSION, mintShareToken } from "../server/routes/utils/shareLink.js";

test("share page renders metadata and its public image handler serves the referenced creation", async () => {
	const token = mintShareToken({ version: ACTIVE_SHARE_VERSION, imageId: 31, sharedByUserId: 8 });
	const row = {
		id: 31, user_id: 9, filename: "9_31_created.png", status: "completed", published: false,
		title: "Shared test creation", description: "A test description", width: 4, height: 3,
		meta: { media_type: "image" }
	};
	const imageBuffer = await sharp({ create: { width: 4, height: 3, channels: 3, background: "#456" } }).png().toBuffer();
	const viewRows = [];
	const queries = {
		selectCreatedImageByIdAnyUser: { get: async (id) => Number(id) === row.id ? row : null },
		selectUserProfileByUserId: { get: async (id) => ({ user_id: id, user_name: id === 8 ? "sharer" : "creator", display_name: "Test Person" }) },
		selectUserById: { get: async (id) => ({ id, email: `${id}@example.test` }) },
		insertSharePageView: { run: async (...args) => viewRows.push(args) }
	};
	const app = express();
	app.use(createShareRoutes({
		queries,
		storage: { getImageBuffer: async (filename) => { assert.equal(filename, row.filename); return imageBuffer; } }
	}));
	app.use(express.static(new URL("../server/pages", import.meta.url).pathname));
	const server = app.listen(0, "127.0.0.1");
	await new Promise((resolve) => server.once("listening", resolve));
	const base = `http://127.0.0.1:${server.address().port}`;
	try {
		const page = await fetch(`${base}/s/v1/${token}/test`);
		assert.equal(page.status, 200);
		const html = await page.text();
		assert.match(html, /Shared test creation/);
		assert.match(html, /property="og:image"/);
		assert.match(html, /\/api\/share\/v1\//);
		assert.match(html, /\/share\/share\.css/);
		assert.equal((await fetch(`${base}/share/share.css`)).status, 200);
		assert.equal((await fetch(`${base}/share/share.js`)).status, 200);
		const image = await fetch(`${base}/api/share/v1/${token}/image`);
		assert.equal(image.status, 200);
		assert.match(image.headers.get("content-type"), /image\/png/);
		assert.ok((await image.arrayBuffer()).byteLength > 0);
		assert.equal(viewRows.length, 1);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});
