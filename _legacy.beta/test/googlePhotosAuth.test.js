import test from "node:test";
import assert from "node:assert/strict";
import {
	GOOGLE_PHOTOS_RECONNECT_MESSAGE,
	GooglePhotosAuthError,
	googlePhotosApiErrorPayload,
	isGooglePhotosRefreshRevoked,
	parseGoogleOAuthTokenError
} from "../api_routes/utils/googlePhotosAuth.js";

test("parseGoogleOAuthTokenError prefers description", () => {
	const parsed = parseGoogleOAuthTokenError(
		{ error: "invalid_grant", error_description: "Token has been expired or revoked." },
		"",
		"fallback"
	);
	assert.equal(parsed.error, "invalid_grant");
	assert.equal(parsed.message, "Token has been expired or revoked.");
});

test("isGooglePhotosRefreshRevoked detects invalid_grant", () => {
	assert.equal(
		isGooglePhotosRefreshRevoked({
			error: "invalid_grant",
			description: "",
			message: "invalid_grant"
		}),
		true
	);
	assert.equal(
		isGooglePhotosRefreshRevoked({
			oauthError: "invalid_grant",
			oauthDescription: "Token has been expired or revoked.",
			message: "Token has been expired or revoked."
		}),
		true
	);
	assert.equal(
		isGooglePhotosRefreshRevoked({
			error: "",
			description: "",
			message: "Network timeout"
		}),
		false
	);
});

test("googlePhotosApiErrorPayload marks auth errors for reconnect", () => {
	const payload = googlePhotosApiErrorPayload(
		new GooglePhotosAuthError(GOOGLE_PHOTOS_RECONNECT_MESSAGE),
		{ fallbackError: "Upload failed" }
	);
	assert.equal(payload.needsReconnect, true);
	assert.equal(payload.error, "google_photos_auth_expired");
	assert.equal(payload.message, GOOGLE_PHOTOS_RECONNECT_MESSAGE);
});
