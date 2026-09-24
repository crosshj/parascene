function normalizeApiOrigin(origin) {
	return String(origin || '').trim().replace(/\/$/, '');
}

export function createFilesApi(origin) {
	const base = normalizeApiOrigin(origin);
	const url = (path) => `${base}${path}`;

	async function responseData(response) {
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			const error = new Error(data.message || data.error || `File request failed (${response.status})`);
			error.status = response.status;
			throw error;
		}
		return data;
	}

	return {
		url,
		async list({ limit = 100, offset = 0, signal } = {}) {
			const response = await fetch(url(`/api/files?limit=${limit}&offset=${offset}`), {
				credentials: 'include',
				signal
			});
			return responseData(response);
		},

		upload(file, { onProgress, signal } = {}) {
			return new Promise((resolve, reject) => {
				const request = new XMLHttpRequest();
				const abort = () => request.abort();
				const cleanup = () => signal?.removeEventListener('abort', abort);
				request.open('POST', url(`/api/files?filename=${encodeURIComponent(file.name)}`));
				request.withCredentials = true;
				request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
				request.upload.addEventListener('progress', (event) => {
					if (event.lengthComputable) onProgress?.(event.loaded, event.total);
				});
				request.addEventListener('load', () => {
					cleanup();
					let data = {};
					try { data = JSON.parse(request.responseText || '{}'); } catch { /* Empty or non-JSON error response. */ }
					if (request.status >= 200 && request.status < 300) return resolve(data);
					const error = new Error(data.message || data.error || `Unable to upload file (${request.status})`);
					error.status = request.status;
					return reject(error);
				});
				request.addEventListener('error', () => {
					cleanup();
					reject(new Error('The upload connection failed'));
				});
				request.addEventListener('abort', () => {
					cleanup();
					reject(new DOMException('Upload aborted', 'AbortError'));
				});
				if (signal?.aborted) return abort();
				signal?.addEventListener('abort', abort, { once: true });
				request.send(file);
			});
		},

		async remove(fileId, { signal } = {}) {
			const response = await fetch(url(`/api/files/${encodeURIComponent(fileId)}`), {
				method: 'DELETE',
				credentials: 'include',
				signal
			});
			if (response.status === 204) return;
			await responseData(response);
		}
	};
}
