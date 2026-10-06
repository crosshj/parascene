import { mountTemplate, htmlFragment } from '../../utils/dom.js';
import { homeIcon, trophyIcon } from '../../icons/svg-strings.js';
import { mobilePresentation } from '../../core/mobilePresentation.js';
import template from './MobileNavigationView.html';
import './MobileNavigationView.css';

const targets = { feed: '/feed', challenges: '/challenges', create: '/create', creations: '/creations', connect: '/chat#channels' };

export function mountMobileNavigationView({ outlet, services, actions, navigation }) {
	const root = mountTemplate(outlet, template);
	root.querySelector('[data-home-icon]').replaceWith(htmlFragment(homeIcon('mobile-bottom-nav-icon mobile-bottom-nav-icon-home')));
	root.querySelector('[data-trophy-icon]').replaceWith(htmlFragment(trophyIcon('mobile-bottom-nav-icon')));
	let currentActions = actions;
	function update(next = {}) {
		currentActions = next.actions || currentActions;
		const presentation = mobilePresentation(next.navigation || navigation || services.state.get().navigation || {});
		root.hidden = !presentation.footer;
		for (const button of root.querySelectorAll('[data-route]')) {
			const active = button.dataset.route === presentation.active;
			button.classList.toggle('is-active', active);
			if (active) button.setAttribute('aria-current', 'page');
			else button.removeAttribute('aria-current');
		}
	}
	function click(event) {
		const button = event.target.closest('[data-route]');
		if (!button || root.hidden) return;
		currentActions.navigate(targets[button.dataset.route]);
	}
	function badges({ data } = {}) {
		const summary = data?.unreadSummary || {};
		const challenges = Math.max(0, Number(summary.challenges_unread) || 0);
		const chat = Math.max(0, Number(summary.chat_unread ?? (Number(summary.total_unread || 0) - challenges)) || 0);
		for (const [route, count, label] of [['connect', chat, 'Chat'], ['challenges', challenges, 'Challenges']]) {
			const button = root.querySelector(`[data-route="${route}"]`);
			const badge = button.querySelector('.mobile-bottom-nav-unread-badge');
			badge.textContent = count > 99 ? '99+' : String(count);
			badge.classList.toggle('has-unread', count > 0);
			button.setAttribute('aria-label', count ? `${label}, ${count} unread` : label);
		}
	}
	root.addEventListener('click', click);
	const unsubscribe = services.providers.threads.query.subscribe(badges);
	badges({ data: services.providers.threads.query.data });
	update({ navigation });
	return { root, update, destroy() { unsubscribe(); root.removeEventListener('click', click); root.remove(); } };
}
