const MISC_BUCKET = "prsn_misc";

function profileFilesPrefix(userId) {
	const id = Number(userId);
	if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid user id");
	return `profile/${id}`;
}

function storageObjectUrl(supabaseUrl, objectKey) {
	const encodedPath = [MISC_BUCKET, ...String(objectKey).split("/")]
		.map((part) => encodeURIComponent(part))
		.join("/");
	return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${encodedPath}`;
}

export function createProfileFilesStore({ client, supabaseUrl, serviceRoleKey }) {
	return {
		async list(userId, { limit = 50, offset = 0 } = {}) {
			const { data, error } = await client.storage
				.from(MISC_BUCKET)
				.list(profileFilesPrefix(userId), {
					limit,
					offset,
					sortBy: { column: "created_at", order: "desc" }
				});
			if (error) throw error;
			return data || [];
		},

		async fetch(userId, fileId, { method = "GET", range, signal } = {}) {
			const objectKey = `${profileFilesPrefix(userId)}/${fileId}`;
			const headers = {
				apikey: serviceRoleKey,
				Authorization: `Bearer ${serviceRoleKey}`
			};
			if (range) headers.Range = range;
			return fetch(storageObjectUrl(supabaseUrl, objectKey), {
				method,
				headers,
				signal,
				redirect: "manual"
			});
		}
	};
}
