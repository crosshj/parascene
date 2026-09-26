function currentReturnUrl() {
	return location.pathname + location.search + location.hash;
}

export function createSession({ initialUser = null, accountElement, avatarElement, avatarInitial, avatarImage, logoutButton, onLogout }) {
	let user = initialUser;
	let initialized = false;
	let redirecting = false;

	function redirectToLogin() {
		if (redirecting) return;
		redirecting = true;
		location.replace(`/auth?returnUrl=${encodeURIComponent(currentReturnUrl())}#login`);
	}

	function renderAccount() {
		const profile = user?.profile || {};
		const label = profile.display_name || profile.user_name || user?.email || 'Signed in';
		const isFounder = user?.plan === 'founder' || user?.meta?.plan === 'founder';
		if (accountElement) accountElement.textContent = label;
		if (avatarElement) {
			avatarElement.setAttribute('aria-label', label);
			avatarElement.classList.toggle('is-founder', isFounder);
		}
		if (avatarInitial) avatarInitial.textContent = (label.trim().slice(0, 1) || '?').toUpperCase();
		if (avatarImage) {
			const avatarUrl = profile.avatar_url || '';
			if (avatarInitial) avatarInitial.hidden = Boolean(avatarUrl);
			avatarImage.hidden = !avatarUrl;
			if (avatarUrl) avatarImage.src = avatarUrl;
			else avatarImage.removeAttribute('src');
		}
		if (avatarElement) {
			const currentFlair = avatarElement.querySelector('.avatar-with-founder-flair');
			if (isFounder && !currentFlair) {
				const flair = document.createElement('span');
				flair.className = 'avatar-with-founder-flair avatar-with-founder-flair--sm';
				flair.setAttribute('aria-hidden', 'true');
				flair.innerHTML = '<div class="founder-flair-avatar-ring"><div class="founder-flair-avatar-inner"></div></div>';
				const inner = flair.querySelector('.founder-flair-avatar-inner');
				if (avatarInitial) avatarInitial.hidden = true;
				if (!profile.avatar_url) {
					inner.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
				}
				if (avatarImage) {
					avatarImage.classList.add('profile-avatar');
					inner.append(avatarImage);
				}
				avatarElement.append(flair);
			} else if (!isFounder && currentFlair) {
				if (avatarInitial) avatarElement.append(avatarInitial);
				if (avatarImage) {
					avatarImage.classList.remove('profile-avatar');
					avatarElement.append(avatarImage);
				}
				currentFlair.remove();
			}
		}
	}

	async function refresh() {
		try {
			const response = await fetch('/api/me', { credentials: 'include' });
			if (response.status === 401) {
				user = null;
				renderAccount();
				redirectToLogin();
				return null;
			}
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
		onLogout?.();
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
