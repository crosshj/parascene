/**
 * Chat-only runtime fixes loaded after the Rollup bundle (see pages/chat.html).
 * Groups consecutive share-link / upload media embeds in message bubbles.
 */
function assetQuery() {
	const v = document.querySelector('meta[name="asset-version"]')?.content?.trim();
	return v ? `?v=${encodeURIComponent(v)}` : '';
}

function isWhitespaceOnlyInlineMediaGap(node) {
	return node.nodeType === Node.TEXT_NODE && /^\s*$/.test(node.textContent || '');
}

const INLINE_MEDIA_GROUP_MIN_ITEMS = 4;

function isUngroupedInlineMediaGroupMember(el) {
	return el instanceof HTMLElement && !el.closest('.user-text-inline-media-group');
}

function isGroupableInlineImageWrap(el) {
	return (
		isUngroupedInlineMediaGroupMember(el) && el.classList.contains('user-text-inline-image-wrap')
	);
}

function isGroupableChatCreationEmbed(el) {
	if (!isUngroupedInlineMediaGroupMember(el)) return false;
	if (!el.classList.contains('connect-chat-creation-embed')) return false;
	if (el.classList.contains('connect-chat-creation-embed--error')) return false;
	if (el.querySelector('.connect-chat-creation-embed-inner--group-carousel')) return false;
	if (el.querySelector('[data-generic-video-embed]')) return false;
	return true;
}

function isInlineMediaGroupUnit(el) {
	return isGroupableInlineImageWrap(el) || isGroupableChatCreationEmbed(el);
}

function domNodesForInlineMediaGroupUnit(unit) {
	if (isGroupableChatCreationEmbed(unit)) {
		const nodes = [];
		let prev = unit.previousSibling;
		while (prev && isWhitespaceOnlyInlineMediaGap(prev)) prev = prev.previousSibling;
		if (
			prev instanceof HTMLAnchorElement &&
			prev.classList.contains('connect-chat-creation-embed-paired-link')
		) {
			nodes.push(prev);
		}
		nodes.push(unit);
		return nodes;
	}
	return [unit];
}

function skipInlineMediaGroupGaps(nodes, startIdx) {
	let i = startIdx;
	let brCount = 0;
	while (i < nodes.length) {
		const node = nodes[i];
		if (isWhitespaceOnlyInlineMediaGap(node)) {
			i += 1;
			continue;
		}
		if (node instanceof HTMLBRElement) {
			brCount += 1;
			if (brCount >= 2) return { nextIdx: i, paragraphBreak: true };
			i += 1;
			continue;
		}
		break;
	}
	return { nextIdx: i, paragraphBreak: false };
}

function resolveInlineMediaGroupUnitAt(nodes, i) {
	const node = nodes[i];
	if (node instanceof HTMLElement && isInlineMediaGroupUnit(node)) {
		return { unit: node, nextIdx: i + 1 };
	}
	if (
		node instanceof HTMLAnchorElement &&
		node.classList.contains('connect-chat-creation-embed-paired-link')
	) {
		let j = i + 1;
		while (j < nodes.length && isWhitespaceOnlyInlineMediaGap(nodes[j])) j += 1;
		const maybe = nodes[j];
		if (maybe instanceof HTMLElement && isGroupableChatCreationEmbed(maybe)) {
			return { unit: maybe, nextIdx: j + 1 };
		}
	}
	return null;
}

function stripBridgesBetweenUnits(container, units) {
	for (let u = 0; u < units.length - 1; u += 1) {
		const lastNodes = domNodesForInlineMediaGroupUnit(units[u]);
		const firstNodes = domNodesForInlineMediaGroupUnit(units[u + 1]);
		const endNode = lastNodes[lastNodes.length - 1];
		const startNode = firstNodes[0];
		if (!endNode?.parentNode || !startNode) continue;
		let n = endNode.nextSibling;
		while (n && n !== startNode) {
			const next = n.nextSibling;
			if (n instanceof HTMLBRElement || isWhitespaceOnlyInlineMediaGap(n)) {
				container.removeChild(n);
			}
			n = next;
		}
	}
}

function mountInlineMediaGroup(container, units) {
	if (units.length < INLINE_MEDIA_GROUP_MIN_ITEMS) return;
	stripBridgesBetweenUnits(container, units);
	const firstDomNodes = domNodesForInlineMediaGroupUnit(units[0]);
	const anchor = firstDomNodes[0];
	if (!(anchor instanceof Node) || !anchor.parentNode) return;

	const group = document.createElement('div');
	group.className = 'user-text-inline-media-group';
	group.dataset.inlineImageGroup = '1';
	container.insertBefore(group, anchor);
	for (const unit of units) {
		for (const node of domNodesForInlineMediaGroupUnit(unit)) {
			group.appendChild(node);
		}
	}

	const countEl = document.createElement('span');
	countEl.className = 'user-text-inline-media-group-count';
	countEl.setAttribute('aria-hidden', 'true');
	countEl.textContent = String(units.length);
	group.appendChild(countEl);

	const firstLink = group.querySelector('a.user-text-inline-image-link');
	if (firstLink instanceof HTMLAnchorElement) {
		firstLink.setAttribute('aria-label', `View media (${units.length})`);
	}
	const firstVideoInner = group.querySelector('.connect-chat-creation-embed-inner--video');
	if (firstVideoInner instanceof HTMLElement) {
		firstVideoInner.setAttribute('aria-label', `View videos (${units.length})`);
		firstVideoInner.setAttribute('title', `View videos (${units.length})`);
	}
}

function hydrateConsecutiveInlineImageGroups(rootEl) {
	const root =
		rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;

	const containers = new Set();
	for (const el of root.querySelectorAll(
		'.user-text-inline-image-wrap, .connect-chat-creation-embed'
	)) {
		if (el.closest('.user-text-inline-media-group')) continue;
		const parent = el.parentElement;
		if (parent) containers.add(parent);
	}

	for (const container of containers) {
		const nodes = Array.from(container.childNodes);
		const runs = [];
		let run = [];
		let i = 0;
		while (i < nodes.length) {
			const gap = skipInlineMediaGroupGaps(nodes, i);
			if (gap.paragraphBreak && run.length > 0) {
				if (run.length >= INLINE_MEDIA_GROUP_MIN_ITEMS) runs.push(run);
				run = [];
			}
			i = gap.nextIdx;
			if (i >= nodes.length) break;

			const resolved = resolveInlineMediaGroupUnitAt(nodes, i);
			if (resolved) {
				run.push(resolved.unit);
				i = resolved.nextIdx;
				continue;
			}
			if (run.length >= INLINE_MEDIA_GROUP_MIN_ITEMS) runs.push(run);
			run = [];
			i += 1;
		}
		if (run.length >= INLINE_MEDIA_GROUP_MIN_ITEMS) runs.push(run);

		for (const units of runs) {
			mountInlineMediaGroup(container, units);
		}
		trimBridgesTrailingMediaGroup(container);
	}
}

function trimBridgesTrailingMediaGroup(container) {
	if (!(container instanceof HTMLElement)) return;
	for (const group of container.querySelectorAll('.user-text-inline-media-group')) {
		let n = group.nextSibling;
		while (n instanceof HTMLBRElement) {
			const rm = n;
			n = n.nextSibling;
			container.removeChild(rm);
		}
	}
}

function collectInlineMediaGroupGallery(groupEl, clickedLink = null, clickedEmbed = null) {
	const out = {
		slides: [],
		galleryUrls: [],
		galleryImgs: [],
		galleryIndex: 0,
		creationId: '',
		videoSlides: [],
	};
	if (!(groupEl instanceof HTMLElement)) return out;

	const pushImageSlide = (url, creationId, sourceImg) => {
		const src = String(url || '').trim();
		if (!src) return;
		const cid = String(creationId || '').trim();
		out.slides.push({
			kind: 'image',
			url: src,
			creationId: cid,
			...(sourceImg instanceof HTMLImageElement ? { sourceImg } : {}),
		});
		if (sourceImg instanceof HTMLImageElement) out.galleryImgs.push(sourceImg);
		out.galleryUrls.push(src);
	};

	const pushVideoSlide = (url, creationId, sourceVideo, posterUrl) => {
		const src = String(url || '').trim();
		if (!src) return;
		const cid = String(creationId || '').trim();
		out.slides.push({
			kind: 'video',
			url: src,
			creationId: cid,
			...(sourceVideo instanceof HTMLVideoElement ? { sourceVideo } : {}),
			...(posterUrl ? { posterUrl: String(posterUrl).trim() } : {}),
		});
		out.videoSlides.push({ url: src, creationId: cid });
	};

	for (const child of groupEl.children) {
		if (!(child instanceof HTMLElement)) continue;
		if (child.classList.contains('user-text-inline-media-group-count')) continue;
		if (child.classList.contains('connect-chat-creation-embed-paired-link')) continue;

		if (child.classList.contains('user-text-inline-image-wrap')) {
			const img = child.querySelector('img.user-text-inline-image');
			if (!(img instanceof HTMLImageElement)) continue;
			pushImageSlide(img.currentSrc || img.getAttribute('src') || '', '', img);
			continue;
		}

		if (!child.classList.contains('connect-chat-creation-embed')) continue;

		const creationId = String(child.getAttribute('data-creation-id') || '').trim();
		const vid = child.querySelector('video.connect-chat-creation-embed-video');
		if (vid instanceof HTMLVideoElement) {
			pushVideoSlide(
				vid.currentSrc || vid.getAttribute('src') || '',
				creationId,
				vid,
				vid.getAttribute('poster') || ''
			);
			continue;
		}
		const img = child.querySelector('img.connect-chat-creation-embed-img');
		if (img instanceof HTMLImageElement) {
			pushImageSlide(img.currentSrc || img.getAttribute('src') || '', creationId, img);
		}
	}

	out.galleryUrls = out.galleryUrls.filter(Boolean);
	out.galleryImgs = out.galleryImgs.filter((img) => img instanceof HTMLImageElement);

	const slideIndexForEmbed = (embed) => {
		if (!(embed instanceof HTMLElement)) return -1;
		const cid = String(embed.getAttribute('data-creation-id') || '').trim();
		const video = embed.querySelector('video.connect-chat-creation-embed-video');
		if (video instanceof HTMLVideoElement) {
			const url = String(video.currentSrc || video.getAttribute('src') || '').trim();
			return out.slides.findIndex(
				(slide) =>
					slide.kind === 'video' &&
					slide.url === url &&
					(!cid || slide.creationId === cid)
			);
		}
		const image = embed.querySelector('img.connect-chat-creation-embed-img');
		if (image instanceof HTMLImageElement) {
			const url = String(image.currentSrc || image.getAttribute('src') || '').trim();
			return out.slides.findIndex(
				(slide) =>
					slide.kind === 'image' &&
					slide.url === url &&
					(!cid || slide.creationId === cid)
			);
		}
		return -1;
	};

	if (clickedEmbed instanceof HTMLElement) {
		const idx = slideIndexForEmbed(clickedEmbed);
		if (idx >= 0) out.galleryIndex = idx;
		out.creationId = String(clickedEmbed.getAttribute('data-creation-id') || '').trim();
	} else if (clickedLink instanceof HTMLAnchorElement) {
		const embedWrap = clickedLink.closest('.connect-chat-creation-embed');
		if (embedWrap instanceof HTMLElement) {
			const idx = slideIndexForEmbed(embedWrap);
			if (idx >= 0) out.galleryIndex = idx;
			out.creationId = String(embedWrap.getAttribute('data-creation-id') || '').trim();
		} else {
			const thumb = clickedLink.querySelector('img.user-text-inline-image');
			if (thumb instanceof HTMLImageElement) {
				const url = String(thumb.currentSrc || thumb.getAttribute('src') || '').trim();
				const idx = out.slides.findIndex((slide) => slide.kind === 'image' && slide.url === url);
				if (idx >= 0) out.galleryIndex = idx;
			}
		}
	}

	return out;
}

let hydrateScheduled = false;
const hydratePendingRoots = new Set();

function scheduleHydrateInlineImageGroups(root) {
	if (!(root instanceof Element)) return;
	hydratePendingRoots.add(root);
	if (hydrateScheduled) return;
	hydrateScheduled = true;
	requestAnimationFrame(() => {
		hydrateScheduled = false;
		const roots = Array.from(hydratePendingRoots);
		hydratePendingRoots.clear();
		for (const r of roots) {
			try {
				hydrateConsecutiveInlineImageGroups(r);
			} catch {
				// ignore
			}
		}
	});
}

function scanHydrateRoots() {
	for (const sel of ['[data-chat-messages]', '[data-chat-canvas-body-view]']) {
		const el = document.querySelector(sel);
		if (el instanceof HTMLElement) {
			scheduleHydrateInlineImageGroups(el);
			for (const bubble of el.querySelectorAll(
				'.connect-chat-msg-bubble, .chat-page-canvas-body-view, .comment-text'
			)) {
				trimBridgesTrailingMediaGroup(bubble);
			}
		}
	}
}

function observeHydrateRoots() {
	const seen = new WeakSet();
	const attach = (el) => {
		if (!(el instanceof HTMLElement) || seen.has(el)) return;
		seen.add(el);
		scheduleHydrateInlineImageGroups(el);
		const mo = new MutationObserver(() => {
			scheduleHydrateInlineImageGroups(el);
		});
		mo.observe(el, { childList: true, subtree: true });
	};

	for (const sel of ['[data-chat-messages]', '[data-chat-canvas-body-view]']) {
		const el = document.querySelector(sel);
		if (el) attach(el);
	}

	const rootMo = new MutationObserver(() => {
		for (const sel of ['[data-chat-messages]', '[data-chat-canvas-body-view]']) {
			const el = document.querySelector(sel);
			if (el) attach(el);
		}
	});
	const chatPage = document.querySelector('[data-chat-page]');
	if (chatPage instanceof HTMLElement) {
		rootMo.observe(chatPage, { childList: true, subtree: true });
	}
}

scanHydrateRoots();
observeHydrateRoots();

/** @type {Promise<object> | null} */
let lightboxModPromise = null;
function loadLightboxMod() {
	if (!lightboxModPromise) {
		lightboxModPromise = import(`/shared/chatInlineImageLightbox.js${assetQuery()}`);
	}
	return lightboxModPromise;
}

document.addEventListener(
	'click',
	(e) => {
		const chatPage = document.querySelector('[data-chat-page]');
		if (!(chatPage instanceof HTMLElement) || !(e.target instanceof Element)) return;
		if (!chatPage.contains(e.target)) return;

		if (e.target.closest('.connect-chat-creation-embed-inner--group-carousel')) return;
		if (e.target.closest('.connect-chat-creation-embed-group-nav')) return;

		const scope = e.target.closest(
			'.connect-chat-msg-bubble, .chat-page-canvas-body-view, .comment-text'
		);
		if (!scope) return;

		const videoInner = e.target.closest('.connect-chat-creation-embed-inner--video');
		if (videoInner instanceof HTMLElement && scope.contains(videoInner)) {
			const wrap = videoInner.closest('.connect-chat-creation-embed');
			const vid = wrap?.querySelector?.('.connect-chat-creation-embed-video');
			if (!(vid instanceof HTMLVideoElement)) return;
			const src = String(vid.currentSrc || vid.getAttribute('src') || '').trim();
			if (!src) return;
			const inlineMediaGroup = wrap?.closest?.('.user-text-inline-media-group');
			if (!(inlineMediaGroup instanceof HTMLElement)) return;

			e.preventDefault();
			e.stopImmediatePropagation();

			void loadLightboxMod().then(
				({ openChatInlineMediaGroupLightbox, openChatAttachmentPreviewLightbox }) => {
					const gallery = collectInlineMediaGroupGallery(
						inlineMediaGroup,
						null,
						wrap instanceof HTMLElement ? wrap : null
					);
					const creationId =
						gallery.creationId ||
						(wrap instanceof HTMLElement
							? String(wrap.getAttribute('data-creation-id') || '').trim()
							: '');
					if (gallery.slides.length > 1) {
						openChatInlineMediaGroupLightbox(gallery.slides, {
							galleryLabel: 'Media',
							startIndex: gallery.galleryIndex,
							autoAdvanceOnEnded: false,
							loopPerSlide: true,
							loopGallery: true,
							creationId,
						});
						return;
					}
					openChatAttachmentPreviewLightbox(src, 'video', {
						...(creationId ? { creationId } : {}),
						sourceVideo: vid,
					});
				}
			);
			return;
		}

		const a = e.target.closest('a.user-text-inline-image-link');
		if (!(a instanceof HTMLAnchorElement)) return;
		if (!scope.contains(a)) return;

		const inlineMediaGroup = a.closest('.user-text-inline-media-group');
		if (!(inlineMediaGroup instanceof HTMLElement)) return;

		e.preventDefault();
		e.stopImmediatePropagation();

		void loadLightboxMod().then(({ openChatInlineMediaGroupLightbox, openChatInlineImageLightbox }) => {
			const thumb =
				a.querySelector('img.user-text-inline-image') ||
				a.querySelector('img.connect-chat-creation-embed-img');
			let src = '';
			if (thumb instanceof HTMLImageElement) {
				src = thumb.currentSrc || thumb.getAttribute('src') || '';
			}
			if (!src) src = a.getAttribute('href') || '';

			const embedWrap = a.closest('.connect-chat-creation-embed');
			let creationId =
				embedWrap instanceof HTMLElement
					? String(embedWrap.getAttribute('data-creation-id') || '').trim()
					: '';

			const gallery = collectInlineMediaGroupGallery(inlineMediaGroup, a);
			if (gallery.creationId) creationId = gallery.creationId;

			if (gallery.slides.length > 1) {
				openChatInlineMediaGroupLightbox(gallery.slides, {
					galleryLabel: 'Media',
					startIndex: gallery.galleryIndex,
					autoAdvanceOnEnded: false,
					loopPerSlide: true,
					loopGallery: true,
					creationId,
				});
				return;
			}

			openChatInlineImageLightbox(src, {
				...(creationId ? { creationId } : {}),
				...(gallery.galleryUrls.length > 1
					? {
							galleryUrls: gallery.galleryUrls,
							galleryImgs: gallery.galleryImgs,
							galleryIndex: gallery.galleryIndex,
						}
					: {}),
				...(thumb instanceof HTMLImageElement ? { sourceImg: thumb } : {}),
			});
		});
	},
	true
);
