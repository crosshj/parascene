const bootstrap = window.__PARASCENE_BOOTSTRAP__ || {};
const account = document.getElementById('account');
const clientRoute = document.getElementById('client-route');

clientRoute.textContent = bootstrap.clientRoute || (location.pathname + location.search + location.hash);

function renderUser(user) {
	account.textContent = user?.email ? `Signed in as ${user.email}.` : 'Signed in.';
}

let currentUser = bootstrap.user || null;
renderUser(currentUser);

try {
	const response = await fetch('/api/me', { credentials: 'include' });
	if (!response.ok) throw new Error('Session unavailable');
	const data = await response.json();
	currentUser = data.user || null;
	renderUser(currentUser);
} catch {
	if (!bootstrap.user) {
		const returnUrl = location.pathname + location.search + location.hash;
		location.replace(`/auth?returnUrl=${encodeURIComponent(returnUrl)}#login`);
	}
}

document.getElementById('logout').addEventListener('click', async () => {
	await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
	location.href = '/auth#login';
});
