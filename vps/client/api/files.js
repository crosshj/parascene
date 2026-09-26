import { ApiError, requestJson } from '../core/request.js';

function normalizeApiOrigin(origin) {
	return String(origin || '').trim().replace(/\/$/, '');
}

export function createFilesApi(origin) {
	const base = normalizeApiOrigin(origin);
	const url = (path) => `${base}${path}`;

	return {
		url,
		async list({ limit = 100, offset = 0, signal } = {}) {
			const data = await requestJson(url(`/api/files?limit=${limit}&offset=${offset}`), { signal });
			if (!Array.isArray(data?.files) || !data.pagination || !Number.isInteger(data.pagination.offset)) {
				throw new ApiError('The files response was incomplete. Try refreshing.');
			}
			return data;
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
					const error = new ApiError(data.message || data.error || `Unable to upload file (${request.status})`, { status: request.status, data });
					return reject(error);
				});
				request.addEventListener('error', () => {
					cleanup();
					reject(new ApiError('The upload connection failed'));
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

		remove(fileId, { signal } = {}) {
			return requestJson(url(`/api/files/${encodeURIComponent(fileId)}`), { method: 'DELETE', signal });
		}
	};
}
