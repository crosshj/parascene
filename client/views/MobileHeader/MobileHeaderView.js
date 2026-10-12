import { mountTemplate, htmlFragment } from '../../utils/dom.js';
import { notifyIcon, creditIcon } from '../../icons/svg-strings.js';
import { normalizeAvatarUrl } from '../../shared/avatar.js';
import template from './MobileHeaderView.html';
import './MobileHeaderView.css';

export function mountMobileHeaderView({ outlet, services, onShellAction }) {
	const root = mountTemplate(outlet, template);
	root.querySelector('.notifications-button').append(htmlFragment(notifyIcon('icon')));
	root.querySelector('.credits-button').prepend(htmlFragment(creditIcon('icon')));
	const avatar = root.querySelector('.profile-avatar');
	const avatarSlot = root.querySelector('.profile-avatar-slot');
	function account() {
		const user = services.session.user;
		const url = normalizeAvatarUrl(user?.profile?.avatar_url);
		const founder = user?.meta?.plan === 'founder' || user?.plan === 'founder';
		const button = root.querySelector('.profile-button');
		button.classList.toggle('has-avatar', Boolean(url));
		button.classList.toggle('has-founder-flair', founder);
		if (url && avatar.dataset.avatarSrc !== url) avatar.dataset.avatarSrc = url;
		if (!url) { avatar.removeAttribute('src'); avatar.removeAttribute('data-avatar-src'); delete avatar.dataset.avatarResolved; }
		avatarSlot.replaceChildren();
		if (url && founder) {
			const flair = document.createElement('span');
			flair.className = 'avatar-with-founder-flair avatar-with-founder-flair--sm';
			flair.innerHTML = '<span class="founder-flair-avatar-ring"><span class="founder-flair-avatar-inner"></span></span>';
			flair.querySelector('.founder-flair-avatar-inner').append(avatar);
			avatarSlot.append(flair);
		} else if (url) {
			avatarSlot.append(avatar);
		}
	}
	const creditsProvider = services.providers.credits;
	function credits(snapshot) {
		const view = creditsProvider.viewState(snapshot);
		const label = root.querySelector('.credits-count');
		if (view.known && label.textContent !== view.balanceText) label.textContent = view.balanceText;
		const button = root.querySelector('.credits-button');
		button.classList.toggle('attention', view.claimAvailable);
		if (button.getAttribute('aria-label') !== view.label) button.setAttribute('aria-label', view.label);
	}
	function click(event) {
		const button = event.target.closest('[data-shell-action]');
		if (button) onShellAction({ action: 'open-overlay', overlay: button.dataset.shellAction, anchor: button });
	}
	root.addEventListener('click', click);
	const unsubscribeState = services.state.subscribe(account);
	function notifications() {
		const view = services.providers.document.attention().bell;
		const badge = root.querySelector('.notifications-badge');
		const button = root.querySelector('.notifications-button');
		if (badge.textContent !== view.text) badge.textContent = view.text;
		if (view.known && button.getAttribute('aria-label') !== view.label) button.setAttribute('aria-label', view.label);
	}
	const unsubscribeCredits = creditsProvider.query?.subscribe(credits);
	const unsubscribeNotifications = services.providers.document.subscribe(notifications);
	account(); credits();
	return { root, destroy() { unsubscribeState(); unsubscribeCredits(); unsubscribeNotifications?.(); root.removeEventListener('click', click); root.remove(); } };
}
