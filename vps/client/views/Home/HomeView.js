import template from './HomeView.html';
import './HomeView.css';
import { escapeHtml } from '../../utils/dom.js';

export function renderHomeView({ outlet, user = null }) {
	const accountText = user?.email
		? `Signed in as <strong>${escapeHtml(user.email)}</strong>.`
		: 'Signed in.';
	outlet.innerHTML = template.replace('{{ACCOUNT_TEXT}}', accountText);
	document.title = 'parascene beta';
}
