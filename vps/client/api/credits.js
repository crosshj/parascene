import { ApiError, requestJson } from '../core/request.js';

export function createCreditsApi() {
	return {
		async get({ signal } = {}) {
			const data = await requestJson('/api/credits', { signal });
			if (!Number.isFinite(Number(data?.viewer_id)) || !Number.isFinite(Number(data?.balance)) || typeof data?.canClaim !== 'boolean') throw new ApiError('The credits response was incomplete. Try again.');
			return data;
		},
		async claimDaily({ signal } = {}) {
			const data = await requestJson('/api/credits/claim', { method: 'POST', signal, body: {} });
			if (data?.success !== true || !Number.isFinite(Number(data?.balance))) throw new ApiError('The credit claim response was incomplete. Refresh your balance and try again.');
			return data;
		}
	};
}
