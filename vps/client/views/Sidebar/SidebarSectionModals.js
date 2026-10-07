import { avatarMarkup } from '../../components/Avatar/Avatar.js';
import { requestJson } from '../../core/request.js';
import { createModalDismissButton } from '../../shared/modalDismiss.js';
import { getAvatarColor } from '../../shared/avatar.js';
import { escapeHtml } from '../../utils/dom.js';
import '../../components/Modal/Modal.css';
import './SidebarSectionModals.css';

function normalizeChannelTag(input) {
	const source = typeof input === 'string' ? input : '';
	if (!source) return null;
	const raw = source.replace(/^#+/, '');
	if (!raw || raw !== raw.trim()) return null;
	if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(raw)) return null;
	return raw;
}

function dialogShell({ title, label, wide = false }) {
	const dialog = document.createElement('dialog');
	dialog.className = `app-dialog sidebar-section-dialog${wide ? ' sidebar-section-dialog--wide' : ''}`;
	dialog.setAttribute('aria-label', label || title);
	dialog.innerHTML = `<header class="app-dialog__header"><h2 class="app-dialog__title">${escapeHtml(title)}</h2></header><div class="app-dialog__body"></div><p class="sidebar-section-dialog__status" data-status hidden></p>`;
	const dismiss = createModalDismissButton();
	dialog.querySelector('header').append(dismiss);
	document.body.append(dialog);
	const body = dialog.querySelector('.app-dialog__body');
	const status = dialog.querySelector('[data-status]');
	function setStatus(message) {
		status.hidden = !message;
		status.textContent = message || '';
	}
	function close() {
		setStatus('');
		if (dialog.open) dialog.close();
	}
	dismiss.addEventListener('click', close);
	dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
	return { dialog, body, setStatus, close, show() { setStatus(''); dialog.showModal(); } };
}

export function mountSidebarSectionModals({ api, getThreads, getViewerId, navigate, refresh } = {}) {
	const dm = dialogShell({ title: 'New direct message', label: 'New direct message' });
	const servers = dialogShell({ title: 'Servers', label: 'Servers', wide: true });
	const channels = dialogShell({ title: 'Channels', label: 'Channels' });
	const confirmDialog = dialogShell({ title: 'Confirm', label: 'Confirm' });
	let searchTimer = 0;
	let destroyed = false;
	let confirmResolve = null;

	dm.body.innerHTML = `<label class="sidebar-section-dialog__label" for="sidebar-dm-search">Search people</label>
		<input id="sidebar-dm-search" class="sidebar-section-dialog__input" type="search" placeholder="Name or @username" autocomplete="off" data-dm-search>
		<p class="sidebar-section-dialog__hint">Only people you don’t already have a DM with are listed.</p>
		<div class="sidebar-section-dialog__list" data-dm-results></div>
		<p class="sidebar-section-dialog__empty" data-dm-empty hidden>No matching people. Try another search.</p>`;
	servers.body.innerHTML = `<p class="sidebar-section-dialog__hint">Join a server to add it to your sidebar.</p><div class="sidebar-section-dialog__list sidebar-section-dialog__list--scroll" data-servers-list></div>`;
	channels.body.innerHTML = `<div class="sidebar-section-dialog__field">
			<h3 class="sidebar-section-dialog__subhead">Open channel</h3>
			<p class="sidebar-section-dialog__hint">Public and unique.</p>
			<div class="sidebar-section-dialog__tag-row">
				<input id="sidebar-channel-tag" class="sidebar-section-dialog__input" type="text" placeholder="e.g. pixelart" maxlength="32" autocomplete="off" data-channel-tag>
				<button type="button" class="btn-primary" data-channel-open>Open</button>
			</div>
			<p class="sidebar-section-dialog__hint" data-channel-hint hidden>Use 2–32 characters: lowercase letters, numbers, _ and -.</p>
		</div>
		<h3 class="sidebar-section-dialog__subhead">Browse</h3>
		<div class="sidebar-section-dialog__list sidebar-section-dialog__list--scroll" data-channel-list></div>`;
	confirmDialog.body.innerHTML = `<p class="sidebar-section-dialog__confirm" data-confirm-message></p>`;
	const confirmFooter = document.createElement('footer');
	confirmFooter.className = 'app-dialog__footer';
	confirmFooter.innerHTML = `<button type="button" class="btn-secondary" data-confirm-cancel>Cancel</button><button type="button" class="btn-primary" data-confirm-submit>Confirm</button>`;
	confirmDialog.dialog.append(confirmFooter);

	const dmSearch = dm.body.querySelector('[data-dm-search]');
	const dmResults = dm.body.querySelector('[data-dm-results]');
	const dmEmpty = dm.body.querySelector('[data-dm-empty]');
	const channelInput = channels.body.querySelector('[data-channel-tag]');
	const channelHint = channels.body.querySelector('[data-channel-hint]');
	const channelOpen = channels.body.querySelector('[data-channel-open]');

	function existingDmIds() {
		const ids = new Set();
		for (const thread of getThreads?.() || []) {
			if (thread?.type !== 'dm') continue;
			const direct = Number(thread.other_user_id);
			const nested = Number(thread.other_user?.id);
			if (direct > 0) ids.add(direct);
			if (nested > 0) ids.add(nested);
		}
		return ids;
	}

	function joinedSlugs() {
		const slugs = new Set();
		for (const thread of getThreads?.() || []) {
			const slug = typeof thread?.channel_slug === 'string' ? thread.channel_slug.trim().toLowerCase() : '';
			if (thread?.type === 'channel' && slug) slugs.add(slug);
		}
		return slugs;
	}

	async function searchPeople() {
		const query = dmSearch.value.trim();
		dmEmpty.hidden = true;
		if (!query) { dmResults.replaceChildren(); return; }
		try {
			const data = await requestJson(`/api/suggest?source=users&q=${encodeURIComponent(query)}&limit=20`);
			if (destroyed || !dm.dialog.open) return;
			const viewer = Number(getViewerId?.());
			const existing = existingDmIds();
			const rows = (Array.isArray(data?.items) ? data.items : []).filter((item) => {
				const id = Number(item?.id);
				return item?.type === 'user' && id > 0 && id !== viewer && !existing.has(id);
			});
			dmResults.innerHTML = rows.map((item) => {
				const label = typeof item.label === 'string' ? item.label : 'User';
				const sub = typeof item.sublabel === 'string' ? item.sublabel : '';
				const seed = sub.replace(/^@/, '') || String(item.id);
				return `<button type="button" class="sidebar-section-dialog__person" data-dm-pick="${Number(item.id)}" data-dm-name="${escapeHtml(seed)}">
					${avatarMarkup({ label, avatarUrl: item.icon_url || '', color: getAvatarColor(seed) }, 'sidebar-section-dialog__avatar')}
					<span class="sidebar-section-dialog__person-text"><span>${escapeHtml(label)}</span>${sub ? `<span class="sidebar-section-dialog__person-sub">${escapeHtml(sub)}</span>` : ''}</span>
				</button>`;
			}).join('');
			dmEmpty.hidden = rows.length > 0;
		} catch (error) {
			dm.setStatus(error?.message || 'Could not search people.');
		}
	}

	async function pickPerson(button) {
		const id = Number(button.dataset.dmPick);
		if (!id) return;
		button.disabled = true;
		try {
			const data = await api.openDm(id);
			const name = button.dataset.dmName || String(id);
			dm.close();
			await refresh?.();
			const username = /^[a-z0-9][a-z0-9_]{2,23}$/i.test(name) ? name.toLowerCase() : String(id);
			void navigate?.(`/dm/${encodeURIComponent(username)}`);
			return data;
		} catch (error) {
			dm.setStatus(error?.message || 'Could not open DM.');
			button.disabled = false;
		}
	}

	async function loadServers() {
		const list = servers.body.querySelector('[data-servers-list]');
		list.innerHTML = '<p class="sidebar-section-dialog__hint">Loading…</p>';
		try {
			const data = await requestJson('/api/servers');
			if (destroyed || !servers.dialog.open) return;
			const joinable = (Array.isArray(data?.servers) ? data.servers : []).filter((server) => server && server.id !== 1 && !server.is_member && server.can_join_leave !== false && !server.suspended);
			if (!joinable.length) {
				list.innerHTML = '<p class="sidebar-section-dialog__empty">No servers to join right now.</p>';
				return;
			}
			list.innerHTML = joinable.map((server) => {
				const description = typeof server.description === 'string' ? server.description.trim() : '';
				return `<div class="sidebar-section-dialog__server">
					<div><strong>${escapeHtml(server.name || 'Server')}</strong>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div>
					<button type="button" class="btn-outlined" data-server-join="${Number(server.id)}">Join</button>
				</div>`;
			}).join('');
		} catch (error) {
			list.innerHTML = `<p class="sidebar-section-dialog__empty">${escapeHtml(error?.message || 'Could not load servers.')}</p>`;
		}
	}

	async function joinServer(button) {
		const id = Number(button.dataset.serverJoin);
		if (!id) return;
		button.disabled = true;
		try {
			await requestJson(`/api/servers/${id}/join`, { method: 'POST', body: {} });
			servers.close();
			await refresh?.();
		} catch (error) {
			servers.setStatus(error?.message || 'Could not join server.');
			button.disabled = false;
		}
	}

	async function loadChannels() {
		const list = channels.body.querySelector('[data-channel-list]');
		list.innerHTML = '<p class="sidebar-section-dialog__hint">Loading…</p>';
		try {
			const data = await api.listChannelSlugs();
			if (destroyed || !channels.dialog.open) return;
			const joined = joinedSlugs();
			const slugs = (Array.isArray(data?.slugs) ? data.slugs : []).filter((slug) => {
				const key = String(slug || '').trim().toLowerCase();
				return key && !joined.has(key);
			});
			list.innerHTML = slugs.length
				? slugs.map((slug) => `<button type="button" class="sidebar-section-dialog__channel" data-channel-slug="${escapeHtml(slug)}">#${escapeHtml(slug)}</button>`).join('')
				: '<p class="sidebar-section-dialog__empty">No joinable channels.</p>';
		} catch (error) {
			list.innerHTML = `<p class="sidebar-section-dialog__empty">${escapeHtml(error?.message || 'Could not load channels.')}</p>`;
		}
	}

	async function openChannel(raw) {
		const tag = normalizeChannelTag(raw || '');
		channelHint.hidden = Boolean(tag);
		channelInput.classList.toggle('is-invalid', !tag);
		if (!tag) return;
		channelOpen.disabled = true;
		try {
			const data = await api.openChannel(tag);
			const slug = String(data?.thread?.channel_slug || tag).trim().toLowerCase();
			channels.close();
			await refresh?.();
			void navigate?.(`/ch/${encodeURIComponent(slug)}`);
		} catch (error) {
			channels.setStatus(error?.message || 'Could not open channel.');
		} finally {
			channelOpen.disabled = false;
		}
	}

	dmSearch.addEventListener('input', () => {
		window.clearTimeout(searchTimer);
		searchTimer = window.setTimeout(() => { void searchPeople(); }, 220);
	});
	dmResults.addEventListener('click', (event) => {
		const button = event.target.closest('[data-dm-pick]');
		if (button) void pickPerson(button);
	});
	servers.body.addEventListener('click', (event) => {
		const button = event.target.closest('[data-server-join]');
		if (button) void joinServer(button);
	});
	channelOpen.addEventListener('click', () => { void openChannel(channelInput.value); });
	channelInput.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') { event.preventDefault(); void openChannel(channelInput.value); }
	});
	channels.body.addEventListener('click', (event) => {
		const button = event.target.closest('[data-channel-slug]');
		if (!button) return;
		void openChannel(button.dataset.channelSlug);
	});
	const confirmCancel = confirmDialog.dialog.querySelector('[data-confirm-cancel]');
	const confirmSubmit = confirmDialog.dialog.querySelector('[data-confirm-submit]');
	confirmCancel.addEventListener('click', () => {
		confirmResolve?.(false);
		confirmResolve = null;
		confirmDialog.close();
	});
	confirmSubmit.addEventListener('click', () => {
		const run = confirmSubmit._run;
		if (!run) {
			confirmResolve?.(true);
			confirmResolve = null;
			confirmDialog.close();
			return;
		}
		confirmSubmit.disabled = true;
		confirmCancel.disabled = true;
		void Promise.resolve(run()).then(() => {
			confirmResolve?.(true);
			confirmResolve = null;
			confirmDialog.close();
		}).catch((error) => {
			confirmDialog.setStatus(error?.message || 'Could not complete that action.');
		}).finally(() => {
			confirmSubmit.disabled = false;
			confirmCancel.disabled = false;
		});
	});
	confirmDialog.dialog.addEventListener('close', () => {
		confirmResolve?.(false);
		confirmResolve = null;
		confirmSubmit._run = null;
		confirmSubmit.disabled = false;
		confirmCancel.disabled = false;
	});

	function confirm({ title, message, confirmLabel, run }) {
		confirmResolve?.(false);
		confirmDialog.dialog.querySelector('.app-dialog__title').textContent = title || 'Confirm';
		confirmDialog.body.querySelector('[data-confirm-message]').textContent = message || '';
		confirmSubmit.textContent = confirmLabel || 'Confirm';
		confirmSubmit._run = typeof run === 'function' ? run : null;
		confirmDialog.show();
		return new Promise((resolve) => { confirmResolve = resolve; });
	}

	return {
		open(section) {
			if (section === 'dm') {
				dmSearch.value = '';
				dmResults.replaceChildren();
				dmEmpty.hidden = true;
				dm.show();
				dmSearch.focus();
				return;
			}
			if (section === 'servers') {
				servers.show();
				void loadServers();
				return;
			}
			if (section === 'channels') {
				channelInput.value = '';
				channelInput.classList.remove('is-invalid');
				channelHint.hidden = true;
				channels.show();
				void loadChannels();
			}
		},
		confirm,
		destroy() {
			destroyed = true;
			window.clearTimeout(searchTimer);
			confirmResolve?.(false);
			for (const shell of [dm, servers, channels, confirmDialog]) {
				shell.close();
				shell.dialog.remove();
			}
		}
	};
}
