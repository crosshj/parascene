export const GOOGLE_PHOTOS_RECONNECT_MESSAGE =
	"Your Google Photos connection expired. Reconnect in Connections to continue.";

export class GooglePhotosAuthError extends Error {
	constructor(message = GOOGLE_PHOTOS_RECONNECT_MESSAGE, { cause } = {}) {
		super(message);
		this.name = "GooglePhotosAuthError";
		this.needsReconnect = true;
		if (cause) this.cause = cause;
	}
}

export function parseGoogleOAuthTokenError(data, text, fallback = "Token request failed") {
	const error = typeof data?.error === "string" ? data.error.trim() : "";
	const description =
		typeof data?.error_description === "string" ? data.error_description.trim() : "";
	const message = description || error || (typeof text === "string" ? text.trim() : "") || fallback;
	return { error, description, message };
}

export function isGooglePhotosRefreshRevoked(input = {}) {
	const error =
		typeof input?.error === "string"
			? input.error
			: typeof input?.oauthError === "string"
				? input.oauthError
				: "";
	const description =
		typeof input?.description === "string"
			? input.description
			: typeof input?.oauthDescription === "string"
				? input.oauthDescription
				: "";
	const message = typeof input?.message === "string" ? input.message : "";
	const code = String(error || "").toLowerCase();
	if (code === "invalid_grant") return true;
	const blob = `${error || ""} ${description || ""} ${message || ""}`.toLowerCase();
	return (
		blob.includes("invalid_grant") ||
		blob.includes("token has been expired") ||
		blob.includes("token has been revoked") ||
		blob.includes("account has been deleted") ||
		blob.includes("user account is disabled")
	);
}

export function googlePhotosApiErrorPayload(err, { fallbackError = "Request failed" } = {}) {
	const needsReconnect =
		err instanceof GooglePhotosAuthError || err?.needsReconnect === true;
	const message =
		err instanceof Error && err.message
			? String(err.message)
			: typeof err === "string"
				? err
				: fallbackError;
	return {
		error: needsReconnect ? "google_photos_auth_expired" : fallbackError,
		message,
		needsReconnect
	};
}
