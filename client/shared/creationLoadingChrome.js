export const creationLikeSpinnerHtml = '<svg class="creation-detail-like-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke-dasharray="40 14" stroke-linecap="round" /></svg>';

export function setCreationLikeLoading(button, loading) {
	button.classList.toggle('is-like-loading', loading);
	button.setAttribute('aria-busy', String(loading));
	button.disabled = loading;
}
