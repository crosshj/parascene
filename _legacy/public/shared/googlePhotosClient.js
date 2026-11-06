export function googlePhotosReconnectUrl(returnUrl) {
	const path =
		typeof returnUrl === "string" && returnUrl.trim()
			? returnUrl.trim()
			: `${window.location.pathname || "/"}${window.location.search || ""}`;
	return `/api/google-photos/connect?returnUrl=${encodeURIComponent(path)}`;
}

export function isGooglePhotosReconnectPayload(data) {
	return Boolean(data && typeof data === "object" && data.needsReconnect === true);
}

export function googlePhotosAuthMessageFromPayload(data, fallback = "") {
	if (!data || typeof data !== "object") return fallback;
	if (typeof data.message === "string" && data.message.trim()) return data.message.trim();
	if (typeof data.authMessage === "string" && data.authMessage.trim()) return data.authMessage.trim();
	return fallback;
}

export function googlePhotosRowStateFromStatus(data) {
	if (!data || data.configured !== true) return "hidden";
	if (data.needsReconnect === true) return "reconnect";
	if (data.connected !== true) return "connect";
	return "send";
}

export function googlePhotosErrorFromResponse(data, fallback) {
	if (isGooglePhotosReconnectPayload(data)) {
		return googlePhotosAuthMessageFromPayload(
			data,
			"Your Google Photos connection expired. Reconnect to continue."
		);
	}
	if (data && typeof data.message === "string" && data.message.trim()) return data.message.trim();
	if (data && typeof data.error === "string" && data.error.trim()) return data.error.trim();
	return fallback;
}

export function googlePhotosHasWorkingConnection(status) {
	if (!status || status.configured !== true) return false;
	if (status.connected !== true) return false;
	if (status.needsReconnect === true) return false;
	if (status.authHealthy === false) return false;
	return true;
}

export function googlePhotosPartyPushBlocked(status) {
	if (!status || status.statusOk !== true) return true;
	if (status.configured !== true) return true;
	if (status.needsReconnect === true) return true;
	if (status.connected !== true) return true;
	if (status.authHealthy === false) return true;
	return false;
}

export function googlePhotosPartyPushNotice(status, gp, fallback = "") {
	if (!status || status.statusOk !== true) {
		return "Could not verify Google Photos. Try again, then push.";
	}
	if (status.configured !== true) {
		return "Google Photos isn't connected. Open Connections to link your account.";
	}
	if (status.needsReconnect === true) {
		return gp?.googlePhotosAuthMessageFromPayload(
			status,
			"Your Google Photos connection expired. Reconnect, then push again."
		) || "Your Google Photos connection expired. Reconnect, then push again.";
	}
	if (status.connected !== true) {
		return "Connect Google Photos before pushing to the party album.";
	}
	if (status.authHealthy === false) {
		return gp?.googlePhotosAuthMessageFromPayload(
			status,
			"Google Photos is unavailable right now. Fix the connection, then push again."
		) || "Google Photos is unavailable right now. Fix the connection, then push again.";
	}
	return fallback;
}

export function googlePhotosPartyFixCta(status, gp) {
	if (!gp) return null;
	if (!status || status.statusOk !== true) {
		return { label: "Check again", action: "refresh" };
	}
	if (status.configured !== true) {
		return { label: "Open Connections", action: "navigate", href: "/integrations" };
	}
	if (status.needsReconnect === true || status.authHealthy === false) {
		return {
			label: "Reconnect Google Photos",
			action: "navigate",
			href: gp.googlePhotosReconnectUrl("/party")
		};
	}
	if (status.connected !== true) {
		return {
			label: "Connect Google Photos",
			action: "navigate",
			href: gp.googlePhotosReconnectUrl("/party")
		};
	}
	return null;
}
