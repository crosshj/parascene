const bootstrap = window.__PARASCENE_BOOTSTRAP__ || {};
const account = document.getElementById('account');
const appState = document.getElementById('app-state');
const clientRoute = document.getElementById('client-route');

clientRoute.textContent = bootstrap.clientRoute || (location.pathname + location.search + location.hash);

function renderUser(user) {
	account.textContent = user?.email ? `Signed in as ${user.email}.` : 'Signed in.';
	appState.textContent = user
		? 'You are signed in to the Parascene beta. This is the beta app shell, where the next app features will appear.'
		: 'This beta page is checking your account connection.';
}

let currentUser = bootstrap.user || null;
renderUser(currentUser);

try {
	const response = await fetch('/api/me', { credentials: 'include' });
	if (!response.ok) throw new Error('Session unavailable');
	const data = await response.json();
	currentUser = data.user || null;
	renderUser(currentUser);
	appState.textContent = 'Your account is connected and up to date.';
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
