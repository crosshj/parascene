import path from "node:path";

const GENERIC_BUCKET = "prsn_generic-images";
const MISC_BUCKET = "prsn_misc";

function bucketForKey(key) {
	return /^profile\/\d+\/misc_[^/]+$/i.test(key) ? MISC_BUCKET : GENERIC_BUCKET;
}

function safeObjectKey(value) {
	const key = String(value || "").trim();
	if (!key || key.length > 1024 || key.startsWith("/") || key.includes("..") || key.includes("\\") || /[\0-\x1f\x7f]/.test(key)) {
		return null;
	}
	if (key.split("/").some((part) => !part || part === ".")) return null;
	return key;
}

function storageObjectUrl(supabaseUrl, bucket, objectKey) {
	const encoded = [bucket, ...objectKey.split("/")].map((part) => encodeURIComponent(part)).join("/");
	return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${encoded}`;
}

export function createGenericFilesStore({ client, supabaseUrl, serviceRoleKey }) {
	return {
		async upload(key, body, { contentType, originalName } = {}) {
			const objectKey = safeObjectKey(key);
			if (!objectKey) throw new Error("Invalid storage key");
			const bucket = client.storage.from(bucketForKey(objectKey));
			const { data, error } = await bucket.upload(objectKey, body, {
				cacheControl: "3600",
				contentType,
				duplex: "half",
				metadata: originalName ? { originalName } : undefined,
				upsert: true
			});
			if (error) throw error;
			return data;
		},

		async remove(key) {
			const objectKey = safeObjectKey(key);
			if (!objectKey) throw new Error("Invalid storage key");
			const { error } = await client.storage.from(bucketForKey(objectKey)).remove([objectKey]);
			if (error) throw error;
		},

		async fetch(key, { method = "GET", range, signal } = {}) {
			const objectKey = safeObjectKey(key);
			if (!objectKey) return new Response(null, { status: 404 });
			const bucket = bucketForKey(objectKey);
			const headers = {
				apikey: serviceRoleKey,
				Authorization: `Bearer ${serviceRoleKey}`
			};
			if (range) headers.Range = range;
			return fetch(storageObjectUrl(supabaseUrl, bucket, objectKey), {
				method,
				headers,
				signal,
				redirect: "manual"
			});
		},

		bucketForKey
	};
}

export function genericKeyBasename(key) {
	return path.basename(String(key || ""));
}
