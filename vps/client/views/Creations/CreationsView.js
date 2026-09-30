import { bindRefs, mountTemplate } from '../../utils/dom.js';
import { createCreationMediaLoader, creationCardMarkup } from '../../shared/creationGrid.js';
import template from './CreationsView.html';
import './CreationsView.css';

const PAGE_SIZE = 50;
const LOOKAHEAD_SKELETONS = 16;

function renderGridSkeleton(count = 25) {
	return Array.from({ length: count }, () => '<div class="skeleton skeleton-grid-tile" aria-hidden="true"></div>').join('');
}

export function renderCreationsView({ outlet, creationsApi, creationsResource, onUnauthorized, setHeaderMenu }) {
	const root = mountTemplate(outlet, template);
	const refs = bindRefs(root);
	let offset = 0;
	let hasMore = false;
	let loading = false;
	let unsubscribe;
	let mediaLoader;
	const scrollRegion = root.closest('.beta-outlet__scroll');
	refs.grid.innerHTML = renderGridSkeleton();

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

	function appendGridSkeletons() {
		refs.grid.insertAdjacentHTML('beforeend', renderGridSkeleton(LOOKAHEAD_SKELETONS));
	}

	function render(data, append = false) {
		const items = Array.isArray(data?.creations) ? data.creations : [];
		const fragment = document.createRange().createContextualFragment(items.map(creationCardMarkup).join(''));
		if (!append) {
			refs.grid.replaceChildren(fragment);
		} else {
			const skeletons = [...refs.grid.querySelectorAll('.skeleton-grid-tile')];
			const cards = [...fragment.children];
			cards.slice(0, skeletons.length).forEach((card, index) => skeletons[index].replaceWith(card));
			skeletons.slice(cards.length).forEach((skeleton) => skeleton.remove());
			cards.slice(skeletons.length).forEach((card) => refs.grid.append(card));
		}
		// Keep the trigger between loaded cards and the visual look-ahead runway.
		// Pagination should be timed from real content, never from skeletons.
		refs.grid.append(refs.sentinel);
		const hasCards = refs.grid.querySelector('.creation-grid__card');
		refs.grid.hidden = !hasCards;
		if (!hasCards) showState('No creations yet. Start creating to see your work here.');
		else refs.status.hidden = true;
		hasMore = data?.has_more === true && items.length > 0;
		if (hasMore) appendGridSkeletons();
		mediaLoader?.disconnect();
		mediaLoader = createCreationMediaLoader(refs.grid);
		mediaLoader.observe();
	}

	function onResourceState(snapshot) {
		if (snapshot.error?.status === 401) return onUnauthorized?.();
		if (snapshot.data && !loading) {
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

	return () => { unsubscribe?.(); mediaLoader?.disconnect(); sentinelObserver.disconnect(); refs.scrollTop.removeEventListener('click', onScrollTopClick); refs.scrollBottom.removeEventListener('click', onScrollBottomClick); scrollRegion?.removeEventListener('scroll', updateScrollTopVisibility); setHeaderMenu?.(); };
}
