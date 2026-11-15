import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { readProvenance, writeProvenance } from "../server/services/create/provenance.js";

const creation = {
	id: 42,
	title: "Night & market",
	meta: {
		method: "advanced_generate",
		args: { model: "flux-schnell", prompt: "a quiet harbor", seed: 99 }
	}
};

test("read of an unmarked image is empty", async () => {
	const source = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#224466" } }).png().toBuffer();
	const record = readProvenance(source);
	assert.equal(record.present, false);
	assert.deepEqual(record.digitalSourceTypes, []);
	assert.equal(record.model, "");
});

test("write then read round-trips generation details and skips a second write", async () => {
	const source = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#224466" } }).png().toBuffer();
	const stamped = writeProvenance(source, creation, { composite: true });
	assert.notEqual(stamped, source);
	const record = readProvenance(stamped);
	assert.equal(record.present, true);
	assert.equal(record.software, "Parascene");
	assert.equal(record.title, "Night & market");
	assert.equal(record.model, "flux-schnell");
	assert.equal(record.method, "advanced_generate");
	assert.equal(record.prompt, "a quiet harbor");
	assert.equal(record.seed, "99");
	assert.equal(record.composite, true);
	assert.match(record.creationUrl, /\/creations\/42$/);
	assert.ok(record.digitalSourceTypes.some((uri) => uri.endsWith("/trainedAlgorithmicMedia")));
	assert.ok(record.digitalSourceTypes.some((uri) => uri.endsWith("/compositeWithTrainedAlgorithmicMedia")));
	assert.equal(writeProvenance(stamped, creation), stamped);
	const meta = await sharp(stamped).metadata();
	assert.equal(meta.width, 8);
	assert.equal(meta.height, 8);
});

test("jpeg write is readable and leaves the pixels decodable", async () => {
	const source = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#224466" } }).jpeg().toBuffer();
	const stamped = writeProvenance(source, { id: 7, title: "Still", meta: { args: { model: "sana", prompt: "portrait" } } });
	const record = readProvenance(stamped);
	assert.equal(record.present, true);
	assert.equal(record.model, "sana");
	assert.equal(record.prompt, "portrait");
	assert.equal(record.title, "Still");
	assert.match(record.creationUrl, /\/creations\/7$/);
	assert.equal(stamped[0], 0xff);
	assert.equal(stamped[1], 0xd8);
	const meta = await sharp(stamped).metadata();
	assert.equal(meta.width, 8);
});

test("a method key is not recorded as the model", async () => {
	const source = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#112233" } }).png().toBuffer();
	const stamped = writeProvenance(source, { id: 3, meta: { method: "advanced_generate", args: { prompt: "harbor" } } });
	const record = readProvenance(stamped);
	assert.equal(record.model, "");
	assert.equal(record.method, "advanced_generate");
	assert.equal(record.prompt, "harbor");
});

test("formats other than png and jpeg are left unchanged", () => {
	const gif = Buffer.from("GIF89a-not-really-but-long-enough");
	assert.equal(writeProvenance(gif, { id: 1 }), gif);
	assert.equal(readProvenance(gif).present, false);
});
