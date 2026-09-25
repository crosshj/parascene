function currentReturnUrl() {
	return location.pathname + location.search + location.hash;
}

export function createSession({ initialUser = null, accountElement, avatarElement, avatarInitial, avatarImage, logoutButton }) {
	let user = initialUser;
	let initialized = false;

	function redirectToLogin() {
		location.replace(`/auth?returnUrl=${encodeURIComponent(currentReturnUrl())}#login`);
	}

	function renderAccount() {
		const profile = user?.profile || {};
		const label = profile.display_name || profile.user_name || user?.email || 'Signed in';
		if (accountElement) accountElement.textContent = label;
		if (avatarElement) avatarElement.setAttribute('aria-label', label);
		if (avatarInitial) avatarInitial.textContent = (label.trim().slice(0, 1) || '?').toUpperCase();
		if (avatarImage) {
			const avatarUrl = profile.avatar_url || '';
			if (avatarInitial) avatarInitial.hidden = Boolean(avatarUrl);
			avatarImage.hidden = !avatarUrl;
			if (avatarUrl) avatarImage.src = avatarUrl;
			else avatarImage.removeAttribute('src');
		}
	}

	async function refresh() {
		try {
			const response = await fetch('/api/me', { credentials: 'include' });
			if (!response.ok) throw new Error('Session unavailable');
			const data = await response.json();
			user = data.user || null;
			renderAccount();
			return user;
		} catch {
			if (!user) redirectToLogin();
			return user;
		}
	}

	async function logout() {
		try {
			await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
		} finally {
			location.href = '/auth#login';
		}
	}

	async function initialize() {
		if (!initialized) {
			logoutButton?.addEventListener('click', logout);
			initialized = true;
		}
		renderAccount();
		return refresh();
	}

	function destroy() {
		if (!initialized) return;
		logoutButton?.removeEventListener('click', logout);
		initialized = false;
	}

	return {
		get user() {
			return user;
		},
		initialize,
		refresh,
		redirectToLogin,
		destroy
	};
}
