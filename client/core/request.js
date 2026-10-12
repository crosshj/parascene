export class ApiError extends Error {
	constructor(message, { status = 0, data = null, cause } = {}) {
		super(message, { cause });
		this.name = 'ApiError';
		this.status = status;
		this.data = data;
	}
}

export async function requestJson(path, { method = 'GET', body, signal, headers = {}, credentials = 'include' } = {}) {
	let response;
	try {
		response = await fetch(path, {
			method,
			credentials,
			cache: 'no-store',
			signal,
			headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
	} catch (cause) {
		if (cause?.name === 'AbortError') throw cause;
		throw new ApiError('Unable to reach Parascene. Check your connection and try again.', { cause });
	}
	const data = await response.json().catch(() => null);
	if (!response.ok) {
		const message = data?.message || data?.error || `Request failed (${response.status})`;
		throw new ApiError(message, { status: response.status, data });
	}
	return data;
}
