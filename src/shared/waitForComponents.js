/**
 * DOM readiness + `body.loaded` for the chat Rollup bundle only.
 * Non-bundled routes use `waitForComponents` in `public/shared/pageInit.js` (same behavior).
 */

export async function waitForComponents(customElementTags) {
	if (document.readyState === 'loading') {
		await new Promise((resolve) => {
			document.addEventListener('DOMContentLoaded', resolve);
		});
	}
	if (Array.isArray(customElementTags) && customElementTags.length > 0) {
		await Promise.all(customElementTags.map((tag) => customElements.whenDefined(tag)));
	}
	await new Promise((resolve) => {
		requestAnimationFrame(() => {
			requestAnimationFrame(resolve);
		});
	});
	document.body.classList.add('loaded');
}
