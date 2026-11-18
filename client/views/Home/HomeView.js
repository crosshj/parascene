import { challengesDetailsHref } from '../../shared/challenges/model/detailsRoute.js';
import { iconMarkup } from '../../components/Icon/Icon.js';
import { audioClipMusicIcon, clock3Icon, peopleOutlined, pictureIcon, thumbsUpStrokeIcon } from '../../icons/svg-strings.js';
import { enableLikeButtons, initLikeButton } from '../../shared/likes.js';
import { applyWhoTooltipAttr, formatWhoTooltip } from '../../shared/whoLabels.js';
import { bindCreationEngagement, projectCreationEngagement, subscribeCreationEngagement } from '../../shared/creationEngagement.js';
import { HOME_ROW_HEIGHT, homeTileWidth } from '../../shared/homeRow.js';
import { creationMediaType, creationThumbnailUrl } from '../../shared/creationGrid.js';
import { nsfwMediaUrl, nsfwShouldBlur } from '../../shared/nsfwPolicy.js';
import { BLOG_CAMPAIGN_INTERNAL, buildBlogPostPublicPath } from '../../shared/blogCampaignPath.js';
import { formatDate } from '../../shared/datetime.js';
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
	const px = homeTileWidth(item?.width, item?.height);
	return ` style="width:${px}px;height:${HOME_ROW_HEIGHT}px"`;
}

function countText(value) {
	return String(Math.max(0, Number(value) || 0));
}

function whoAttr(list) {
	const tip = formatWhoTooltip(list);
	return tip ? ` data-tooltip="${escapeHtml(tip)}"` : '';
}

function likePill(item) {
	const liked = item?.viewer_liked === true;
	return `<button type="button" class="home-tile__stat home-tile__stat--like who-tooltip${liked ? ' is-liked' : ''}" aria-label="Like" aria-pressed="${liked ? 'true' : 'false'}" data-like-button${whoAttr(item?.liked_by)}>${iconMarkup('heart')}<span data-like-count>${countText(item?.like_count)}</span></button>`;
}

function commentPill(item) {
	const count = countText(item?.comment_count);
	return `<span class="home-tile__stat home-tile__stat--comment who-tooltip" aria-label="${count} comments"${whoAttr(item?.commented_by)}>${iconMarkup('comments')}<span data-home-comment-count>${count}</span></span>`;
}

function tileStats(section, item) {
	if (section?.kind !== 'creation') return '';
	const comment = section.id === 'commented' ? commentPill(item) : '';
	return `<span class="home-tile__stats">${comment}${likePill(item)}</span>`;
}

function withEngagement(item) {
	const live = projectCreationEngagement(item, { incoming: true });
	if (!item || !live) return item;
	item.like_count = live.like_count;
	item.comment_count = live.comment_count;
	item.viewer_liked = live.viewer_liked;
	if (Array.isArray(live.liked_by)) item.liked_by = live.liked_by;
	if (Array.isArray(live.commented_by)) item.commented_by = live.commented_by;
	return item;
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

function newbieHandle(item) {
	const name = String(item?.user_name || '').trim().replace(/^@+/, '');
	return name ? `@${name}` : '';
}

function creationTile(item, section) {
	const row = withEngagement(item);
	const id = creationId(row);
	const title = String(row?.title || '').trim() || 'Creation';
	const handle = section?.id === 'newbies' ? newbieHandle(row) : '';
	const label = handle && !title.toLowerCase().includes(handle.toLowerCase()) ? `${handle}, ${title}` : title;
	const name = handle ? `<span class="home-tile__name">${escapeHtml(handle)}</span>` : '';
	const thumb = nsfwMediaUrl(thumbFor(row), row);
	const media = thumb
		? `<img class="home-tile__thumb" src="${escapeHtml(thumb)}" alt="" draggable="false">`
		: `<span class="home-tile__thumb home-tile__thumb--empty" aria-hidden="true"></span>`;
	const drag = dragAttrs(row);
	return `<div class="home-tile home-tile--media"${tileBox(row)}${drag} data-creation-id="${id}"><a class="home-tile__open" draggable="false" href="/creations/${id}" aria-label="${escapeHtml(label)}">${media}${name}${nsfwBadge(row)}</a>${tileStats(section, row)}</div>`;
}

function challengeStatIcon(stat, card) {
	const cls = 'home-challenge__icon';
	if (stat?.key === 'creators') return peopleOutlined(cls);
	if (stat?.key === 'votes') return thumbsUpStrokeIcon(cls);
	if (stat?.key === 'entries' && card?.audio === true) return audioClipMusicIcon(cls);
	return pictureIcon(cls);
}

function challengeTile(card) {
	const href = challengesDetailsHref(card.challengeId);
	const title = String(card?.title || 'Challenge').trim() || 'Challenge';
	const phase = String(card?.phase || '').trim();
	const media = card.image
		? `<img class="home-challenge__img" src="${escapeHtml(card.image)}" alt="" draggable="false">`
		: `<span class="home-challenge__img home-challenge__img--empty" aria-hidden="true"></span>`;
	const badge = card.nsfw ? `<span class="home-tile__nsfw" role="img" aria-label="NSFW">${iconMarkup('eyeHidden')}</span>` : '';
	const drag = card.creation ? dragAttrs(card.creation) : '';
	const time = String(card?.timeLeft || '').trim();
	const status = String(card?.status || '').trim();
	const stats = (Array.isArray(card?.stats) ? card.stats : []).map((stat) => {
		const label = String(stat?.label || '').trim();
		return `<span class="home-challenge__stat" aria-label="${escapeHtml(label)}">${challengeStatIcon(stat, card)}<span>${escapeHtml(stat?.value ?? '0')}</span></span>`;
	}).join('');
	return `<a class="home-tile home-tile--challenge${phase ? ` home-tile--challenge-${escapeHtml(phase)}` : ''}"${drag} href="${escapeHtml(href)}" aria-label="${escapeHtml(title)}">
		<span class="home-challenge__meta">
			<span class="home-challenge__phase">${escapeHtml(card?.phaseLabel || '')}</span>
			${time ? `<span class="home-challenge__time">${clock3Icon('home-challenge__icon')}<span>${escapeHtml(time)}</span></span>` : ''}
		</span>
		<span class="home-challenge__title">${escapeHtml(title)}</span>
		<span class="home-challenge__hero">${media}${badge}</span>
		<span class="home-challenge__foot">
			<span class="home-challenge__status">${escapeHtml(status)}</span>
			<span class="home-challenge__stats">${stats}</span>
		</span>
	</a>`;
}

function mountHeroGlow(canvas) {
	if (/jsdom/i.test(window.navigator?.userAgent || '')) return () => {};
	let context = null;
	try {
		context = canvas.getContext('2d');
	} catch {
		context = null;
	}
	const schedule = window.requestAnimationFrame?.bind(window);
	const cancel = window.cancelAnimationFrame?.bind(window);
	if (!context || !schedule || !cancel) return () => {};
	const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
	const scheme = window.matchMedia('(prefers-color-scheme: dark)');
	const wash = [
		{ x: 0.4, y: 0.5, rx: 0.34, ry: 0.42, tone: [88, 46, 176], lightTone: [196, 150, 255], alpha: 0.26, lightAlpha: 0.22 },
		{ x: 0.56, y: 0.46, rx: 0.3, ry: 0.38, tone: [124, 72, 210], lightTone: [214, 176, 255], alpha: 0.18, lightAlpha: 0.15 },
		{ x: 0.62, y: 0.56, rx: 0.26, ry: 0.34, tone: [214, 46, 168], lightTone: [255, 150, 224], alpha: 0.34, lightAlpha: 0.26, pulse: true }
	];
	let frame = 0;
	let width = 0;
	let height = 0;
	const resize = () => {
		const bounds = canvas.getBoundingClientRect();
		const ratio = Math.min(window.devicePixelRatio || 1, 2);
		const nextWidth = Math.max(1, Math.round(bounds.width * ratio));
		const nextHeight = Math.max(1, Math.round(bounds.height * ratio));
		if (nextWidth === width && nextHeight === height) return;
		width = nextWidth;
		height = nextHeight;
		canvas.width = nextWidth;
		canvas.height = nextHeight;
	};
	const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
	observer?.observe(canvas);
	if (!observer) window.addEventListener('resize', resize);
	resize();
	const draw = (now) => {
		if (!width || !height) return;
		const time = motion.matches ? 0 : (now || 0) / 1000;
		const presence = motion.matches ? 0.45 : Math.pow(Math.max(0, Math.sin(time * 0.28)), 2);
		context.clearRect(0, 0, width, height);
		wash.forEach((spot, index) => {
			const driftX = Math.sin(time * 0.12 + index) * width * 0.012;
			const driftY = Math.cos(time * 0.1 + index * 1.4) * height * 0.018;
			const x = width * spot.x + driftX;
			const y = height * spot.y + driftY;
			const radiusX = width * spot.rx;
			const radiusY = height * spot.ry;
			const tone = scheme.matches ? spot.tone : spot.lightTone;
			const alpha = (scheme.matches ? spot.alpha : spot.lightAlpha) * (spot.pulse ? presence : 1);
			context.save();
			context.translate(x, y);
			context.scale(radiusX, radiusY);
			const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
			gradient.addColorStop(0, `rgba(${tone[0]}, ${tone[1]}, ${tone[2]}, ${alpha})`);
			gradient.addColorStop(0.55, `rgba(${tone[0]}, ${tone[1]}, ${tone[2]}, ${alpha * 0.28})`);
			gradient.addColorStop(1, `rgba(${tone[0]}, ${tone[1]}, ${tone[2]}, 0)`);
			context.fillStyle = gradient;
			context.beginPath();
			context.arc(0, 0, 1, 0, Math.PI * 2);
			context.fill();
			context.restore();
		});
	};
	const tick = (now) => {
		draw(now);
		if (!motion.matches) frame = schedule(tick);
	};
	const onMotion = () => {
		cancel(frame);
		frame = schedule(tick);
	};
	const onScheme = () => {
		cancel(frame);
		frame = schedule(tick);
	};
	frame = schedule(tick);
	motion.addEventListener?.('change', onMotion);
	scheme.addEventListener?.('change', onScheme);
	return () => {
		cancel(frame);
		observer?.disconnect();
		if (!observer) window.removeEventListener('resize', resize);
		motion.removeEventListener?.('change', onMotion);
		scheme.removeEventListener?.('change', onScheme);
	};
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
		? `<img class="home-article__img" src="${escapeHtml(thumb)}" alt="" draggable="false">`
		: `<span class="home-article__img home-article__img--empty" aria-hidden="true"></span>`;
	const date = formatDate(post?.published_at, { dateStyle: 'medium' });
	const summary = String(post?.description || '').trim();
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
	return `<a class="home-tile home-tile--article"${drag} href="${escapeHtml(href)}" aria-label="${escapeHtml(title)}">
		<span class="home-article__date">${escapeHtml(date)}</span>
		<span class="home-article__title">${escapeHtml(title)}</span>
		<span class="home-article__hero">${media}${nsfwBadge(post)}</span>
		<span class="home-article__summary">${escapeHtml(summary)}</span>
	</a>`;
}

function moreTile(href, title) {
	return `<a class="home-tile home-tile--more" href="${escapeHtml(href)}" aria-label="More ${escapeHtml(title)}"><span class="home-tile__more-mark" aria-hidden="true">${iconMarkup('stack')}</span><span class="home-tile__more-label">+ More</span></a>`;
}

function skeletonTile(item, section) {
	if (section?.kind === 'challenge') return `<div class="home-tile home-tile--skeleton home-tile--challenge"></div>`;
	if (section?.kind === 'article') return `<div class="home-tile home-tile--skeleton home-tile--article"></div>`;
	return `<div class="home-tile home-tile--skeleton"${tileBox(item)}></div>`;
}

function tilesFor(section) {
	return section.items.map((item) => {
		if (item?.skeleton) return skeletonTile(item, section);
		if (section.kind === 'challenge') return challengeTile(item);
		if (section.kind === 'article') return articleTile(item);
		return creationTile(item, section);
	});
}

function sectionStamp(section) {
	if (!section.items.length && (section.status === 'idle' || section.status === 'loading')) return 'pending';
	if (!section.items.length && (section.status === 'error' || section.status === 'stale-error')) return 'error';
	if (!section.items.length) return 'empty';
	return section.items.map((item) => {
		if (item?.skeleton) return `s:${item.width}x${item.height}`;
		if (section.kind === 'challenge') return `${item.challengeId}:${item.image || ''}:${item.title || ''}:${item.phase || ''}:${item.timeLeft || ''}:${(item.stats || []).map((stat) => stat.value).join(',')}`;
		if (section.kind === 'article') return `${item.slug}:${item.image_url || ''}:${item.title || ''}:${item.published_at || ''}:${item.description || ''}`;
		return `${item.created_image_id || item.id}:${item.title || ''}:${item.image || item.image_url || ''}:${item.width || 0}x${item.height || 0}:${item.user_name || ''}`;
	}).join('|');
}

function sectionMarkup(section) {
	const stamp = sectionStamp(section);
	const tiles = section.items.length ? tilesFor(section) : [];
	const busy = section.items.some((item) => item?.skeleton);
	const empty = stamp === 'error' ? SECTION_MISS : section.empty;
	const body = tiles.length
		? `<div class="home-row${section.kind === 'challenge' ? ' home-row--challenge' : ''}${section.kind === 'article' ? ' home-row--article' : ''}">${tiles.join('')}${moreTile(section.href, section.title)}</div>`
		: (stamp === 'pending' ? '' : `<p class="home-empty">${escapeHtml(empty)}</p>`);
	return `<section class="home-section" data-home-section="${escapeHtml(section.id)}" data-stamp="${escapeHtml(stamp)}"${busy ? ' aria-busy="true"' : ''}>
		<h2 class="home-section__head"><a class="home-section__link" href="${escapeHtml(section.href)}">${escapeHtml(section.title)} <span class="home-section__chevron" aria-hidden="true">${iconMarkup('chevronRight')}</span></a></h2>
		${body}
	</section>`;
}

function mountDesktop({ outlet, actions, services }) {
	const root = document.createElement('div');
	root.className = 'home-view';
	root.style.setProperty('--home-row-height', `${HOME_ROW_HEIGHT}px`);
	root.innerHTML = `<header class="home-hero">
		<div class="home-hero__glow" aria-hidden="true"><canvas class="home-hero__glow-canvas"></canvas></div>
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
	const stopGlow = mountHeroGlow(root.querySelector('.home-hero__glow-canvas'));
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
			next?.querySelectorAll('.home-tile[data-creation-id]').forEach((tile) => {
				const id = Number(tile.dataset.creationId);
				const record = section.items.find((item) => creationId(item) === id);
				if (record) tile.__creationRecord = record;
				const button = tile.querySelector('button[data-like-button]');
				if (button && record) initLikeButton(button, record);
				if (tile.hasAttribute('data-image-url-full')) attachFeedCardCreationDragSource(tile);
			});
		}
	}

	function paintEngagement(state) {
		const id = String(state?.id || '');
		if (!id) return;
		services.providers.home?.noteEngagement?.(id, state);
		for (const tile of root.querySelectorAll(`.home-tile[data-creation-id="${id}"]`)) {
			const button = tile.querySelector('button[data-like-button]');
			if (button) {
				button.setAttribute('aria-pressed', state.viewer_liked ? 'true' : 'false');
				button.classList.toggle('is-liked', state.viewer_liked === true);
				const count = button.querySelector('[data-like-count]');
				if (count) count.textContent = countText(state.like_count);
				if (Array.isArray(state.liked_by)) applyWhoTooltipAttr(button, state.liked_by);
			}
			const comments = tile.querySelector('[data-home-comment-count]');
			if (comments) comments.textContent = countText(state.comment_count);
			const commentStat = tile.querySelector('.home-tile__stat--comment');
			if (commentStat && Array.isArray(state.commented_by)) applyWhoTooltipAttr(commentStat, state.commented_by);
			if (tile.__creationRecord) {
				tile.__creationRecord.like_count = state.like_count;
				tile.__creationRecord.comment_count = state.comment_count;
				tile.__creationRecord.viewer_liked = state.viewer_liked === true;
				if (Array.isArray(state.liked_by)) tile.__creationRecord.liked_by = state.liked_by;
				if (Array.isArray(state.commented_by)) tile.__creationRecord.commented_by = state.commented_by;
			}
		}
	}

	bindCreationEngagement();
	enableLikeButtons(root);
	const stopEngagement = subscribeCreationEngagement((state) => {
		if (!destroyed) paintEngagement(state);
	});
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
			stopEngagement();
			stopGlow();
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
