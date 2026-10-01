import { ApiError, requestJson } from '../core/request.js';

export function createCreationsApi(origin = '') {
	const base = String(origin || '').trim().replace(/\/$/, '');
	const url = (path) => `${base}${path}`;

	return {
		async list({ limit = 50, offset = 0, ids, signal } = {}) {
			const query = Array.isArray(ids) && ids.length
				? `ids=${encodeURIComponent(ids.join(','))}`
				: `limit=${limit}&offset=${offset}`;
			const data = await requestJson(url(`/api/creations?${query}`), { signal });
			if (!Array.isArray(data?.creations) || typeof data?.has_more !== 'boolean') {
				throw new ApiError('The creations response was incomplete. Try refreshing.');
			}
			return data;
		}
	};
}
