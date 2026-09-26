import { iconMarkup } from '../../components/Icon/Icon.js';
import { escapeHtml } from '../../utils/dom.js';
import './SidebarOverlaysView.css';

const notifications = [
	{ title: 'Activity on "Worship"', message: '2 comments', time: '4 hr. ago' },
	{ title: 'Activity on "she\'s on fire!!! 🔥"', message: '2 comments', time: '8 hr. ago' },
	{ title: 'Activity on "Cinder Walks"', message: '2 comments', time: '8 hr. ago' },
	{ title: 'Comment on "Cinder"', message: 'Lostfilmmaker commented', time: '8 hr. ago' },
	{ title: 'Comment on "Our Travels"', message: 'PaperMan commented', time: '20 hr. ago' }
];

const accountItems = [
	{ label: 'View Profile', icon: 'user', href: '/user' },
	{ label: 'Connections', icon: 'globe', href: '/integrations' },
	{ label: 'Settings', icon: 'settings', action: 'settings' },
	{ label: 'Help', icon: 'help', href: '/help' },
	{ separator: true },
	{ label: 'About', icon: 'info', action: 'about' },
	{ label: 'Reports', icon: 'chart', href: '/reports/' },
	{ label: 'Clear cache', icon: 'settings', action: 'clear-cache' },
	{ label: 'Log Out', icon: 'logout', action: 'logout', danger: true }
];

function accountMarkup() {
	return accountItems.map((item) => item.separator
		? '<div class="ps-overlay__divider" role="separator"></div>'
		: `<a class="ps-account-item${item.danger ? ' is-danger' : ''}" ${item.href ? `href="${escapeHtml(item.href)}" data-spa-link` : `href="#" data-account-action="${escapeHtml(item.action)}"`}>
			${iconMarkup(item.icon, 'ps-account-item__icon')}<span>${escapeHtml(item.label)}</span>
		</a>`).join('');
}

function notificationMarkup(item, index) {
	return `<button type="button" class="ps-notification" data-notification-index="${index}">
		<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.message)}</span><time>${escapeHtml(item.time)}</time>
	</button>`;
}

export function mountSidebarOverlays({ onAction, creditsResource, onClaimCredits, onRefreshCredits } = {}) {
	const host = document.createElement('div');
	host.className = 'ps-overlays';
	host.innerHTML = `
		<div class="ps-overlay-popover" data-popover="account" role="menu" aria-label="Account" hidden>${accountMarkup()}</div>
		<div class="ps-overlay-popover ps-overlay-popover--notifications" data-popover="notifications" aria-label="Notifications" hidden>
			<div class="ps-preview-list">${notifications.map(notificationMarkup).join('')}</div>
			<div class="ps-preview-divider"></div>
			<button class="ps-preview-all" type="button" data-overlay-action="notifications">View all</button>
		</div>
		<div class="ps-modal-scrim" data-modal="notifications" hidden>
			<section class="ps-modal ps-modal--notifications" role="dialog" aria-modal="true" aria-labelledby="ps-notifications-title">
				<header class="ps-modal__header"><h2 id="ps-notifications-title">Notifications</h2><button class="ps-modal__close" aria-label="Close" data-close-modal>${iconMarkup('close', 'ps-modal__close-icon')}</button></header>
				<div class="ps-notifications-list">${notifications.map(notificationMarkup).join('')}</div>
				<footer class="ps-modal__footer"><button class="ps-secondary-button" type="button" data-overlay-action="mark-all-read">Mark All Read</button></footer>
			</section>
		</div>
		<div class="ps-modal-scrim" data-modal="credits" hidden>
			<section class="ps-modal ps-modal--credits" role="dialog" aria-modal="true" aria-labelledby="ps-credits-title">
				<header class="ps-modal__header"><h2 id="ps-credits-title">Credits</h2><button class="ps-modal__close" aria-label="Close" data-close-modal>${iconMarkup('close', 'ps-modal__close-icon')}</button></header>
				<div class="ps-credits-content" data-credits-content>
					<p class="ps-credits-balance">You have <strong data-credits-balance>—</strong> credits available.</p>
					<section><h3>Claim daily free credits</h3><p>Claim 10 credits once per day.</p><div class="ps-credits-actions"><button class="ps-outline-button" data-overlay-action="claim-credits" disabled>Claim 10 credits</button><span data-credits-claim-status aria-live="polite">Checking daily credit availability…</span><button class="ps-credits-retry" data-overlay-action="retry-credits" hidden>Retry</button></div></section>
					<section><h3>Get more credits</h3><p>Buy a credit pack or subscribe on the pricing page.</p><a class="ps-outline-button is-green" href="/credits" data-spa-link>${iconMarkup('credits')}View pricing</a></section>
					<section><h3>Run a server</h3><p>Run a server and earn credits for supporting the community.</p><a class="ps-outline-button" href="/servers/new" data-spa-link>${iconMarkup('help')}Learn More</a></section>
				</div>
			</section>
		</div>`;
	document.body.append(host);
	let anchor = null;
	let activePopover = null;
	let activeModal = null;
	const creditsBalance = host.querySelector('[data-credits-balance]');
	const claimButton = host.querySelector('[data-overlay-action="claim-credits"]');
	const claimStatus = host.querySelector('[data-credits-claim-status]');
	const retryCreditsButton = host.querySelector('[data-overlay-action="retry-credits"]');
	let claiming = false;
	function syncCredits(snapshot = creditsResource?.getSnapshot?.()) {
		const data = snapshot?.data;
		if (!data) {
			claimButton.disabled = true;
			retryCreditsButton.hidden = snapshot?.status !== 'error';
			if (snapshot?.status === 'error') claimStatus.textContent = 'Could not load credits.';
			return;
		}
		retryCreditsButton.hidden = true;
		const balanceText = Number(data.balance || 0).toLocaleString('en-US');
		if (creditsBalance.textContent !== balanceText) creditsBalance.textContent = balanceText;
		claimButton.disabled = !data.canClaim || claiming || snapshot.status === 'loading';
		if (!claiming && !claimStatus.dataset.error) {
			claimStatus.textContent = data.success ? 'Daily credits claimed successfully.' : data.canClaim ? 'Available once every UTC day.' : 'Check back tomorrow for more credits.';
		}
	}
	const unsubscribeCredits = creditsResource?.subscribe(syncCredits);
	async function claimDailyCredits() {
		if (claiming || !creditsResource?.data?.canClaim) return;
		claiming = true;
		claimButton.disabled = true;
		claimButton.setAttribute('aria-busy', 'true');
		claimStatus.dataset.error = '';
		claimStatus.textContent = 'Claiming…';
		try {
			const result = await onClaimCredits?.();
			claimStatus.textContent = result?.message || 'Daily credits claimed successfully.';
		} catch (error) {
			claimStatus.dataset.error = 'true';
			claimStatus.textContent = error?.message || 'Unable to claim credits right now.';
		} finally {
			claiming = false;
			claimButton.removeAttribute('aria-busy');
			syncCredits();
		}
	}
	async function refreshCredits() {
		retryCreditsButton.disabled = true;
		try { await onRefreshCredits?.(); }
		catch { /* State subscription surfaces a retryable error without discarding cached data. */ }
		finally { retryCreditsButton.disabled = false; syncCredits(); }
	}

	function positionPopover() {
		if (!activePopover || !anchor) return;
		const panel = host.querySelector(`[data-popover="${activePopover}"]`);
		const rect = anchor.getBoundingClientRect();
		const width = panel.getBoundingClientRect().width;
		const height = panel.getBoundingClientRect().height;
		const gap = 8;
		const sidebar = document.querySelector('.sidebar-view__panel');
		const sidebarLeft = sidebar?.getBoundingClientRect().left ?? 8;
		const leftAnchor = activePopover === 'notifications' ? sidebarLeft + 8 : rect.right - width;
		const left = Math.max(8, Math.min(leftAnchor, innerWidth - width - 8));
		let top = rect.bottom + gap;
		if (top + height > innerHeight - 8) top = rect.top - height - gap;
		top = Math.max(8, Math.min(top, innerHeight - height - 8));
		panel.style.left = `${Math.round(left)}px`;
		panel.style.top = `${Math.round(top)}px`;
	}
	function closePopover() {
		if (!activePopover) return;
		host.querySelector(`[data-popover="${activePopover}"]`).hidden = true;
		anchor?.setAttribute('aria-expanded', 'false');
		anchor = null;
		activePopover = null;
	}
	function closeModal() {
		if (!activeModal) return;
		host.querySelector(`[data-modal="${activeModal}"]`).hidden = true;
		activeModal = null;
		document.body.classList.remove('ps-modal-open');
	}
	function openModal(name) {
		closePopover();
		closeModal();
		activeModal = name;
		host.querySelector(`[data-modal="${name}"]`).hidden = false;
		document.body.classList.add('ps-modal-open');
		host.querySelector(`[data-modal="${name}"] [data-close-modal]`)?.focus();
	}
	function openPopover(name, nextAnchor) {
		if (activePopover === name && anchor === nextAnchor) { closePopover(); return; }
		closePopover();
		closeModal();
		activePopover = name;
		anchor = nextAnchor;
		anchor?.setAttribute('aria-expanded', 'true');
		const panel = host.querySelector(`[data-popover="${name}"]`);
		panel.hidden = false;
		positionPopover();
	}
	function onClick(event) {
		const close = event.target.closest('[data-close-modal]');
		if (close || event.target.matches('.ps-modal-scrim')) { closeModal(); return; }
		const modal = event.target.closest('[data-modal]');
		if (modal && activeModal) {
			const action = event.target.closest('[data-overlay-action]')?.dataset.overlayAction;
			if (action === 'notifications') openModal('notifications');
			else if (action === 'claim-credits') void claimDailyCredits();
			else if (action === 'retry-credits') void refreshCredits();
			else if (action) onAction?.({ action });
			return;
		}
		const account = event.target.closest('[data-account-action]');
		if (account) { event.preventDefault(); const action = account.dataset.accountAction; closePopover(); onAction?.({ action }); return; }
		const overlayAction = event.target.closest('[data-overlay-action]')?.dataset.overlayAction;
		if (overlayAction === 'notifications') { openModal('notifications'); return; }
		if (overlayAction) onAction?.({ action: overlayAction });
	}
	function onPointerDown(event) {
		if (activePopover && !host.querySelector(`[data-popover="${activePopover}"]`).contains(event.target) && !anchor?.contains(event.target)) closePopover();
	}
	function onKeydown(event) { if (event.key === 'Escape') { closePopover(); closeModal(); } }
	host.addEventListener('click', onClick);
	document.addEventListener('pointerdown', onPointerDown, true);
	document.addEventListener('keydown', onKeydown);
	window.addEventListener('resize', positionPopover);
	window.addEventListener('scroll', positionPopover, true);
	return {
		open(name, element) {
			if (name === 'credits' || name === 'notifications-full') {
				const modalName = name === 'credits' ? 'credits' : 'notifications';
				openModal(modalName);
				if (name === 'credits' && creditsResource && creditsResource.status !== 'loading' && creditsResource.status !== 'refreshing' && (!creditsResource.data || creditsResource.isStale())) void refreshCredits();
			} else openPopover(name, element);
		},
		destroy() {
			unsubscribeCredits?.();
			host.removeEventListener('click', onClick);
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeydown);
			window.removeEventListener('resize', positionPopover);
			window.removeEventListener('scroll', positionPopover, true);
			document.body.classList.remove('ps-modal-open');
			host.remove();
		}
	};
}
