export function renderHomePage({ outlet, user = null }) {
	outlet.innerHTML = `
		<section class="card home-card">
			<p class="eyebrow">Parascene beta</p>
			<h1>Welcome back.</h1>
			<p class="state">Your account is connected to the Parascene beta.</p>
			<p class="account">${user?.email ? `Signed in as <strong></strong>.` : 'Signed in.'}</p>
			<div class="actions">
				<a class="primary-link" href="/files" data-spa-link>View your files</a>
				<a class="secondary-link" href="https://www.parascene.com">Go to the current app</a>
			</div>
		</section>
	`;
	const strong = outlet.querySelector('.account strong');
	if (strong) strong.textContent = user.email;
	document.title = 'parascene beta';
}
