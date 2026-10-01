/**
 * In-shell mobile creation detail: seed-first hero + related grid in the chat overlay.
 * Standalone `/creations/:id` remains for desktop, share, and full chrome.
 */

import {
	readCreationDetailSeed,
	writeCreationDetailSeed,
	feedItemToCreationDetailSeed,
	creationDetailChromeHtmlFromSeed,
	bindCreationDetailDescriptionCollapse,
	applyViewerComposerCacheToSeed,
	readViewerComposerCache,
} from '../../shared/creationDetailSeed.js';

function assetQuery() {
	const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim();
	return v ? `?v=${encodeURIComponent(v)}` : '';
}

function escapeHtml(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function shouldUseInShellCreationDetail() {
	return false;
}

function seedToHeroHtml(seed, creationId) {
	const img =
		(typeof seed?.image_url === 'string' && seed.image_url.trim()) ||
		(typeof seed?.thumbnail_url === 'string' && seed.thumbnail_url.trim()) ||
		'';
	const title = typeof seed?.title === 'string' ? seed.title.trim() : '';
	const w = Number(seed?.width);
	const h = Number(seed?.height);
	const ratio = Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0 ? `${w} / ${h}` : '1 / 1';
	const chrome = creationDetailChromeHtmlFromSeed(seed);
	return `
		<div class="mobile-creation-detail" data-mobile-creation-detail="${creationId}">
			<div class="creation-detail-image-wrapper mobile-creation-detail-hero" style="--hero-aspect-ratio: ${ratio};">
				${img ? `<img class="mobile-creation-detail-img" src="${escapeHtml(img)}" alt="${escapeHtml(title || 'Creation')}" decoding="async">` : ''}
			</div>
			<div class="mobile-creation-detail-panel" data-mobile-creation-panel>
				${chrome}
				<div class="mobile-creation-detail-related" data-mobile-creation-related>
					<h2 class="mobile-creation-detail-related-heading">Related</h2>
					<div class="mobile-creation-detail-related-grid" data-mobile-creation-related-grid></div>
				</div>
			</div>
		</div>
	`;
}

async function hydrateFromApi(root, creationId, onNavigate) {
	try {
		const res = await fetch(`/api/create/images/${creationId}`, { credentials: 'include' });
		if (res.ok) {
			const creation = await res.json();
			const seed = applyViewerComposerCacheToSeed(feedItemToCreationDetailSeed({
				created_image_id: creation.id || creationId,
				image_url: creation.url || creation.image_url,
				thumbnail_url: creation.thumbnail_url,
				video_url: creation.video_url,
				media_type: creation.media_type,
				width: creation.width,
				height: creation.height,
				title: creation.title,
				summary: creation.summary || creation.description,
				like_count: creation.like_count,
				viewer_liked: creation.viewer_liked,
				nsfw: creation.nsfw,
				user_id: creation.user_id,
				author_user_name: creation.creator?.user_name,
				author_display_name: creation.creator?.display_name,
				author_avatar_url: creation.creator?.avatar_url,
				author_plan: creation.creator?.plan === 'founder' ? 'founder' : '',
				created_at: creation.created_at,
				published_at: creation.published_at || creation.created_at,
				published: creation.published,
				meta: creation.meta,
				comment_count: creation.comment_count,
			}));
			if (seed) writeCreationDetailSeed(seed);
			const imgEl = root.querySelector('.mobile-creation-detail-img');
			const nextUrl = seed?.image_url || seed?.thumbnail_url;
			if (imgEl instanceof HTMLImageElement && nextUrl && imgEl.src !== nextUrl) {
				imgEl.src = nextUrl;
			}
			const hero = root.querySelector('.mobile-creation-detail-hero');
			const w = Number(seed?.width);
			const h = Number(seed?.height);
			if (hero instanceof HTMLElement && Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
				hero.style.setProperty('--hero-aspect-ratio', `${w} / ${h}`);
			}
			const panel = root.querySelector('[data-mobile-creation-panel]');
			if (panel instanceof HTMLElement && seed) {
				replacePanelChrome(panel, seed);
			}
		}
	} catch {
		// keep seed paint
	}
	void loadRelated(root, creationId, onNavigate);
}

function relatedSectionHtml() {
	return `<div class="mobile-creation-detail-related" data-mobile-creation-related>
					<h2 class="mobile-creation-detail-related-heading">Related</h2>
					<div class="mobile-creation-detail-related-grid" data-mobile-creation-related-grid></div>
				</div>`;
}

/** Swap title/description from API without destroying live comments or the action strip. */
function replacePanelChrome(panel, seed) {
	const relatedEl = panel.querySelector('[data-mobile-creation-related]');
	const commentsEl = panel.querySelector('[data-creation-comments-host]');
	const stripEl = panel.querySelector('.creation-detail-action-strip');
	const relatedLive = relatedEl instanceof HTMLElement ? relatedEl : null;
	const commentsLive = commentsEl instanceof HTMLElement ? commentsEl : null;
	const stripLive = stripEl instanceof HTMLElement ? stripEl : null;
	panel.innerHTML = `${creationDetailChromeHtmlFromSeed(seed)}${relatedLive ? '' : relatedSectionHtml()}`;
	bindCreationDetailDescriptionCollapse(panel);
	const nextStrip = panel.querySelector('.creation-detail-action-strip');
	if (stripLive && nextStrip && nextStrip !== stripLive) {
		nextStrip.replaceWith(stripLive);
	}
	const nextComments = panel.querySelector('[data-creation-comments-host]');
	if (commentsLive && nextComments && nextComments !== commentsLive) {
		nextComments.replaceWith(commentsLive);
	}
	if (relatedLive) panel.appendChild(relatedLive);
}

function bindNativeActionStrip(root, creationId, onNavigate) {
	if (!(root instanceof HTMLElement) || root.dataset.nativeActionsBound === '1') return;
	root.dataset.nativeActionsBound = '1';
	void import(`/shared/likes.js${assetQuery()}`)
		.then((mod) => {
			const seed = readCreationDetailSeed(creationId);
			const likeBtn = root.querySelector('button[data-like-button]');
			if (likeBtn instanceof HTMLElement) {
				mod.initLikeButton(likeBtn, {
					id: creationId,
					like_count: seed?.like_count,
					viewer_liked: seed?.viewer_liked,
				});
			}
			mod.enableLikeButtons(root);
		})
		.catch(() => {});
	root.addEventListener('click', (e) => {
		const t = e.target;
		if (!(t instanceof Element)) return;
		const mutate = t.closest('[data-mutate-btn]');
		if (mutate instanceof HTMLElement) {
			e.preventDefault();
			if (typeof onNavigate === 'function') onNavigate(`/creations/${creationId}/mutate`);
			return;
		}
		const edit = t.closest('[data-edit-btn]');
		if (edit instanceof HTMLElement) {
			e.preventDefault();
			if (typeof onNavigate === 'function') onNavigate(`/creations/${creationId}/edit`);
			return;
		}
		const publish = t.closest('[data-publish-btn]');
		if (publish instanceof HTMLElement) {
			e.preventDefault();
			document.dispatchEvent(new CustomEvent('open-publish-modal', { detail: { creationId } }));
			return;
		}
		const share = t.closest('[data-share-btn]');
		if (share instanceof HTMLElement) {
			e.preventDefault();
			document.dispatchEvent(new CustomEvent('open-share-modal', { detail: { creationId } }));
			return;
		}
		const tip = t.closest('[data-tip-creator-button]');
		if (tip instanceof HTMLElement) {
			e.preventDefault();
			const seed = readCreationDetailSeed(creationId);
			document.dispatchEvent(
				new CustomEvent('open-tip-creator-modal', {
					detail: {
						userId: seed?.user_id,
						userName: seed?.author_user_name || seed?.author_display_name,
						createdImageId: creationId,
					},
				})
			);
		}
	});
}

function commentsViewerFromSeed(creationId) {
	const seed = readCreationDetailSeed(creationId);
	const cached = readViewerComposerCache() || {};
	const viewerId = Number(seed?.viewer_user_id ?? cached.userId ?? cached.id);
	return {
		id: Number.isFinite(viewerId) && viewerId > 0 ? viewerId : null,
		userName: String(seed?.viewer_user_name || cached.userName || '').trim(),
		displayName: String(seed?.viewer_display_name || cached.displayName || '').trim(),
		avatarUrl: String(seed?.viewer_avatar_url || cached.avatarUrl || '').trim(),
		plan: seed?.viewer_plan === 'founder' || cached.plan === 'founder' ? 'founder' : '',
	};
}

async function mountCommentsIfNeeded(root, creationId, state) {
	const host = root.querySelector('[data-creation-comments-host]');
	if (state.torn) return;
	if (!(host instanceof HTMLElement)) {
		if (typeof state.teardown === 'function') {
			try {
				state.teardown();
			} catch {
				// ignore
			}
			state.teardown = null;
			state.mountedHost = null;
			state.pendingHost = null;
		}
		return;
	}
	if (state.mountedHost === host || state.pendingHost === host) return;
	if (typeof state.teardown === 'function') {
		try {
			state.teardown();
		} catch {
			// ignore
		}
		state.teardown = null;
		state.mountedHost = null;
	}
	state.pendingHost = host;
	const gen = ++state.gen;
	const { mountCreationCommentsThread } = await import(`/shared/creationCommentsThread.js${assetQuery()}`);
	if (state.torn || gen !== state.gen) {
		if (state.pendingHost === host) state.pendingHost = null;
		return;
	}
	const hostNow = root.querySelector('[data-creation-comments-host]');
	if (hostNow !== host) {
		if (state.pendingHost === host) state.pendingHost = null;
		await mountCommentsIfNeeded(root, creationId, state);
		return;
	}
	const seedCount = Object.prototype.hasOwnProperty.call(host.dataset, 'seedCommentCount')
		? Number(host.dataset.seedCommentCount)
		: NaN;
	const handle = await mountCreationCommentsThread(host, {
		createdImageId: creationId,
		initialCommentCount: Number.isFinite(seedCount) && seedCount >= 0 ? seedCount : undefined,
		viewer: commentsViewerFromSeed(creationId),
		autoScrollOnHash: true,
	});
	if (state.torn || gen !== state.gen) {
		try {
			handle?.teardown?.();
		} catch {
			// ignore
		}
		return;
	}
	state.teardown = handle?.teardown ?? null;
	state.mountedHost = host;
	if (state.pendingHost === host) state.pendingHost = null;
}

async function loadRelated(root, creationId, onNavigate) {
	const grid = root.querySelector('[data-mobile-creation-related-grid]');
	if (!(grid instanceof HTMLElement)) return;
	try {
		const res = await fetch(`/api/creations/${creationId}/related?limit=12`, { credentials: 'include' });
		if (!res.ok) return;
		const data = await res.json().catch(() => ({}));
		const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.creations) ? data.creations : [];
		grid.innerHTML = '';
		for (const item of items) {
			const cid = Number(item?.created_image_id ?? item?.id);
			if (!Number.isFinite(cid) || cid <= 0) continue;
			const thumb =
				(typeof item.thumbnail_url === 'string' && item.thumbnail_url.trim()) ||
				(typeof item.image_url === 'string' && item.image_url.trim()) ||
				'';
			const a = document.createElement('a');
			a.className = 'mobile-creation-detail-related-card';
			a.href = `/creations/${cid}?from=${encodeURIComponent(String(creationId))}`;
			a.addEventListener('click', (ev) => {
				ev.preventDefault();
				const nextSeed = feedItemToCreationDetailSeed(item) || { id: cid, image_url: thumb, thumbnail_url: thumb };
				writeCreationDetailSeed(nextSeed);
				if (typeof onNavigate === 'function') onNavigate(a.getAttribute('href') || `/creations/${cid}`);
			});
			if (thumb) {
				const img = document.createElement('img');
				img.src = thumb;
				img.alt = '';
				img.loading = 'lazy';
				img.decoding = 'async';
				a.appendChild(img);
			}
			grid.appendChild(a);
		}
	} catch {
		// ignore
	}
}

/**
 * @param {HTMLElement} rootEl
 * @param {{ creationId: number, onNavigate?: (href: string) => void }} opts
 */
export function mountInShellCreationDetail(rootEl, opts) {
	if (!(rootEl instanceof HTMLElement)) return () => {};
	const creationId = Number(opts?.creationId);
	if (!Number.isFinite(creationId) || creationId <= 0) return () => {};
	const seed = applyViewerComposerCacheToSeed(readCreationDetailSeed(creationId));
	rootEl.innerHTML = seedToHeroHtml(seed, creationId);
	bindCreationDetailDescriptionCollapse(rootEl);
	bindNativeActionStrip(rootEl, creationId, opts.onNavigate);
	rootEl.scrollTop = 0;
	const commentsState = { torn: false, gen: 0, teardown: null, mountedHost: null, pendingHost: null };
	void mountCommentsIfNeeded(rootEl, creationId, commentsState);
	void hydrateFromApi(rootEl, creationId, opts.onNavigate).then(() => {
		void mountCommentsIfNeeded(rootEl, creationId, commentsState);
	});
	return () => {
		commentsState.torn = true;
		commentsState.gen += 1;
		if (typeof commentsState.teardown === 'function') {
			try {
				commentsState.teardown();
			} catch {
				// ignore
			}
		}
		commentsState.teardown = null;
		commentsState.mountedHost = null;
		rootEl.innerHTML = '';
	};
}
