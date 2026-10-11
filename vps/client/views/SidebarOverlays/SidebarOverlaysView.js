import { iconMarkup } from '../../components/Icon/Icon.js';
import { escapeHtml } from '../../utils/dom.js';
import { formatDateTime, formatRelativeTime } from '../../shared/datetime.js';
import { isDirectMessageMention, notificationDestination, notificationSlots } from '../../providers/notifications/preview.js';
import { createModalDismissButton } from '../../shared/modalDismiss.js';
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

/**
 * @param {{ title: string, labelledBy: string, wide?: boolean, bodyClass?: string, footerHtml?: string, bodyHtml: string, modalName: string }} opts
 */
function buildOverlayDialog(opts) {
	const dialog = document.createElement('dialog');
	dialog.className = `app-dialog ps-overlays-dialog${opts.wide ? ' ps-overlays-dialog--wide' : ''}`;
	dialog.setAttribute('data-modal', opts.modalName);
	dialog.setAttribute('aria-labelledby', opts.labelledBy);
	dialog.innerHTML = `
		<header class="app-dialog__header">
			<h2 id="${opts.labelledBy}" class="app-dialog__title">${escapeHtml(opts.title)}</h2>
		</header>
		<div class="app-dialog__body${opts.bodyClass ? ` ${opts.bodyClass}` : ''}">${opts.bodyHtml}</div>
		${opts.footerHtml ? `<footer class="app-dialog__footer">${opts.footerHtml}</footer>` : ''}
	`;
	const dismiss = createModalDismissButton({ attrs: { 'data-close-modal': '' } });
	dialog.querySelector('header')?.append(dismiss);
	return dialog;
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
	`;

	const notificationsDialog = buildOverlayDialog({
		modalName: 'notifications',
		title: 'Notifications',
		labelledBy: 'ps-notifications-title',
		wide: true,
		bodyHtml: '<div class="ps-notifications-list" data-notification-all></div>',
		footerHtml: '<button class="btn-secondary" type="button" data-overlay-action="mark-all-read" disabled>Mark all read</button>',
	});
	const creditsDialog = buildOverlayDialog({
		modalName: 'credits',
		title: 'Credits',
		labelledBy: 'ps-credits-title',
		bodyClass: 'ps-credits-content',
		bodyHtml: `
			<p class="ps-credits-balance">You have <strong data-credits-balance>—</strong> credits available.</p>
			<section><h3>Claim daily free credits</h3><p>Claim 10 credits once per day.</p><div class="ps-credits-actions"><button class="btn-outlined" data-overlay-action="claim-credits" disabled>Claim 10 credits</button><span data-credits-claim-status aria-live="polite">Checking daily credit availability…</span><button class="ps-credits-retry" data-overlay-action="retry-credits" hidden>Retry</button></div></section>
			<section><h3>Get more credits</h3><p>Buy a credit pack or subscribe on the pricing page.</p><a class="btn-outlined is-green" href="/pricing" data-spa-link>${iconMarkup('credits')}View pricing</a></section>
			<section><h3>Run a server</h3><p>Run a server and earn credits for supporting the community.</p><a class="btn-outlined" href="/servers/new" data-spa-link>${iconMarkup('help')}Learn More</a></section>
		`,
	});
	creditsDialog.querySelector('.app-dialog__body')?.setAttribute('data-credits-content', '');

	host.append(notificationsDialog, creditsDialog);
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
		claimButton.classList.toggle('btn-outlined', !solid);
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
	function closeModal() {
		if (!activeModal) return;
		const panel = host.querySelector(`[data-modal="${activeModal}"]`);
		if (panel instanceof HTMLDialogElement && panel.open) panel.close();
		activeModal = null;
		document.body.classList.remove('ps-modal-open');
	}
	function openModal(name) {
		closePopover();
		closeModal();
		activeModal = name;
		const panel = host.querySelector(`[data-modal="${name}"]`);
		if (!(panel instanceof HTMLDialogElement)) return;
		document.body.classList.add('ps-modal-open');
		if (!panel.open) panel.showModal();
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
	function onDialogClick(event) {
		const dialog = event.currentTarget;
		if (!(dialog instanceof HTMLDialogElement)) return;
		if (event.target === dialog || event.target.closest('[data-close-modal]')) {
			closeModal();
			return;
		}
		const note = event.target.closest('[data-notification-id]');
		if (note) {
			void openNotification(note.dataset.notificationId);
			return;
		}
		if (event.target.closest('a[data-spa-link]')) {
			closeModal();
			return;
		}
		const action = event.target.closest('[data-overlay-action]')?.dataset.overlayAction;
		if (action === 'mark-all-read') void markAllRead();
		else if (action === 'claim-credits') void claimDailyCredits();
		else if (action === 'retry-credits') void refreshCredits();
		else if (action) onAction?.({ action });
	}
	function onDialogClose(event) {
		const dialog = event.currentTarget;
		if (!(dialog instanceof HTMLDialogElement)) return;
		if (activeModal && dialog.getAttribute('data-modal') === activeModal) {
			activeModal = null;
			document.body.classList.remove('ps-modal-open');
		}
	}
	function onClick(event) {
		if (event.target.closest('dialog[data-modal]')) return;
		const note = event.target.closest('[data-notification-id]');
		if (note) {
			void openNotification(note.dataset.notificationId);
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
	function onKeydown(event) { if (event.key === 'Escape') { closePopover(); /* dialog handles its own Escape */ } }
	notificationsDialog.addEventListener('click', onDialogClick);
	creditsDialog.addEventListener('click', onDialogClick);
	notificationsDialog.addEventListener('close', onDialogClose);
	creditsDialog.addEventListener('close', onDialogClose);
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
			notificationsDialog.removeEventListener('click', onDialogClick);
			creditsDialog.removeEventListener('click', onDialogClick);
			notificationsDialog.removeEventListener('close', onDialogClose);
			creditsDialog.removeEventListener('close', onDialogClose);
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
