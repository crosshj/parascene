import { bindRefs, mountTemplate } from '../../utils/dom.js';
import { createCreationMediaLoader, creationCardMarkup } from '../../shared/creationGrid.js';
import template from './CreationsView.html';
import './CreationsView.css';

const PAGE_SIZE = 50;

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

	function render(data, append = false) {
		const items = Array.isArray(data?.creations) ? data.creations : [];
		if (!append) refs.grid.replaceChildren();
		const fragment = document.createRange().createContextualFragment(items.map(creationCardMarkup).join(''));
		refs.grid.append(fragment);
		refs.grid.hidden = refs.grid.children.length === 0;
		if (!refs.grid.children.length) showState('No creations yet. Start creating to see your work here.');
		else refs.status.hidden = true;
		hasMore = data?.has_more === true && items.length > 0;
		refs.loadMore.hidden = !hasMore;
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
			refs.grid.replaceChildren();
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
			else if (!refs.grid.children.length) {
				refs.grid.hidden = true;
				showState(error?.message || 'Unable to load your creations.', true);
			}
		} finally { loading = false; }
	}

	async function loadMore() {
		if (loading || !hasMore) return;
		loading = true;
		refs.loadMore.disabled = true;
		try {
			const data = await creationsApi.list({ limit: PAGE_SIZE, offset });
			const items = Array.isArray(data.creations) ? data.creations : [];
			offset += items.length;
			render(data, true);
		} catch (error) {
			if (error?.status === 401) onUnauthorized?.();
		} finally { loading = false; refs.loadMore.disabled = false; }
	}

	const sentinelObserver = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) void loadMore(); }, { rootMargin: '800px 0px' });
	refs.loadMore.addEventListener('click', () => void loadMore());
	sentinelObserver.observe(refs.sentinel);
	unsubscribe = creationsResource?.subscribe(onResourceState);
	if (creationsResource) void creationsResource.loadIfNeeded().catch(() => undefined);
	else void refresh(true);

	return () => { unsubscribe?.(); mediaLoader?.disconnect(); sentinelObserver.disconnect(); setHeaderMenu?.(); };
}
