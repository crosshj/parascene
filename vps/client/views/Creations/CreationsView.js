import { bindRefs, mountTemplate } from '../../utils/dom.js';
import { createCreationMediaLoader, creationCardMarkup } from '../../shared/creationGrid.js';
import template from './CreationsView.html';
import './CreationsView.css';

const PAGE_SIZE = 50;
const LOOKAHEAD_SKELETONS = 16;

function makeGridSkeleton() {
	const tile = document.createElement('div');
	tile.className = 'skeleton-grid-tile';
	tile.setAttribute('aria-hidden', 'true');
	return tile;
}

function creationId(item) {
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
		for (const attr of [...card.attributes]) {
			if (!nextCard.hasAttribute(attr.name)) card.removeAttribute(attr.name);
		}
		for (const attr of [...nextCard.attributes]) card.setAttribute(attr.name, attr.value);
		card.replaceChildren(...nextCard.childNodes);
		card.__creationMarkup = markup;
		card.__creationRecord = item;
		return true;
	}
	card.__creationRecord = item;
	return false;
}

export function renderCreationsView({ outlet, creationsApi, creationsResource, onUnauthorized, setHeaderMenu, onOpenCreation }) {
	const root = mountTemplate(outlet, template);
	const refs = bindRefs(root);
	let offset = 0;
	let hasMore = false;
	let loading = false;
	let lastResourceData = null;
	let unsubscribe;
	const mediaLoader = createCreationMediaLoader(refs.grid);
	const scrollRegion = root.closest('.beta-outlet__scroll');
	for (let i = 0; i < 25; i += 1) refs.grid.append(makeGridSkeleton());
	const onGridClick = (event) => {
		const card = event.target.closest?.('[data-creation-id]');
		const id = Number(card?.dataset?.creationId);
		if (card && Number.isFinite(id) && id > 0) onOpenCreation?.(id, card.__creationRecord || null);
	};
	refs.grid.addEventListener('click', onGridClick);
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
			? currentCards.map((card) => card.__creationRecord).filter(Boolean)
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
		hasMore = data?.has_more === true && items.length > 0;
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
		if (cardsToHydrate.length) mediaLoader.observe(cardsToHydrate);
	}

	function onResourceState(snapshot) {
		if (snapshot.error?.status === 401) return onUnauthorized?.();
		if (snapshot.data && !loading && snapshot.data !== lastResourceData) {
			lastResourceData = snapshot.data;
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

	const sentinelObserver = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) void loadMore(); }, { rootMargin: '1200px 0px' });
	const updateScrollTopVisibility = () => {
		const scrollTop = scrollRegion?.scrollTop || 0;
		const canScroll = Boolean(scrollRegion && scrollRegion.scrollHeight - scrollRegion.clientHeight > 720);
		refs.scrollTop.hidden = scrollTop < 720;
		refs.scrollBottom.hidden = !canScroll || scrollTop >= 720;
	};
	const onScrollTopClick = () => scrollRegion?.scrollTo({ top: 0, behavior: 'auto' });
	const onScrollBottomClick = () => scrollRegion?.scrollTo({ top: scrollRegion.scrollHeight, behavior: 'auto' });
	refs.scrollTop.addEventListener('click', onScrollTopClick);
	refs.scrollBottom.addEventListener('click', onScrollBottomClick);
	scrollRegion?.addEventListener('scroll', updateScrollTopVisibility, { passive: true });
	updateScrollTopVisibility();
	sentinelObserver.observe(refs.sentinel);
	unsubscribe = creationsResource?.subscribe(onResourceState);
	if (creationsResource) void creationsResource.loadIfNeeded().catch(() => undefined);
	else void refresh(true);

	return () => { unsubscribe?.(); mediaLoader?.disconnect(); sentinelObserver.disconnect(); refs.grid.removeEventListener('click', onGridClick); refs.scrollTop.removeEventListener('click', onScrollTopClick); refs.scrollBottom.removeEventListener('click', onScrollBottomClick); scrollRegion?.removeEventListener('scroll', updateScrollTopVisibility); setHeaderMenu?.(); };
}
