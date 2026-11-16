import { fetchJsonWithStatusDeduped } from '../../shared/api.js';
import { createChatFeedFetchPage } from '../../providers/feed/feed.js';
import { buildChallengesChannelModel } from '../../shared/challenges/model/buildChannelModel.js';
import { challengesDetailsHref } from '../../shared/challenges/model/detailsRoute.js';
import { iconMarkup } from '../../components/Icon/Icon.js';
import { creationMediaType, creationThumbnailUrl } from '../../shared/creationGrid.js';
import { nsfwMediaUrl, nsfwShouldBlur } from '../../shared/nsfwPolicy.js';
import {
	ACTIVE_PARTICIPANT_PHASES,
	deriveChallengePhase,
	mergeFullChallengeConfigForChallenge,
	pickChallengeConfigTimestamp,
	pickChallengeHeroImageUrl,
	pickChallengeHeroPreviewUrl,
	summarizeLatestChallengeConfigs
} from '../../shared.js';
import {
	fetchCreationEmbedPayload,
	parseHeroCreationOrShareRef,
	parseHeroDirectMediaUrl
} from '../../shared/userText.js';
import { FeedView } from '../Feed/FeedView.js';
import './HomeView.css';

const MOBILE = '(max-width: 768px)';
const SAMPLE = 8;

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

function isCreation(item) {
	if (!item || item.type === 'engagement' || item.type === 'blog' || item.type === 'tip') return false;
	return creationId(item) > 0;
}

function isPinnedChallengeAnnouncement(item) {
	return item?.editorial_pin === true && String(item?.editorial_pin_id || '').startsWith('challenge-');
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

function aspectStyle(item) {
	const width = Number(item?.width);
	const height = Number(item?.height);
	if (!(width > 0) || !(height > 0)) return '';
	return ` style="aspect-ratio:${width} / ${height}"`;
}

function nsfwBadge(item) {
	if (!nsfwShouldBlur(item)) return '';
	return `<span class="home-tile__nsfw" role="img" aria-label="NSFW">${iconMarkup('eyeHidden')}</span>`;
}

function creationTile(item) {
	const id = creationId(item);
	const title = String(item?.title || '').trim() || 'Creation';
	const thumb = nsfwMediaUrl(thumbFor(item), item);
	const media = thumb
		? `<img class="home-tile__thumb" src="${escapeHtml(thumb)}" alt="">`
		: `<span class="home-tile__thumb home-tile__thumb--empty" aria-hidden="true"></span>`;
	return `<a class="home-tile home-tile--media"${aspectStyle(item)} href="/creations/${id}" aria-label="${escapeHtml(title)}">${media}${nsfwBadge(item)}</a>`;
}

function creationFromComment(comment) {
	const creation = comment?.creation && typeof comment.creation === 'object' ? comment.creation : null;
	const id = creationId(creation) || creationId({ created_image_id: comment?.created_image_id });
	if (!creation || !id || creationMediaType(creation) === 'audio') return null;
	const item = { ...creation, id, created_image_id: id, nsfw: creation.nsfw || comment.nsfw === true };
	return thumbFor(item) ? item : null;
}

function challengeTile(card) {
	const href = challengesDetailsHref(card.challengeId);
	const sized = card.width > 0 && card.height > 0 ? ` style="aspect-ratio:${card.width} / ${card.height}"` : '';
	const media = card.image
		? `<img class="home-tile__thumb" src="${escapeHtml(card.image)}" alt=""${sized}>`
		: `<span class="home-tile__thumb home-tile__thumb--empty" aria-hidden="true"></span>`;
	const badge = card.nsfw ? `<span class="home-tile__nsfw" role="img" aria-label="NSFW">${iconMarkup('eyeHidden')}</span>` : '';
	return `<a class="home-tile home-tile--media"${sized} href="${escapeHtml(href)}" aria-label="${escapeHtml(card.title)}">${media}${badge}</a>`;
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

function sectionMarkup({ title, href, tiles, empty }) {
	const body = tiles.length
		? `<div class="home-row">${tiles.join('')}</div>`
		: `<p class="home-empty">${escapeHtml(empty)}</p>`;
	return `<section class="home-section">
		<h2 class="home-section__head"><a class="home-section__link" href="${escapeHtml(href)}">${escapeHtml(title)} <span class="home-section__chevron" aria-hidden="true">${iconMarkup('chevronRight')}</span></a></h2>
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
	let releaseMessages = () => {};
	const sections = root.querySelector('[data-home-sections]');
	const cachedGet = async (path, options = {}) => {
		const result = await fetchJsonWithStatusDeduped(path, { credentials: 'include', ...options }, { windowMs: 30000 });
		if (result?.status === 401) {
			const error = new Error('Unauthorized');
			error.status = 401;
			throw error;
		}
		return result;
	};

	root.addEventListener('click', (event) => {
		const link = event.target.closest('a');
		if (!link || link.target || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const target = new URL(link.href, location.origin);
		if (target.origin !== location.origin) return;
		event.preventDefault();
		void actions.navigate(target.pathname + target.search + target.hash);
	});

	function challengeCards(messages) {
		const model = buildChallengesChannelModel(messages, { viewerId: Number(services.session.user?.id) || null });
		const configs = model.raw?.configs || [];
		const cards = [];
		for (const summary of summarizeLatestChallengeConfigs(configs)) {
			const challengeId = String(summary.challenge_id || '').trim();
			if (!challengeId) continue;
			const cfg = {
				...summary.payload,
				...mergeFullChallengeConfigForChallenge(configs, challengeId)
			};
			const phase = deriveChallengePhase(cfg, Date.now());
			if (phase === 'pre_submit' || phase === 'deleted' || phase === 'purged' || phase === 'empty') continue;
			const end = Date.parse(String(pickChallengeConfigTimestamp(cfg, 'voting_end_at') || ''));
			cards.push({
				challengeId,
				title: String(summary.title || cfg.title || 'Challenge').trim() || 'Challenge',
				active: ACTIVE_PARTICIPANT_PHASES.has(phase),
				preview: pickChallengeHeroPreviewUrl(cfg),
				hero: pickChallengeHeroImageUrl(cfg),
				end: Number.isFinite(end) ? end : 0
			});
		}
		cards.sort((a, b) => (a.active === b.active ? b.end - a.end : a.active ? -1 : 1));
		return cards.slice(0, SAMPLE);
	}

	async function imageForChallenge(card) {
		const preview = String(card.preview || '').trim();
		const hero = String(card.hero || '').trim();
		const direct = parseHeroDirectMediaUrl(hero);
		const ref = parseHeroCreationOrShareRef(hero);
		if (!ref) return { url: preview || direct || '', width: 0, height: 0, nsfw: false };
		const data = await fetchCreationEmbedPayload(ref.creationId, ref.shareOpts, { challengeId: card.challengeId });
		if (!data || data._error) return { url: preview || direct || '', width: 0, height: 0, nsfw: false };
		const blur = nsfwShouldBlur(data);
		return {
			url: blur ? nsfwMediaUrl(thumbFor(data), data) : (preview || thumbFor(data)),
			width: Number(data.width) || 0,
			height: Number(data.height) || 0,
			nsfw: blur
		};
	}

	async function loadChallengeCards() {
		const threads = services.providers?.threads;
		if (!threads?.query) return { ok: true, items: [] };
		await threads.query.loadIfNeeded();
		if (destroyed) return { ok: true, items: [] };
		const thread = threads.query.data?.threads?.find((row) => row.channel_slug === 'challenges');
		const threadId = Number(thread?.id);
		if (!threadId) return { ok: true, items: [] };
		const lease = threads.acquireMessages(threadId, { persist: true, complete: true });
		releaseMessages = () => lease.release();
		await lease.query.loadIfNeeded();
		if (destroyed) return { ok: true, items: [] };
		const rawMessages = lease.query.data?.messages || [];
		const messages = threads.votes?.project?.(rawMessages) || rawMessages;
		const cards = challengeCards(messages);
		const images = await Promise.all(cards.map((card) => imageForChallenge(card)));
		return {
			ok: true,
			items: cards.map((card, index) => ({
				...card,
				image: images[index].url,
				width: images[index].width,
				height: images[index].height,
				nsfw: images[index].nsfw
			}))
		};
	}

	async function loadCommentImages() {
		const picked = [];
		const seen = new Set();
		let cursor = null;
		for (let page = 0; page < 2 && picked.length < SAMPLE; page += 1) {
			const params = new URLSearchParams({ limit: '24' });
			if (cursor?.before) params.set('before', String(cursor.before));
			if (cursor?.before_id) params.set('before_id', String(cursor.before_id));
			const result = await cachedGet(`/api/comments/latest?${params}`);
			if (!result?.ok) return picked.length ? { ok: true, items: picked } : { ok: false, items: [] };
			const comments = Array.isArray(result?.data?.comments) ? result.data.comments : [];
			for (const comment of comments) {
				const id = Number(comment?.created_image_id);
				if (!id || seen.has(id)) continue;
				const item = creationFromComment(comment);
				if (!item) continue;
				seen.add(id);
				picked.push(item);
				if (picked.length >= SAMPLE) break;
			}
			if (result?.data?.has_more !== true || !result?.data?.next_cursor) break;
			cursor = result.data.next_cursor;
		}
		return { ok: true, items: picked };
	}

	async function load() {
		const jobs = await Promise.allSettled([
			createChatFeedFetchPage({
				fetchJsonWithStatusDeduped: cachedGet,
				mobileChatSlotPack: false
			})({ initial: true, items: [] }),
			loadCommentImages(),
			cachedGet('/api/explore?limit=40'),
			loadChallengeCards()
		]);
		if (destroyed) return;
		if (jobs.some((job) => job.status === 'rejected' && job.reason?.status === 401) || jobs.some((job) => job.status === 'fulfilled' && job.value?.status === 401)) {
			services.session.redirectToLogin();
			return;
		}
		const value = (index) => jobs[index].status === 'fulfilled' ? jobs[index].value : null;
		const failed = (index) => jobs[index].status === 'rejected' || jobs[index].value?.ok === false;
		const miss = 'Could not load this section.';
		const feedItems = (value(0)?.pageItems || [])
			.filter((item) => isCreation(item) && !isPinnedChallengeAnnouncement(item))
			.slice(0, SAMPLE);
		const comments = value(1)?.ok ? value(1).items || [] : [];
		const explore = (value(2)?.ok ? value(2).data?.items : [])
			.filter((item) => isCreation(item) && creationMediaType(item) !== 'audio')
			.slice(0, SAMPLE);
		const challenges = value(3)?.ok ? value(3).items || [] : [];

		sections.innerHTML = [
			sectionMarkup({ title: 'Feed', href: '/feed', tiles: feedItems.map(creationTile), empty: failed(0) ? miss : 'Nothing new in the feed.' }),
			sectionMarkup({ title: 'Challenges', href: '/challenges', tiles: challenges.map(challengeTile), empty: failed(3) ? miss : 'No challenges yet.' }),
			sectionMarkup({ title: 'Commented', href: '/comments', tiles: comments.map(creationTile), empty: failed(1) ? miss : 'No comments yet.' }),
			sectionMarkup({ title: 'Explore', href: '/explore', tiles: explore.map(creationTile), empty: failed(2) ? miss : 'Nothing here.' })
		].join('');
	}

	void load().catch((error) => {
		if (destroyed || error?.name === 'AbortError') return;
		sections.innerHTML = `<p class="home-status home-status--error" role="status">${escapeHtml(error?.message || 'Unable to load home.')}</p>`;
	});

	return {
		destroy() {
			destroyed = true;
			releaseMessages();
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
