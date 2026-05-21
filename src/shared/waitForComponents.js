/**
 * DOM readiness + `body.loaded` for the chat Rollup bundle only.
 * Non-bundled routes use `waitForComponents` in `public/shared/pageInit.js` (same behavior).
 */

async function waitForAppNavigationShell() {
	const navs = document.querySelectorAll('app-navigation');
	if (!navs.length) return;

	await Promise.all(
		[...navs].map(
			(el) =>
				new Promise((resolve) => {
					if (el.querySelector('header')) {
						resolve();
						return;
					}
					let settled = false;
					const finish = () => {
						if (settled) return true;
						if (el.querySelector('header')) {
							settled = true;
							resolve();
							return true;
						}
						return false;
					};
					const obs = new MutationObserver(() => {
						finish();
					});
					obs.observe(el, { childList: true, subtree: true });
					requestAnimationFrame(() => {
						requestAnimationFrame(() => {
							if (finish()) {
								obs.disconnect();
								return;
							}
							setTimeout(() => {
								obs.disconnect();
								if (!settled) {
									settled = true;
									resolve();
								}
							}, 2000);
						});
					});
				})
		)
	);
}

export async function waitForComponents(customElementTags) {
	if (document.readyState === 'loading') {
		await new Promise((resolve) => {
			document.addEventListener('DOMContentLoaded', resolve);
		});
	}
	if (Array.isArray(customElementTags) && customElementTags.length > 0) {
		await Promise.all(customElementTags.map((tag) => customElements.whenDefined(tag)));
	}
	if (customElementTags?.includes('app-navigation')) {
		await waitForAppNavigationShell();
	}
	await new Promise((resolve) => {
		requestAnimationFrame(() => {
			requestAnimationFrame(resolve);
		});
	});
	document.body.classList.add('loaded');
}
