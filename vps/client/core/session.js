function currentReturnUrl() {
	return location.pathname + location.search + location.hash;
}

export function createSession({ initialUser = null, onChange, onLogout }) {
	let user = initialUser;
	let initialized = false;
	let redirecting = false;

	function redirectToLogin() {
		if (redirecting) return;
		redirecting = true;
		location.replace(`/auth?returnUrl=${encodeURIComponent(currentReturnUrl())}#login`);
	}

	async function refresh() {
		try {
			const response = await fetch('/api/me', { credentials: 'include' });
			if (response.status === 401) {
				user = null;
				onChange?.(user);
				redirectToLogin();
				return null;
			}
			if (!response.ok) throw new Error('Session unavailable');
			const data = await response.json();
			user = data.user || null;
			onChange?.(user);
			return user;
		} catch {
			if (!user) redirectToLogin();
			return user;
		}
	}

	async function logout() {
		onLogout?.();
		try {
			await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
		} finally {
			location.href = '/auth#login';
		}
	}

	async function initialize() {
		if (!initialized) initialized = true;
		onChange?.(user);
		return refresh();
	}

	function destroy() {
		if (!initialized) return;
		initialized = false;
	}

	return {
		get user() {
			return user;
		},
		initialize,
		refresh,
		logout,
		redirectToLogin,
		destroy
	};
}
