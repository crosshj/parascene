function normalizeApiOrigin(origin) {
	return String(origin || '').trim().replace(/\/$/, '');
}

export function createFilesApi(origin) {
	const base = normalizeApiOrigin(origin);
	const url = (path) => `${base}${path}`;
	return {
		url,
		async list({ limit = 100, offset = 0, signal } = {}) {
			const response = await fetch(url(`/api/files?limit=${limit}&offset=${offset}`), {
				credentials: 'include',
				signal
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				const error = new Error(data.message || data.error || `Unable to list files (${response.status})`);
				error.status = response.status;
				throw error;
			}
			return data;
		}
	};
}
