import template from './FeedView.html';
import './FeedView.css';
import { escapeHtml } from '../../utils/dom.js';

function renderFeedView({ outlet, user = null, sidebarMock = {}, onSidebarMockChange = () => {} }) {
	const accountText = user?.email ? `Signed in as <strong>${escapeHtml(user.email)}</strong>.` : 'Signed in.';
	outlet.innerHTML = template.replace('{{ACCOUNT_TEXT}}', accountText);
	const modeInputs = [...outlet.querySelectorAll('[data-mock-mode]')];
	const sections = outlet.querySelector('[data-mock-sections]');
	const sectionInputs = [...outlet.querySelectorAll('[data-mock-section]')];
	let preference = { mode: 'full', ...sidebarMock };
	const update = (patch) => { preference = { ...preference, ...patch }; onSidebarMockChange(preference); };
	modeInputs.forEach((input) => {
		input.checked = preference.mode === input.value;
		input.addEventListener('change', () => {
			if (!input.checked) return;
			sections.hidden = input.value !== 'minimal';
			modeInputs.forEach((other) => { other.checked = other === input; });
			update({ mode: input.value });
		});
	});
	sections.hidden = preference.mode !== 'minimal';
	sectionInputs.forEach((input) => {
		input.value = preference[input.dataset.mockSection] === 'minimal' ? 'minimal' : 'none';
		input.addEventListener('change', () => update({ mode: 'minimal', [input.dataset.mockSection]: input.value }));
	});
	document.title = 'parascene beta';
}

export const FeedView = Object.freeze({
	mount({ outlet, services }) {
		renderFeedView({ outlet, user: services.session.user, sidebarMock: services.state.selectors.sidebarPreference(), onSidebarMockChange: services.state.actions.setSidebarPreference });
		return { destroy() { outlet.replaceChildren(); } };
	},
});
