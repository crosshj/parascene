import template from './HomeView.html';
import './HomeView.css';
import { escapeHtml } from '../../utils/dom.js';

export function renderHomeView({ outlet, user = null, sidebarMock = {}, onSidebarMockChange = () => {} }) {
	const accountText = user?.email
		? `Signed in as <strong>${escapeHtml(user.email)}</strong>.`
		: 'Signed in.';
	outlet.innerHTML = template.replace('{{ACCOUNT_TEXT}}', accountText);
	const modeInputs = [...outlet.querySelectorAll('[data-mock-mode]')];
	const sections = outlet.querySelector('[data-mock-sections]');
	const sectionInputs = [...outlet.querySelectorAll('[data-mock-section]')];
	let currentSidebarMock = { mode: 'full', ...sidebarMock };
	const updatePreference = (patch) => {
		currentSidebarMock = { ...currentSidebarMock, ...patch };
		onSidebarMockChange(currentSidebarMock);
	};
	modeInputs.forEach((input) => {
		input.checked = currentSidebarMock.mode === input.value;
		input.addEventListener('change', () => {
			if (!input.checked) return;
			sections.hidden = input.value !== 'minimal';
			modeInputs.forEach((modeInput) => { modeInput.checked = modeInput === input; });
			updatePreference({ mode: input.value });
		});
	});
	sections.hidden = currentSidebarMock.mode !== 'minimal';
	sectionInputs.forEach((input) => {
		input.value = currentSidebarMock[input.dataset.mockSection] === 'minimal' ? 'minimal' : 'none';
		input.addEventListener('change', () => updatePreference({ mode: 'minimal', [input.dataset.mockSection]: input.value }));
	});
	document.title = 'parascene beta';
}
