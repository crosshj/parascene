import { bindRefs, mountTemplate } from '../../utils/dom.js';
import { createCreationMediaLoader, creationCardMarkup } from '../../shared/creationGrid.js';
import template from './CreationsView.html';
import './CreationsView.css';
import '../../components/CreationGrid/CreationGrid.css';

const PAGE_SIZE = 50;
const LOOKAHEAD_SKELETONS = 16;
const IN_FLIGHT_POLL_MS = 3000;
const IN_FLIGHT_STATUSES = new Set(['creating', 'pending', 'queued', 'processing', 'running']);

function makeGridSkeleton() {
	const tile = document.createElement('div');
	tile.className = 'skeleton-grid-tile';
	tile.setAttribute('aria-hidden', 'true');
	return tile;
}

function creationId(item) {
 if (String(item?.id).startsWith("pending-")) return String(item.id);
	const id = Number(item?.created_image_id ?? item?.id);
	return Number.isFinite(id) && id > 0 ? String(id) : '';
}

function makeCreationCard(item, markup = creationCardMarkup(item)) {
	const fragment = document.createRange().createContextualFragment(markup);
	const card = fragment.firstElementChild;
	if (card) {
		card.__creationRecord = item;
		card.__creationMarkup = markup;
	}
	return card;
}

function updateCreationCard(card, item, markup) {
	if (card.__creationMarkup !== markup) {
		const nextCard = makeCreationCard(item, markup);
		if (!nextCard) return false;
		const currentMedia = card.querySelector('.feed-card-image');
		const nextMedia = nextCard.querySelector('.feed-card-image');
		const mediaUrlChanged = currentMedia?.dataset.bgUrl !== nextMedia?.dataset.bgUrl;
		const currentImage = currentMedia?.querySelector('.feed-card-img');
		const imageRequestMissing = Boolean(currentMedia?.dataset.bgUrl && !currentMedia?.dataset.bgLoadedUrl && !currentImage?.getAttribute('src'));
		for (const attr of [...card.attributes]) {
			if (!nextCard.hasAttribute(attr.name)) card.removeAttribute(attr.name);
		}
		for (const attr of [...nextCard.attributes]) card.setAttribute(attr.name, attr.value);
		if (mediaUrlChanged || imageRequestMissing) card.replaceChildren(...nextCard.childNodes);
		else {
			const nextImage = nextMedia?.querySelector('.feed-card-img');
			const nextClass = nextMedia?.className || '';
			if (currentMedia) {
				// The retained media keeps its request and carousel state. Replacing
				// all classes hides loaded images without triggering another load.
				const mediaClasses = ['loading', 'loaded', 'error', 'feed-card-image--group-host', 'feed-card-image--group-carousel']
					.filter((name) => currentMedia.classList.contains(name));
				currentMedia.className = nextClass;
				currentMedia.classList.add(...mediaClasses);
			}
			if (currentImage && nextImage) {
				currentImage.className = nextImage.className;
				currentImage.alt = nextImage.alt;
			}
			for (const selector of ['.creation-grid__status', '.creation-grid__nsfw-badge', '.route-media-challenge-blur-overlay', '.creation-challenge-entered-badge', '.creation-published-badge', '.creation-challenge-locked-badge', '.creation-group-badge', '.creation-music-badge', '.creation-video-badge']) {
				currentMedia?.querySelectorAll(selector).forEach((node) => node.remove());
				nextMedia?.querySelectorAll(selector).forEach((node) => currentMedia?.append(node.cloneNode(true)));
			}
		}
		card.__creationMarkup = markup;
		card.__creationRecord = item;
		return mediaUrlChanged || imageRequestMissing;
	}
	card.__creationRecord = item;
	return false;
}

export function renderCreationsView({ outlet, creationsProvider, creationsApi, creationsQuery, pendingCreations, onUnauthorized, setHeaderMenu, onOpenCreation }) {
	const root = mountTemplate(outlet, template);
	const refs = bindRefs(root);
	let offset = 0;
	let hasMore = false;
	let loading = false;
	let lastQueryData = null;
	let unsubscribe;
	let pollTimer = 0;
	let pollInProgress = false;
	const scrollRegion = root.closest('.beta-outlet__scroll');
	const mediaLoader = createCreationMediaLoader(refs.grid, {
		thumbnails: creationsProvider?.thumbnails,
		preloadRoot: scrollRegion,
		preloadMargin: '2000px 0px',
	});
	for (let i = 0; i < 25; i += 1) refs.grid.append(makeGridSkeleton());
	const onGridClick = (event) => {
		const card = event.target.closest?.('[data-creation-id]');
		const id = Number(card?.dataset?.creationId);
		if (card && Number.isFinite(id) && id > 0) onOpenCreation?.(id, card.__creationRecord || null);
	};
	refs.grid.addEventListener('click', onGridClick);
	document.addEventListener('visibilitychange', onVisibilityChange);
	document.addEventListener('creation-detail:mutation', onCreationDetailMutation);
 document.addEventListener('creations-pending-updated', onPendingCreationsUpdated);
	refs.grid.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		const card = event.target.closest?.('[data-creation-id]');
		if (!card) return;
		event.preventDefault();
		const id = Number(card.dataset.creationId);
		if (Number.isFinite(id) && id > 0) onOpenCreation?.(id, card.__creationRecord || null);
	});

	document.title = 'Creations · parascene beta';
	setHeaderMenu?.({
		label: 'Creations',
		items: [{ label: 'Refresh', action: 'refresh' }],
		onSelect: ({ action }) => { if (action === 'refresh') void refresh(true); }
	});

	function showState(message, error = false) {
		refs.status.hidden = false;
		refs.status.classList.toggle('is-error', error);
		refs.status.textContent = message;
	}

	function removeGridSkeletons() {
		refs.grid.querySelectorAll('.skeleton-grid-tile').forEach((element) => element.remove());
	}

	function syncGridSkeletons(count) {
		const skeletons = [...refs.grid.querySelectorAll('.skeleton-grid-tile')];
		for (const tile of skeletons.slice(count)) tile.remove();
		for (let i = skeletons.length; i < count; i += 1) refs.grid.append(makeGridSkeleton());
	}

	function render(data, append = false) {
		const items = Array.isArray(data?.creations) ? data.creations : [];
		const currentCards = [...refs.grid.querySelectorAll('.creation-grid__card')];
		const currentById = new Map(currentCards.map((card) => [card.dataset.creationId, card]).filter(([id]) => id));
		const desiredItems = append
			? currentCards.map((card) => card.__creationRecord).filter(item => item && !item.__optimistic)
			: [];
		const desiredIndexById = new Map(desiredItems.map((item, index) => [creationId(item), index]).filter(([id]) => id));
		for (const item of items) {
			const id = creationId(item);
			const existingIndex = id ? desiredIndexById.get(id) : undefined;
			if (existingIndex !== undefined) desiredItems[existingIndex] = item;
			else {
				if (id) desiredIndexById.set(id, desiredItems.length);
				desiredItems.push(item);
			}
		}

  const optimistic = pendingCreations?.reconcile(desiredItems) || [];
  desiredItems.unshift(...optimistic);
		const desiredCards = [];
		const cardsToHydrate = [];
		const retainedCards = new Set();
		for (const item of desiredItems) {
			const id = creationId(item);
			const markup = creationCardMarkup(item);
			const card = id ? currentById.get(id) : null;
			if (card) {
				if (updateCreationCard(card, item, markup)) cardsToHydrate.push(card);
				retainedCards.add(card);
				desiredCards.push(card);
			} else {
				const nextCard = makeCreationCard(item, markup);
				if (nextCard) {
					desiredCards.push(nextCard);
					cardsToHydrate.push(nextCard);
				}
			}
		}
		for (const card of currentCards) if (!retainedCards.has(card)) card.remove();
		let position = refs.grid.firstElementChild;
		for (const card of desiredCards) {
			if (position !== card) refs.grid.insertBefore(card, position || refs.sentinel);
			position = card.nextElementSibling;
		}

		const hasCards = desiredCards.length > 0;
		refs.grid.hidden = !hasCards;
		if (!hasCards) showState('No creations yet. Start creating to see your work here.');
		else refs.status.hidden = true;
		if (!append) hasMore = data?.has_more === true && items.length > 0;
		syncGridSkeletons(hasMore ? LOOKAHEAD_SKELETONS : 0);
		// Observe at the loaded-card edge without letting the sentinel occupy a
		// grid cell. The look-ahead tiles then fill any partial row naturally.
		refs.sentinel.hidden = !hasMore;
		const lastCard = desiredCards[desiredCards.length - 1];
		refs.sentinel.style.top = lastCard
			? `${lastCard.offsetTop + lastCard.offsetHeight}px`
			: '0px';
		if (refs.sentinel.parentElement !== refs.grid || refs.grid.lastElementChild !== refs.sentinel) {
			refs.grid.append(refs.sentinel);
		}
		// The list is newest first; scrolling older pages must not displace these.
		creationsProvider?.thumbnails?.retain(desiredCards.slice(0, 30)
			.map(card => card.querySelector('.feed-card-image')?.dataset.bgUrl || ''));
		if (cardsToHydrate.length) mediaLoader.observe(cardsToHydrate);
		syncInFlightPolling();
	}

	function inFlightIds() {
		return [...refs.grid.querySelectorAll('.creation-grid__card[data-creation-id][data-creation-status]')]
			.filter((card) => IN_FLIGHT_STATUSES.has(String(card.dataset.creationStatus || '').toLowerCase()))
			.map((card) => card.dataset.creationId).filter(id => Number.isInteger(Number(id)) && Number(id) > 0);
	}

	function scheduleInFlightPoll(delay = IN_FLIGHT_POLL_MS) {
		if (pollTimer || pollInProgress || !root.isConnected || document.visibilityState === 'hidden' || !inFlightIds().length) return;
		pollTimer = window.setTimeout(() => {
			pollTimer = 0;
			void pollInFlightCreations();
		}, delay);
	}

	function syncInFlightPolling() {
		if (!inFlightIds().length || document.visibilityState === 'hidden') {
			window.clearTimeout(pollTimer);
			pollTimer = 0;
			return;
		}
		scheduleInFlightPoll(0);
	}

	async function pollInFlightCreations() {
		if (pollInProgress || !root.isConnected || document.visibilityState === 'hidden') return;
		const ids = inFlightIds();
		if (!ids.length) return;
		pollInProgress = true;
		try {
			const batches = [];
			for (let index = 0; index < ids.length; index += 100) batches.push(ids.slice(index, index + 100));
			const results = await Promise.all(batches.map((batch) => creationsApi.list({ ids: batch })));
			const creations = results.flatMap((result) => result.creations || []);
			if (root.isConnected && creations.length) {
				mergeServerRows(creations);
				const previouslyInFlight = new Set(ids);
				const completed = creations.filter((item) => previouslyInFlight.has(creationId(item)) && !IN_FLIGHT_STATUSES.has(String(item?.status || '').toLowerCase()));
				render({ creations, has_more: false }, true);
				for (const item of completed) scheduleCompletedRefresh(creationId(item));
			}
		} catch (error) {
			if (error?.status === 401) onUnauthorized?.();
		} finally {
			pollInProgress = false;
			scheduleInFlightPoll();
		}
	}

	function scheduleCompletedRefresh(id, attempt = 1) {
		if (!id || attempt > 3 || !root.isConnected) return;
		window.setTimeout(async () => {
			if (!root.isConnected) return;
			try {
				const data = await creationsApi.list({ ids: [id] });
				const item = data.creations?.[0];
				if (!item) return;
				mergeServerRows([item]);
				const oldCard = refs.grid.querySelector(`.creation-grid__card[data-creation-id="${id}"]`);
				const oldUrl = oldCard?.querySelector('.feed-card-image')?.dataset.bgUrl;
				const nextCard = makeCreationCard(item);
				const newUrl = nextCard?.querySelector('.feed-card-image')?.dataset.bgUrl;
				render({ creations: [item], has_more: false }, true);
				if (newUrl && oldUrl === newUrl && attempt < 3) scheduleCompletedRefresh(id, attempt + 1);
			} catch (error) {
				if (error?.status === 401) onUnauthorized?.();
			}
		}, attempt * 1000);
	}

	function onVisibilityChange() {
		if (document.visibilityState === 'hidden') {
			window.clearTimeout(pollTimer);
			pollTimer = 0;
		} else syncInFlightPolling();
	}

	function hydratePromotedPendingRows() {
		if (!root.isConnected) return;
		if (typeof creationsProvider?.syncPendingRows !== 'function') return;
		// A composer submit can navigate here before the first-page creations cache
		// expires. Resolve promoted placeholders by ID so a stale cached page cannot
		// hide the newly accepted row until a manual refresh.
		void creationsProvider.syncPendingRows({ beforePublish: next => { lastQueryData = next; } }).then(rows => {
			if (!root.isConnected || !rows?.length) return;
			render({ creations: rows, has_more: false }, true);
		}).catch(error => {
			if (error?.status === 401) onUnauthorized?.();
		});
	}

 function onPendingCreationsUpdated() {
  if (!root.isConnected) return;
  render({ creations: [], has_more: hasMore }, true);
		hydratePromotedPendingRows();
 }

	async function onCreationDetailMutation(event) {
		const id = Number(event.detail?.creationId);
		if (!Number.isInteger(id) || id <= 0 || !root.isConnected) return;
		if (!refs.grid.querySelector(`.creation-grid__card[data-creation-id="${id}"]`)) return;
		try {
			const data = await creationsApi.list({ ids: [String(id)] });
			if (root.isConnected && data.creations?.length) {
				mergeServerRows(data.creations);
				render({ creations: data.creations, has_more: false }, true);
			}
		} catch (error) {
			if (error?.status === 401) onUnauthorized?.();
		}
	}

	function mergeServerRows(rows) {
		creationsProvider?.mergeRows?.(rows, { beforePublish: next => { lastQueryData = next; } });
	}

	function onQueryState(snapshot) {
		if (snapshot.error?.status === 401) return onUnauthorized?.();
		if (snapshot.data && !loading && snapshot.data !== lastQueryData) {
			lastQueryData = snapshot.data;
			const items = Array.isArray(snapshot.data.creations) ? snapshot.data.creations : [];
			offset = items.length;
			render(snapshot.data);
		}
		if (snapshot.status === 'error' && !snapshot.data) {
			removeGridSkeletons();
			refs.grid.replaceChildren();
			root.append(refs.sentinel);
			refs.grid.hidden = true;
			showState(snapshot.error?.message || 'Unable to load your creations.', true);
		}
	}

	async function refresh(force = false) {
		if (loading) return;
		loading = true;
		try {
			const data = await creationsApi.list({ limit: PAGE_SIZE, offset: 0 });
			if (creationsQuery) {
				lastQueryData = data;
				creationsQuery.setData(data);
			}
			offset = Array.isArray(data.creations) ? data.creations.length : 0;
			render(data);
		} catch (error) {
			if (error?.status === 401) onUnauthorized?.();
			else {
				removeGridSkeletons();
				refs.grid.hidden = true;
				showState(error?.message || 'Unable to load your creations.', true);
			}
		} finally { loading = false; }
	}

	async function loadMore() {
		if (loading || !hasMore) return;
		loading = true;
		try {
			const data = await creationsApi.list({ limit: PAGE_SIZE, offset });
			const items = Array.isArray(data.creations) ? data.creations : [];
			offset += items.length;
			render(data, true);
		} catch (error) {
			removeGridSkeletons();
			if (error?.status === 401) onUnauthorized?.();
		} finally { loading = false; }
	}

	// Fetch the next page before its cards enter the thumbnail preload range.
	const sentinelObserver = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) void loadMore(); }, { root: scrollRegion, rootMargin: '2400px 0px' });
	const updateScrollTopVisibility = () => {
		const scrollTop = scrollRegion?.scrollTop || 0;
		refs.scrollTop.hidden = scrollTop < 720;
	};
	const onScrollTopClick = () => scrollRegion?.scrollTo({ top: 0, behavior: 'auto' });
	refs.scrollTop.addEventListener('click', onScrollTopClick);
	scrollRegion?.addEventListener('scroll', updateScrollTopVisibility, { passive: true });
	updateScrollTopVisibility();
	sentinelObserver.observe(refs.sentinel);
	unsubscribe = creationsQuery?.subscribe(onQueryState);
	hydratePromotedPendingRows();
	if (creationsQuery) {
		const cachedInFlight = creationsQuery.data?.creations?.some(item => IN_FLIGHT_STATUSES.has(String(item.status || '').toLowerCase()));
		void (cachedInFlight ? creationsQuery.refresh() : creationsQuery.loadIfNeeded()).catch(() => undefined);
	}
	else void refresh(true);

	return () => { unsubscribe?.(); mediaLoader?.disconnect(); sentinelObserver.disconnect(); window.clearTimeout(pollTimer); pollTimer = 0; document.removeEventListener('visibilitychange', onVisibilityChange); document.removeEventListener('creation-detail:mutation', onCreationDetailMutation); document.removeEventListener('creations-pending-updated', onPendingCreationsUpdated); refs.grid.removeEventListener('click', onGridClick); refs.scrollTop.removeEventListener('click', onScrollTopClick); scrollRegion?.removeEventListener('scroll', updateScrollTopVisibility); setHeaderMenu?.(); };
}
