export function resolveProviderAuthToken(token) {
	if (typeof token !== "string") {
		return null;
	}

	const trimmed = token.trim();
	return trimmed ? trimmed : null;
}

export function buildProviderHeaders(baseHeaders, token, extraHeaders) {
	const headers = {
		...(baseHeaders || {})
	};

	if (extraHeaders && typeof extraHeaders === "object") {
		for (const [key, value] of Object.entries(extraHeaders)) {
			if (value == null) continue;
			headers[key] = String(value);
		}
	}

	const resolvedToken = resolveProviderAuthToken(token);
	if (resolvedToken) {
		headers.Authorization = `Bearer ${resolvedToken}`;
	}

	return headers;
}
