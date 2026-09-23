const sections = ['login', 'signup', 'account'];

const show = (id) => sections.forEach((name) => {
	document.getElementById(name).hidden = name !== id;
});

const errorFor = (name, message) => {
	const node = document.getElementById(`${name}-error`);
	node.textContent = message;
	node.hidden = false;
};

async function session() {
	const response = await fetch('/api/auth/session', { credentials: 'include' });
	const data = await response.json();
	if (data.user) {
		location.replace('/');
	} else {
		show(location.hash === '#signup' ? 'signup' : 'login');
	}
}

document.querySelectorAll('[data-auth-form]').forEach((form) => form.addEventListener('submit', async (event) => {
	event.preventDefault();
	const name = form.dataset.authForm;
	const response = await fetch(`/api/auth/${name}`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(Object.fromEntries(new FormData(form)))
	});
	const data = await response.json();
	if (!response.ok) return errorFor(name, data.message || 'Unable to complete request.');
	if (data.user) {
		location.replace('/');
	}
}));

document.getElementById('logout').addEventListener('click', async () => {
	await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
	location.href = '/auth.html#login';
});

session();
