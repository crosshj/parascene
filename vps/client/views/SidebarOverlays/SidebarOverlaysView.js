import { iconMarkup } from '../../components/Icon/Icon.js';
import { escapeHtml } from '../../utils/dom.js';
import { formatDateTime, formatRelativeTime } from '../../shared/datetime.js';
import { isDirectMessageMention, notificationDestination, notificationSlots } from '../../providers/notifications/preview.js';
import '../../elements/modals/base.css';
import './SidebarOverlaysView.css';

const accountItems = [
	{ label: 'View Profile', icon: 'user', href: '/user' },
	{ label: 'Connections', icon: 'globe', href: '/integrations' },
	{ label: 'Settings', icon: 'settings', action: 'settings' },
	{ label: 'Help', icon: 'help', href: '/help', external: true }
];

function accountMarkup() {
	return accountItems.map((item) => item.separator
		? '<div class="ps-overlay__divider" role="separator"></div>'
		: `<a class="ps-account-item${item.danger ? ' is-danger' : ''}" ${item.href ? `href="${escapeHtml(item.href)}"${item.external ? ' target="_blank" rel="noopener noreferrer"' : ' data-spa-link'}` : `href="#" data-account-action="${escapeHtml(item.action)}"`}>
			${iconMarkup(item.icon, 'ps-account-item__icon')}<span>${escapeHtml(item.label)}</span>
		</a>`).join('');
}

function emptySlotMarkup() {
	return '<div class="ps-notification ps-notification--empty" aria-hidden="true"></div>';
}

function notificationMarkup(item) {
	const read = Boolean(item.acknowledged_at);
	const href = notificationDestination(item);
	const time = formatRelativeTime(item.created_at);
	const exact = formatDateTime(item.created_at);
	return `<button type="button" class="ps-notification ${read ? 'is-read' : 'is-unread'}" data-notification-id="${escapeHtml(item.id)}" ${href ? '' : 'data-notification-static="true"'}>
		<strong>${escapeHtml(item.title || 'Notification')}</strong><span>${escapeHtml(item.message || '')}</span><time datetime="${escapeHtml(item.created_at || '')}" title="${escapeHtml(exact)}">${escapeHtml(time)}</time>
	</button>`;
}

export function mountSidebarOverlays({ onAction, credits, notifications, onClaimCredits, onRefreshCredits } = {}) {
	const creditsQuery = credits?.query;
	const listQuery = notifications?.listQuery;
	const host = document.createElement('div');
	host.className = 'ps-overlays';
	host.innerHTML = `
		<div class="ps-overlay-popover" data-popover="account" role="menu" aria-label="Account" hidden>${accountMarkup()}</div>
		<div class="ps-overlay-popover ps-overlay-popover--notifications" data-popover="notifications" aria-label="Notifications" hidden>
			<div class="ps-preview-list" data-notification-preview></div>
			<div class="ps-preview-divider" data-notification-divider></div>
			<button class="ps-preview-all" type="button" data-overlay-action="notifications">View all</button>
		</div>
		<div class="modal-overlay" data-modal="notifications">
			<div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="ps-notifications-title">
				<div class="modal-header">
					<h2 id="ps-notifications-title">Notifications</h2>
					<button class="modal-close" type="button" aria-label="Close" data-close-modal>${iconMarkup('close', 'modal-close-icon')}</button>
				</div>
				<div class="modal-body"><div class="ps-notifications-list" data-notification-all></div></div>
				<div class="modal-footer"><button class="ps-secondary-button" type="button" data-overlay-action="mark-all-read" disabled>Mark all read</button></div>
			</div>
		</div>
		<div class="modal-overlay" data-modal="credits">
			<div class="modal" role="dialog" aria-modal="true" aria-labelledby="ps-credits-title">
				<div class="modal-header">
					<h2 id="ps-credits-title">Credits</h2>
					<button class="modal-close" type="button" aria-label="Close" data-close-modal>${iconMarkup('close', 'modal-close-icon')}</button>
				</div>
				<div class="modal-body ps-credits-content" data-credits-content>
					<p class="ps-credits-balance">You have <strong data-credits-balance>—</strong> credits available.</p>
					<section><h3>Claim daily free credits</h3><p>Claim 10 credits once per day.</p><div class="ps-credits-actions"><button class="ps-outline-button" data-overlay-action="claim-credits" disabled>Claim 10 credits</button><span data-credits-claim-status aria-live="polite">Checking daily credit availability…</span><button class="ps-credits-retry" data-overlay-action="retry-credits" hidden>Retry</button></div></section>
					<section><h3>Get more credits</h3><p>Buy a credit pack or subscribe on the pricing page.</p><a class="ps-outline-button is-green" href="/pricing" data-spa-link>${iconMarkup('credits')}View pricing</a></section>
					<section><h3>Run a server</h3><p>Run a server and earn credits for supporting the community.</p><a class="ps-outline-button" href="/servers/new" data-spa-link>${iconMarkup('help')}Learn More</a></section>
				</div>
			</div>
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
	function syncCredits(snapshot = creditsQuery?.getSnapshot?.()) {
		const view = credits?.viewState(snapshot) || { known: false, claimAvailable: false, balanceText: '' };
		const data = snapshot?.data;
		const solid = Boolean(view.claimAvailable || claiming);
		claimButton.classList.toggle('btn-primary', solid);
		claimButton.classList.toggle('ps-outline-button', !solid);
		if (!view.known) {
			claimButton.disabled = true;
			retryCreditsButton.hidden = snapshot?.status !== 'error';
			if (snapshot?.status === 'error') claimStatus.textContent = 'Could not load credits.';
			return;
		}
		retryCreditsButton.hidden = true;
		if (creditsBalance.textContent !== view.balanceText) creditsBalance.textContent = view.balanceText;
		claimButton.disabled = !view.claimAvailable || claiming || snapshot.status === 'loading';
		if (!claiming && !claimStatus.dataset.error) {
			claimStatus.textContent = data?.success ? 'Daily credits claimed successfully.' : view.claimAvailable ? 'Available once every UTC day.' : 'Check back tomorrow for more credits.';
		}
	}
	const previewList = host.querySelector('[data-notification-preview]');
	const allList = host.querySelector('[data-notification-all]');
	const markAllButton = host.querySelector('[data-overlay-action="mark-all-read"]');
	function notificationRows(snapshot = listQuery?.getSnapshot?.()) {
		return (snapshot?.data?.notifications || []).filter((row) => !isDirectMessageMention(row));
	}
	function paintNotifications(snapshot = listQuery?.getSnapshot?.()) {
		const rows = notificationRows(snapshot);
		const slots = notificationSlots(rows);
		const unread = rows.some((row) => !row?.acknowledged_at);
		previewList.innerHTML = slots.map((item) => item ? notificationMarkup(item) : emptySlotMarkup()).join('');
		if (!rows.length) {
			const message = snapshot?.status === 'error' ? 'Couldn’t load notifications.' : snapshot?.data ? 'No notifications yet.' : '';
			allList.innerHTML = message ? `<p class="ps-notification-status">${escapeHtml(message)}</p>` : '';
		} else {
			allList.innerHTML = rows.map(notificationMarkup).join('');
		}
		markAllButton.disabled = !unread || snapshot?.status === 'loading';
	}
	const unsubscribeCredits = creditsQuery?.subscribe(syncCredits);
	const unsubscribeNotifications = listQuery?.subscribe(paintNotifications);
	if (!listQuery) paintNotifications();
	async function claimDailyCredits() {
		if (claiming || !credits?.viewState().claimAvailable) return;
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
		const sheet = activePopover === 'notifications' && window.matchMedia('(max-width: 768px)').matches;
		panel.classList.toggle('is-sheet', sheet);
		if (sheet) {
			panel.style.left = '';
			panel.style.top = '';
			return;
		}
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
	function setModalVisible(panel, visible) {
		if (panel.classList.contains('modal-overlay')) panel.classList.toggle('open', visible);
		else panel.hidden = !visible;
	}
	function closeModal() {
		if (!activeModal) return;
		setModalVisible(host.querySelector(`[data-modal="${activeModal}"]`), false);
		activeModal = null;
		document.body.classList.remove('ps-modal-open');
	}
	function openModal(name) {
		closePopover();
		closeModal();
		activeModal = name;
		const panel = host.querySelector(`[data-modal="${name}"]`);
		setModalVisible(panel, true);
		document.body.classList.add('ps-modal-open');
		panel.querySelector('[data-close-modal]')?.focus();
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
	async function openNotification(id) {
		const row = notificationRows().find((item) => String(item.id) === String(id));
		if (!row) return;
		if (!row.acknowledged_at) {
			try { await notifications.acknowledge(row.id); }
			catch { /* Follow the link even if marking it read fails. */ }
		}
		const href = notificationDestination(row);
		closePopover();
		closeModal();
		if (href) {
			document.dispatchEvent(new CustomEvent('parascene:navigate', { detail: { href } }));
			return;
		}
		if (row.type === 'tip' || row.type === 'credits') openModal('credits');
	}
	async function markAllRead() {
		if (markAllButton.disabled) return;
		markAllButton.disabled = true;
		try { await notifications.acknowledgeAll(); }
		finally { paintNotifications(); }
	}
	function onClick(event) {
		const note = event.target.closest('[data-notification-id]');
		if (note) { void openNotification(note.dataset.notificationId); return; }
		const close = event.target.closest('[data-close-modal]');
		if (close || event.target.matches('.modal-overlay')) { closeModal(); return; }
		const modal = event.target.closest('[data-modal]');
		if (modal && activeModal) {
			if (event.target.closest('a[data-spa-link]')) { closeModal(); return; }
			const action = event.target.closest('[data-overlay-action]')?.dataset.overlayAction;
			if (action === 'notifications') openModal('notifications');
			else if (action === 'mark-all-read') void markAllRead();
			else if (action === 'claim-credits') void claimDailyCredits();
			else if (action === 'retry-credits') void refreshCredits();
			else if (action) onAction?.({ action });
			return;
		}
		const account = event.target.closest('[data-account-action]');
		if (account) { event.preventDefault(); const action = account.dataset.accountAction; closePopover(); onAction?.({ action }); return; }
		const overlayAction = event.target.closest('[data-overlay-action]')?.dataset.overlayAction;
		if (overlayAction === 'notifications') { openModal('notifications'); return; }
		if (overlayAction === 'mark-all-read') { void markAllRead(); return; }
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
				if (
					name === 'credits' &&
					creditsQuery &&
					creditsQuery.status !== 'loading' &&
					creditsQuery.status !== 'refreshing' &&
					(!creditsQuery.data || creditsQuery.isStale())
				) {
					void refreshCredits();
				}
			} else openPopover(name, element);
		},
		destroy() {
			unsubscribeCredits?.();
			unsubscribeNotifications?.();
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
