/**
 * Challenges organize board boot (SPA lane + legacy standalone entry).
 * Boot: paint cached channel messages immediately, then refresh from the network.
 */
import { fetchAllChatThreadMessages } from './model/buildChannelModel.js';
import {
	isChallengeChannelAdmin,
	isImpliedChallengeOrganizer,
	pickLatestChallengesGlobalConfig,
	resolveChallengeOrganizerAllowlistFromMessages
} from './challengeAdmin.js';
import { mountChallengesOrganizerTools } from './mountOrganizerSidebar.js';
import {
	challengesMessagesFingerprint,
	readChallengesChannelCache,
	writeChallengesChannelCache
} from './challengesChannelCache.js';
import { renderChallengesOrganizeBoardSkeleton } from '../../shared/skeleton.js';

function esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

async function fetchViewerProfileMini() {
	try {
		const res = await fetch('/api/profile', { credentials: 'include' });
		if (!res.ok) return null;
		const user = await res.json().catch(() => null);
		if (!user?.email) return null;
		const prof = user?.profile && typeof user.profile === 'object' ? user.profile : {};
		const user_name =
			typeof prof.user_name === 'string' && prof.user_name.trim() ? prof.user_name.trim() : null;
		const id = Number(user?.id);
		return {
			id: Number.isFinite(id) && id > 0 ? id : null,
			user_name
		};
	} catch {
		return null;
	}
}

async function resolveChallengesThreadId() {
	const res = await fetch('/api/chat/threads', { credentials: 'include' });
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(
			(typeof data?.message === 'string' && data.message.trim()) ||
				'Could not load chat threads.'
		);
	}
	const threads = Array.isArray(data.threads) ? data.threads : Array.isArray(data) ? data : [];
	const match = threads.find(
		(t) =>
			t &&
			(t.type === 'channel' || t.thread_type === 'channel') &&
			String(t.channel_slug || '').trim().toLowerCase() === 'challenges'
	);
	const id = Number(match?.id);
	if (!Number.isFinite(id) || id <= 0) {
		throw new Error('Could not find the #challenges channel.');
	}
	return id;
}

async function postThreadMessage(threadId, body) {
	const res = await fetch(`/api/chat/threads/${encodeURIComponent(String(threadId))}/messages`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ body: String(body || '') })
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		return { ok: false, error: data.message || data.error || 'Could not save' };
	}
	return { ok: true, message: data?.message || null };
}

async function patchThreadMessage(messageId, body) {
	const mid = Number(messageId);
	if (!Number.isFinite(mid) || mid <= 0) {
		return { ok: false, error: 'Invalid message id' };
	}
	const res = await fetch(`/api/chat/messages/${encodeURIComponent(String(mid))}`, {
		method: 'PATCH',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ body: String(body || '') })
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		return { ok: false, error: data.message || data.error || 'Could not update' };
	}
	return { ok: true, message: data?.message || null };
}

async function fetchThreadMessage(threadId, messageId) {
	const mid = Number(messageId);
	const tid = Number(threadId);
	if (!Number.isFinite(mid) || mid <= 0) {
		return { ok: false, error: 'Invalid message id' };
	}
	if (!Number.isFinite(tid) || tid <= 0) {
		return { ok: false, error: 'Invalid thread id' };
	}
	try {
		const msgs = await fetchAllChatThreadMessages(tid);
		const message = (msgs || []).find((m) => Number(m?.id) === mid) || null;
		if (!message) {
			return { ok: false, error: 'Challenge config message was not found on the server.' };
		}
		return { ok: true, message, messages: msgs };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error && err.message ? err.message : 'Could not load message'
		};
	}
}

function paintStatus(root, html) {
	root.innerHTML = `<div class="challenges-organize-status user-text">${html}</div>`;
}

function paintOrganizeLoading(root) {
	if (!(root instanceof HTMLElement)) return;
	root.setAttribute('aria-busy', 'true');
	root.setAttribute('aria-label', 'Loading');
	root.innerHTML = renderChallengesOrganizeBoardSkeleton();
}

function organizerModalIsOpen(host) {
	const modal = host?.querySelector?.('[data-challenges-organizer-modal]');
	return modal instanceof HTMLElement && modal.classList.contains('open');
}

function ensureOrganizeStaleBanner(root, onReload) {
	if (!(root instanceof HTMLElement)) return;
	let banner = root.querySelector('[data-organize-stale-banner]');
	if (!(banner instanceof HTMLElement)) {
		banner = document.createElement('div');
		banner.className = 'challenges-organize-stale-banner';
		banner.setAttribute('data-organize-stale-banner', '');
		banner.setAttribute('role', 'status');
		banner.innerHTML = `<span>Challenge data updated.</span>
			<button type="button" class="btn-outlined challenges-organize-stale-banner-reload" data-organize-stale-reload>Reload</button>`;
		root.prepend(banner);
		banner.querySelector('[data-organize-stale-reload]')?.addEventListener('click', () => {
			void onReload?.();
		});
	}
	banner.hidden = false;
}

function hideOrganizeStaleBanner(root) {
	const banner = root?.querySelector?.('[data-organize-stale-banner]');
	if (banner instanceof HTMLElement) banner.hidden = true;
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   messages: object[],
 *   viewer: { id: number | null, user_name: string },
 *   threadId: number
 * }} state
 */
function mountOrganizeFromState(root, state) {
	const { messages, viewer } = state;
	const organizerUserNames = resolveChallengeOrganizerAllowlistFromMessages(messages);
	if (!isChallengeChannelAdmin(viewer.user_name, organizerUserNames)) {
		paintStatus(
			root,
			`<p class="challenge-pane-muted">You are not on the challenge organizer team.</p>
			<p><a class="btn-outlined" href="/challenges">Back to Challenges</a></p>`
		);
		return null;
	}

	const globalConfig = pickLatestChallengesGlobalConfig(messages);
	let host = root.querySelector('.challenges-organize-host');
	if (!(host instanceof HTMLElement)) {
		host = document.createElement('div');
		host.className = 'challenges-organize-host';
		root.replaceChildren(host);
	}

	/** @type {null | (() => void)} */
	let teardown = null;
	/** @type {null | (() => void)} */
	let openGlobalSettingsFn = null;

	const persist = (msgs, tid) => {
		writeChallengesChannelCache({
			viewerId: viewer.id || 0,
			viewerUserName: viewer.user_name,
			threadId: tid,
			messages: msgs
		});
	};

	const remount = async () => {
		if (typeof teardown === 'function') {
			try {
				teardown();
			} catch {
				// ignore
			}
		}
		hideOrganizeStaleBanner(root);
		const tid = state.threadId;
		const msgs = await fetchAllChatThreadMessages(tid);
		persist(msgs, tid);
		const names = resolveChallengeOrganizerAllowlistFromMessages(msgs);
		const globalCfg = pickLatestChallengesGlobalConfig(msgs);
		const api = mountChallengesOrganizerTools(host, {
			messages: msgs,
			viewerId: viewer.id,
			viewerUserName: viewer.user_name,
			organizerUserNames: names,
			globalConfigMessageId:
				Number.isFinite(Number(globalCfg?.messageId)) && Number(globalCfg?.messageId) > 0
					? Number(globalCfg.messageId)
					: null,
			threadId: tid,
			postMessage: (body) => postThreadMessage(tid, body),
			patchMessage: (messageId, body) => patchThreadMessage(messageId, body),
			fetchMessage: (messageId) => fetchThreadMessage(tid, messageId),
			reload: remount
		});
		teardown = api.destroy;
		openGlobalSettingsFn = typeof api.openGlobalSettings === 'function' ? api.openGlobalSettings : null;
		state.messages = msgs;
	};

	const tid = state.threadId;
	const api = mountChallengesOrganizerTools(host, {
		messages,
		viewerId: viewer.id,
		viewerUserName: viewer.user_name,
		organizerUserNames,
		globalConfigMessageId:
			Number.isFinite(Number(globalConfig?.messageId)) && Number(globalConfig?.messageId) > 0
				? Number(globalConfig.messageId)
				: null,
		threadId: tid,
		postMessage: (body) => postThreadMessage(tid, body),
		patchMessage: (messageId, body) => patchThreadMessage(messageId, body),
		fetchMessage: (messageId) => fetchThreadMessage(tid, messageId),
		reload: remount
	});
	teardown = api.destroy;
	openGlobalSettingsFn = typeof api.openGlobalSettings === 'function' ? api.openGlobalSettings : null;
	persist(messages, tid);

	return {
		host,
		remount,
		openGlobalSettings: () => {
			if (typeof openGlobalSettingsFn === 'function') openGlobalSettingsFn();
		},
		isOceanman: () => isImpliedChallengeOrganizer(viewer.user_name),
		getFingerprint: () => challengesMessagesFingerprint(state.messages),
		replaceMessages: (msgs) => {
			state.messages = msgs;
		},
		destroy: () => {
			if (typeof teardown === 'function') {
				try {
					teardown();
				} catch {
					// ignore
				}
			}
			teardown = null;
			openGlobalSettingsFn = null;
			host.innerHTML = '';
		}
	};
}

/**
 * Mount organize board into a chat SPA messages host (or standalone root).
 * Stale-then-refresh via organize cache.
 *
 * @param {HTMLElement} root
 * @param {{
 *   threadId?: number | null,
 *   viewer?: { id: number | null, user_name: string } | null,
 *   onEligibility?: (eligible: boolean) => void,
 *   onOceanman?: (isOceanman: boolean) => void
 * }} [opts]
 * @returns {Promise<{
 *   destroy: () => void,
 *   remount: () => Promise<void>,
 *   openGlobalSettings: () => void,
 *   isOceanman: () => boolean
 * } | null>}
 */
export async function mountOrganizeLane(root, opts = {}) {
	if (!(root instanceof HTMLElement)) return null;

	paintOrganizeLoading(root);

	const threadIdPromise =
		Number.isFinite(Number(opts.threadId)) && Number(opts.threadId) > 0
			? Promise.resolve(Number(opts.threadId))
			: resolveChallengesThreadId();
	const abortEarlyNetwork = () => {
		void threadIdPromise.catch(() => {});
	};

	let viewer = opts.viewer && opts.viewer.user_name ? opts.viewer : null;
	try {
		if (!viewer?.user_name) {
			viewer = await fetchViewerProfileMini();
		}
		if (!viewer?.user_name) {
			abortEarlyNetwork();
			paintStatus(
				root,
				`<p class="challenge-pane-muted">Sign in with a username to open organizer tools.</p>
				<p><a class="btn-primary" href="/auth">Sign in</a></p>`
			);
			opts.onEligibility?.(false);
			return null;
		}
	} catch (err) {
		abortEarlyNetwork();
		const msg = err instanceof Error && err.message ? err.message : 'Could not load organizer.';
		paintStatus(
			root,
			`<p class="challenge-pane-form-error" role="alert">${esc(msg)}</p>
			<p><a class="btn-outlined" href="/challenges">Back to Challenges</a></p>`
		);
		opts.onEligibility?.(false);
		return null;
	}

	const cached = readChallengesChannelCache();
	const cacheForViewer =
		cached &&
		Number(cached.viewerId) === Number(viewer.id) &&
		String(cached.viewerUserName).toLowerCase() === String(viewer.user_name).toLowerCase()
			? cached
			: null;

	/** @type {{ messages: object[], viewer: typeof viewer, threadId: number }} */
	let state = {
		messages: [],
		viewer,
		threadId: 0
	};

	/** @type {ReturnType<typeof mountOrganizeFromState>} */
	let live = null;
	let paintedFromCache = false;
	let destroyed = false;

	const notifyChrome = () => {
		const eligible = Boolean(live);
		opts.onEligibility?.(eligible);
		opts.onOceanman?.(eligible ? isImpliedChallengeOrganizer(viewer.user_name) : false);
	};

	if (cacheForViewer && Array.isArray(cacheForViewer.messages)) {
		state.messages = cacheForViewer.messages;
		state.threadId = cacheForViewer.threadId;
		live = mountOrganizeFromState(root, state);
		paintedFromCache = Boolean(live);
		notifyChrome();
	}

	try {
		const cachedTid = paintedFromCache ? Number(cacheForViewer.threadId) : 0;
		const messagesFromCacheTidPromise =
			Number.isFinite(cachedTid) && cachedTid > 0
				? fetchAllChatThreadMessages(cachedTid)
				: null;

		const threadId = await threadIdPromise;
		if (destroyed) return null;
		const messages =
			messagesFromCacheTidPromise && threadId === cachedTid
				? await messagesFromCacheTidPromise
				: await fetchAllChatThreadMessages(threadId);
		if (destroyed) return null;

		const nextFp = challengesMessagesFingerprint(messages);
		const prevFp = paintedFromCache ? challengesMessagesFingerprint(state.messages) : '';

		writeChallengesChannelCache({
			viewerId: viewer.id || 0,
			viewerUserName: viewer.user_name,
			threadId,
			messages
		});

		if (!paintedFromCache) {
			state.messages = messages;
			state.threadId = threadId;
			live = mountOrganizeFromState(root, state);
			notifyChrome();
		} else {
			state.threadId = threadId;
			if (nextFp !== prevFp) {
				if (live?.host && organizerModalIsOpen(live.host)) {
					state.messages = messages;
					ensureOrganizeStaleBanner(root, async () => {
						if (typeof live?.remount === 'function') await live.remount();
						hideOrganizeStaleBanner(root);
						notifyChrome();
					});
				} else {
					state.messages = messages;
					live = mountOrganizeFromState(root, state);
					hideOrganizeStaleBanner(root);
					notifyChrome();
				}
			}
		}
	} catch (err) {
		if (paintedFromCache) {
			console.warn('[challenges-organize] refresh failed', err);
		} else {
			const msg = err instanceof Error && err.message ? err.message : 'Could not load organizer.';
			paintStatus(
				root,
				`<p class="challenge-pane-form-error" role="alert">${esc(msg)}</p>
				<p><a class="btn-outlined" href="/challenges">Back to Challenges</a></p>`
			);
			opts.onEligibility?.(false);
			return null;
		}
	}

	notifyChrome();

	return {
		destroy: () => {
			destroyed = true;
			if (typeof live?.destroy === 'function') {
				try {
					live.destroy();
				} catch {
					// ignore
				}
			}
			live = null;
			root.innerHTML = '';
		},
		remount: async () => {
			if (typeof live?.remount === 'function') {
				await live.remount();
				hideOrganizeStaleBanner(root);
				notifyChrome();
			}
		},
		/**
		 * Background reconcile after room dirty: fetch, fingerprint, soft apply.
		 * @returns {Promise<boolean>} true when UI remounted
		 */
		softRefresh: async () => {
			if (destroyed || !live) return false;
			const tid = Number(state.threadId);
			if (!Number.isFinite(tid) || tid <= 0) return false;
			const prevFp = challengesMessagesFingerprint(state.messages);
			const messages = await fetchAllChatThreadMessages(tid);
			if (destroyed) return false;
			writeChallengesChannelCache({
				viewerId: viewer.id || 0,
				viewerUserName: viewer.user_name,
				threadId: tid,
				messages
			});
			const nextFp = challengesMessagesFingerprint(messages);
			if (nextFp === prevFp) return false;
			state.messages = messages;
			if (live.host && organizerModalIsOpen(live.host)) {
				ensureOrganizeStaleBanner(root, async () => {
					if (typeof live?.remount === 'function') await live.remount();
					hideOrganizeStaleBanner(root);
					notifyChrome();
				});
				return false;
			}
			live = mountOrganizeFromState(root, state);
			hideOrganizeStaleBanner(root);
			notifyChrome();
			return true;
		},
		getFingerprint: () =>
			typeof live?.getFingerprint === 'function'
				? live.getFingerprint()
				: challengesMessagesFingerprint(state.messages),
		openGlobalSettings: () => {
			if (typeof live?.openGlobalSettings === 'function') live.openGlobalSettings();
		},
		isOceanman: () =>
			typeof live?.isOceanman === 'function'
				? live.isOceanman()
				: isImpliedChallengeOrganizer(viewer.user_name)
	};
}

async function bootOrganizePage() {
	const root = document.querySelector('[data-challenges-organize-root]');
	if (!(root instanceof HTMLElement)) return;
	await mountOrganizeLane(root);
}

if (document.body?.dataset?.entry === 'challenges-organize') {
	void bootOrganizePage();
}
