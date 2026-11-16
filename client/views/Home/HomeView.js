import { challengesDetailsHref } from '../../shared/challenges/model/detailsRoute.js';
import { iconMarkup } from '../../components/Icon/Icon.js';
import { creationMediaType, creationThumbnailUrl } from '../../shared/creationGrid.js';
import { nsfwMediaUrl, nsfwShouldBlur } from '../../shared/nsfwPolicy.js';
import { BLOG_CAMPAIGN_INTERNAL, buildBlogPostPublicPath } from '../../shared/blogCampaignPath.js';
import { attachFeedCardCreationDragSource } from '../../shared/creationComposerDrag.js';
import { isGroupCreationItem } from '../../shared/creationGroupMedia.js';
import { feedItemCardOriginalImageUrl, getFeedItemGroupCarouselSources } from '../../shared/feedCardBuild.js';
import { FeedView } from '../Feed/FeedView.js';
import './HomeView.css';

const MOBILE = '(max-width: 768px)';
const SECTION_MISS = 'Could not load this section.';

function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function creationId(item) {
	const id = Number(item?.created_image_id ?? item?.id);
	return Number.isFinite(id) && id > 0 ? id : 0;
}

function withFitVariant(url) {
	const raw = String(url || '').trim();
	if (!raw) return '';
	try {
		const parsed = new URL(raw, location.origin);
		const path = parsed.pathname;
		if (!path.includes('/api/creations/media/') && !path.includes('/api/images/created/') && !path.includes('/api/videos/created/')) return raw;
		parsed.searchParams.set('variant', 'fit');
		parsed.searchParams.delete('source_variant');
		return `${parsed.pathname}${parsed.search}`;
	} catch {
		return raw;
	}
}

function thumbFor(item) {
	if (creationMediaType(item) === 'video') {
		const poster = String(item?.video_thumbnail_url || item?.thumbnail_url || item?.image_url || '').trim();
		return poster || creationThumbnailUrl(item, { video: true });
	}
	const fit = String(item?.fit_thumbnail_url || '').trim();
	if (fit) return fit;
	const source = String(item?.image_url || item?.url || item?.thumbnail_url || '').trim();
	return withFitVariant(source) || creationThumbnailUrl(item);
}

function tileBox(item) {
	const height = 268;
	const width = Number(item?.width);
	const sourceHeight = Number(item?.height);
	const px = width > 0 && sourceHeight > 0 ? Math.max(1, Math.round(height * (width / sourceHeight))) : 201;
	return ` style="width:${px}px;height:${height}px"`;
}

function nsfwBadge(item) {
	if (!nsfwShouldBlur(item)) return '';
	return `<span class="home-tile__nsfw" role="img" aria-label="NSFW">${iconMarkup('eyeHidden')}</span>`;
}

function dragAttrs(item) {
	const id = creationId(item);
	const url = feedItemCardOriginalImageUrl(item);
	const type = String(creationMediaType(item) || item?.media_type || 'image').trim().toLowerCase();
	const status = typeof item?.status === 'string' ? item.status.trim().toLowerCase() : '';
	if (!id || !url || type === 'video' || type === 'audio') return '';
	if (status === 'creating' || status === 'pending' || status === 'queued' || status === 'processing' || status === 'running') return '';
	const published = item?.published === true || item?.published === 1;
	const group = isGroupCreationItem(item);
	const sources = group ? getFeedItemGroupCarouselSources(item, false) : [];
	const selected = sources.length > 1 ? sources[0] : null;
	const groupAttr = group ? ' data-group-creation="1"' : '';
	const selectedAttr = selected
		? ` data-selected-group-source-id="${selected.id}" data-selected-group-source-url="${escapeHtml(selected.url)}"`
		: '';
	return ` draggable="true"${groupAttr}${selectedAttr} data-image-id="${id}" data-image-url-full="${escapeHtml(url)}" data-media-type="${escapeHtml(type)}" data-published="${published ? '1' : '0'}" data-creation-status="${escapeHtml(status)}"`;
}

function creationTile(item) {
	const id = creationId(item);
	const title = String(item?.title || '').trim() || 'Creation';
	const thumb = nsfwMediaUrl(thumbFor(item), item);
	const media = thumb
		? `<img class="home-tile__thumb" src="${escapeHtml(thumb)}" alt="" draggable="false">`
		: `<span class="home-tile__thumb home-tile__thumb--empty" aria-hidden="true"></span>`;
	const drag = dragAttrs(item);
	return `<a class="home-tile home-tile--media"${tileBox(item)}${drag} href="/creations/${id}" aria-label="${escapeHtml(title)}">${media}${nsfwBadge(item)}</a>`;
}

function challengeTile(card) {
	const href = challengesDetailsHref(card.challengeId);
	const media = card.image
		? `<img class="home-tile__thumb" src="${escapeHtml(card.image)}" alt="" draggable="false">`
		: `<span class="home-tile__thumb home-tile__thumb--empty" aria-hidden="true"></span>`;
	const badge = card.nsfw ? `<span class="home-tile__nsfw" role="img" aria-label="NSFW">${iconMarkup('eyeHidden')}</span>` : '';
	const drag = card.creation ? dragAttrs(card.creation) : '';
	return `<a class="home-tile home-tile--media"${tileBox(card)}${drag} href="${escapeHtml(href)}" aria-label="${escapeHtml(card.title)}">${media}${badge}</a>`;
}

function placeComposer(slot) {
	const bar = document.querySelector('[data-layout-creation-composer]');
	if (!(bar instanceof HTMLElement) || !(slot instanceof HTMLElement)) return () => {};
	const parent = bar.parentElement;
	const next = bar.nextSibling;
	slot.append(bar);
	document.body.classList.add('home-desktop-composer');
	return () => {
		document.body.classList.remove('home-desktop-composer');
		if (!parent) return;
		if (next && next.parentNode === parent) parent.insertBefore(bar, next);
		else parent.append(bar);
	};
}

function articleTile(post) {
	const title = String(post?.title || post?.slug || 'Article').trim() || 'Article';
	const href = buildBlogPostPublicPath(post?.slug, BLOG_CAMPAIGN_INTERNAL);
	const thumb = nsfwMediaUrl(String(post?.image || post?.image_url || '').trim(), post);
	const media = thumb
		? `<img class="home-tile__thumb" src="${escapeHtml(thumb)}" alt="" draggable="false">`
		: `<span class="home-tile__thumb home-tile__thumb--empty" aria-hidden="true"></span>`;
	const drag = dragAttrs({
		id: post?.creation_id,
		created_image_id: post?.creation_id,
		image_url: post?.file_path || post?.filename || '',
		file_path: post?.file_path,
		filename: post?.filename,
		media_type: 'image',
		published: post?.published === true,
		status: post?.status
	});
	return `<a class="home-tile home-tile--media"${tileBox(post)}${drag} href="${escapeHtml(href)}" aria-label="${escapeHtml(title)}">${media}${nsfwBadge(post)}</a>`;
}

function moreTile(href, title) {
	return `<a class="home-tile home-tile--more" href="${escapeHtml(href)}" aria-label="More ${escapeHtml(title)}"><span class="home-tile__more-mark" aria-hidden="true">${iconMarkup('stack')}</span><span class="home-tile__more-label">+ More</span></a>`;
}

function skeletonTile(item) {
	return `<div class="home-tile home-tile--skeleton"${tileBox(item)}></div>`;
}

function tilesFor(section) {
	return section.items.map((item) => {
		if (item?.skeleton) return skeletonTile(item);
		if (section.kind === 'challenge') return challengeTile(item);
		if (section.kind === 'article') return articleTile(item);
		return creationTile(item);
	});
}

function sectionStamp(section) {
	if (!section.items.length && (section.status === 'idle' || section.status === 'loading')) return 'pending';
	if (!section.items.length && (section.status === 'error' || section.status === 'stale-error')) return 'error';
	if (!section.items.length) return 'empty';
	return section.items.map((item) => {
		if (item?.skeleton) return `s:${item.width}x${item.height}`;
		if (section.kind === 'challenge') return `${item.challengeId}:${item.image || ''}:${item.title || ''}`;
		if (section.kind === 'article') return `${item.slug}:${item.image_url || ''}:${item.title || ''}`;
		return `${item.created_image_id || item.id}:${item.title || ''}:${item.image || item.image_url || ''}:${item.width || 0}x${item.height || 0}`;
	}).join('|');
}

function sectionMarkup(section) {
	const stamp = sectionStamp(section);
	const tiles = section.items.length ? tilesFor(section) : [];
	const busy = section.items.some((item) => item?.skeleton);
	const empty = stamp === 'error' ? SECTION_MISS : section.empty;
	const body = tiles.length
		? `<div class="home-row">${tiles.join('')}${moreTile(section.href, section.title)}</div>`
		: (stamp === 'pending' ? '' : `<p class="home-empty">${escapeHtml(empty)}</p>`);
	return `<section class="home-section" data-home-section="${escapeHtml(section.id)}" data-stamp="${escapeHtml(stamp)}"${busy ? ' aria-busy="true"' : ''}>
		<h2 class="home-section__head"><a class="home-section__link" href="${escapeHtml(section.href)}">${escapeHtml(section.title)} <span class="home-section__chevron" aria-hidden="true">${iconMarkup('chevronRight')}</span></a></h2>
		${body}
	</section>`;
}

function mountDesktop({ outlet, actions, services }) {
	const root = document.createElement('div');
	root.className = 'home-view';
	root.innerHTML = `<header class="home-hero">
		<p class="home-hero__line">Turn a thought into a creation.</p>
		<div data-home-composer></div>
	</header>
	<div data-home-sections></div>`;
	outlet.replaceChildren(root);
	const header = document.querySelector('.app-outlet__header');
	const frame = header?.closest('.app-outlet__frame');
	header?.classList.add('is-hidden-for-home');
	frame?.classList.add('is-home-desktop');
	const restoreComposer = placeComposer(root.querySelector('[data-home-composer]'));
	services.providers.document.setTitle('Home · Parascene');
	let destroyed = false;
	const sections = root.querySelector('[data-home-sections]');

	let suppressClick = false;
	root.addEventListener('dragstart', () => { suppressClick = true; });
	root.addEventListener('dragend', () => { setTimeout(() => { suppressClick = false; }, 50); });
	root.addEventListener('click', (event) => {
		if (suppressClick) {
			suppressClick = false;
			event.preventDefault();
			return;
		}
		const link = event.target.closest('a');
		if (!link || link.target || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const target = new URL(link.href, location.origin);
		if (target.origin !== location.origin) return;
		if (target.pathname === '/blog' || target.pathname.startsWith('/blog/')) return;
		event.preventDefault();
		void actions.navigate(target.pathname + target.search + target.hash);
	});

	function paint(list) {
		for (const section of list) {
			const stamp = sectionStamp(section);
			const current = sections.querySelector(`[data-home-section="${section.id}"]`);
			if (current?.dataset.stamp === stamp) continue;
			const html = sectionMarkup(section);
			if (current) current.outerHTML = html;
			else sections.insertAdjacentHTML('beforeend', html);
			const next = sections.querySelector(`[data-home-section="${section.id}"]`);
			next?.querySelectorAll('.home-tile[data-image-url-full]').forEach((tile) => {
				attachFeedCardCreationDragSource(tile);
			});
		}
	}

	const stop = services.providers.home?.observe?.((delivery) => {
		if (destroyed) return;
		if (delivery.unauthorized) {
			services.session.redirectToLogin();
			return;
		}
		paint(delivery.sections);
	}) || (() => {});
	if (!services.providers.home?.observe) {
		sections.innerHTML = `<p class="home-status home-status--error" role="status">Unable to load home.</p>`;
	}

	return {
		destroy() {
			destroyed = true;
			stop();
			restoreComposer();
			header?.classList.remove('is-hidden-for-home');
			frame?.classList.remove('is-home-desktop');
			root.remove();
		}
	};
}

export const HomeView = Object.freeze({
	mount(context) {
		const mobile = window.matchMedia(MOBILE);
		let child = null;
		function show() {
			child?.destroy();
			child = mobile.matches ? FeedView.mount(context) : mountDesktop(context);
		}
		mobile.addEventListener('change', show);
		show();
		return {
			destroy() {
				mobile.removeEventListener('change', show);
				child?.destroy();
				child = null;
			}
		};
	}
});
