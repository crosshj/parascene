import { fetchJsonWithStatusDeduped } from '../../shared/api.js';
import { getHiddenFeedItems } from '../../shared/feedHiddenItems.js';
import { creationMediaType, creationThumbnailUrl } from '../../shared/creationGrid.js';
import { nsfwMediaUrl, nsfwShouldBlur } from '../../shared/nsfwPolicy.js';
import { buildChallengesChannelModel } from '../../shared/challenges/model/buildChannelModel.js';
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

export const HOME_SAMPLE = 8;

function creationId(item) {
	const id = Number(item?.created_image_id ?? item?.id);
	return Number.isFinite(id) && id > 0 ? id : 0;
}

function isCreation(item) {
	if (!item || item.type === 'engagement' || item.type === 'blog' || item.type === 'tip') return false;
	return creationId(item) > 0;
}

function withFitVariant(url) {
	const raw = String(url || '').trim();
	if (!raw || typeof location === 'undefined') return raw;
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

function unauthorized(status) {
	if (status !== 401) return;
	const error = new Error('Unauthorized');
	error.status = 401;
	throw error;
}

function failed(result, message) {
	const error = new Error(message);
	error.status = Number(result?.status) || 0;
	throw error;
}

function throwIfAborted(signal) {
	if (!signal?.aborted) return;
	const error = new Error('Aborted');
	error.name = 'AbortError';
	throw error;
}

async function readJson(fetchJson, path, signal) {
	const result = await fetchJson(path, { credentials: 'include', signal }, { windowMs: 0 });
	unauthorized(result?.status);
	return result;
}

async function loadFeed({ fetchJson, signal }) {
	const params = new URLSearchParams({ limit: '28', feed_surface: 'chat', offset: '0' });
	const result = await readJson(fetchJson, `/api/feed?${params}`, signal);
	if (!result?.ok) failed(result, 'Failed to load feed');
	const hidden = new Set((getHiddenFeedItems() || []).map((id) => String(id)));
	const items = (Array.isArray(result.data?.items) ? result.data.items : []).filter((item) => {
		if (!isCreation(item)) return false;
		if (item?.editorial_pin === true && String(item?.editorial_pin_id || '').startsWith('challenge-')) return false;
		const id = String(item.created_image_id || item.id || '');
		return !id || !hidden.has(id);
	}).slice(0, HOME_SAMPLE);
	return { items };
}

async function loadCommented({ fetchJson, signal }) {
	const items = [];
	const seen = new Set();
	let cursor = null;
	for (let page = 0; page < 2 && items.length < HOME_SAMPLE; page += 1) {
		throwIfAborted(signal);
		const params = new URLSearchParams({ limit: '24' });
		if (cursor?.before) params.set('before', String(cursor.before));
		if (cursor?.before_id) params.set('before_id', String(cursor.before_id));
		const result = await readJson(fetchJson, `/api/comments/latest?${params}`, signal);
		if (!result?.ok) {
			if (items.length) return { items };
			failed(result, 'Failed to load comments');
		}
		const comments = Array.isArray(result.data?.comments) ? result.data.comments : [];
		for (const comment of comments) {
			const creation = comment?.creation && typeof comment.creation === 'object' ? comment.creation : null;
			const id = creationId(creation) || creationId({ created_image_id: comment?.created_image_id });
			if (!creation || !id || seen.has(id) || creationMediaType(creation) === 'audio') continue;
			const item = { ...creation, id, created_image_id: id, nsfw: creation.nsfw || comment.nsfw === true };
			if (!thumbFor(item)) continue;
			seen.add(id);
			items.push(item);
			if (items.length >= HOME_SAMPLE) break;
		}
		if (result.data?.has_more !== true || !result.data?.next_cursor) break;
		cursor = result.data.next_cursor;
	}
	return { items };
}

async function loadExplore({ fetchJson, signal }) {
	const result = await readJson(fetchJson, '/api/explore?limit=40', signal);
	if (!result?.ok) failed(result, 'Failed to load explore');
	const items = (Array.isArray(result.data?.items) ? result.data.items : [])
		.filter((item) => isCreation(item) && creationMediaType(item) !== 'audio')
		.slice(0, HOME_SAMPLE);
	return { items };
}

async function loadArticles({ fetchJson, signal }) {
	const result = await readJson(fetchJson, '/api/blog/published?limit=8', signal);
	if (!result?.ok) failed(result, 'Failed to load articles');
	const items = (Array.isArray(result.data?.posts) ? result.data.posts : [])
		.filter((post) => post?.slug && String(post.image_url || '').trim())
		.slice(0, HOME_SAMPLE);
	return { items };
}

function challengeCards(messages, viewerId) {
	const model = buildChallengesChannelModel(messages, { viewerId: Number(viewerId) || null });
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
	return cards.slice(0, HOME_SAMPLE);
}

async function imageForChallenge(card) {
	const preview = String(card.preview || '').trim();
	const hero = String(card.hero || '').trim();
	const direct = parseHeroDirectMediaUrl(hero);
	const ref = parseHeroCreationOrShareRef(hero);
	const fallback = { url: preview || direct || '', creation: null, width: 0, height: 0, nsfw: false };
	if (!ref) return fallback;
	const data = await fetchCreationEmbedPayload(ref.creationId, ref.shareOpts, { challengeId: card.challengeId });
	if (!data || data._error) return fallback;
	const blur = nsfwShouldBlur(data);
	return {
		url: blur ? nsfwMediaUrl(thumbFor(data), data) : (preview || thumbFor(data)),
		creation: data,
		width: Number(data.width) || 0,
		height: Number(data.height) || 0,
		nsfw: blur
	};
}

async function loadChallenges({ threads, viewerId, signal }) {
	if (!threads?.query) return { items: [] };
	await threads.query.loadIfNeeded();
	throwIfAborted(signal);
	const thread = threads.query.data?.threads?.find((row) => row.channel_slug === 'challenges');
	const threadId = Number(thread?.id);
	if (!threadId) return { items: [] };
	const lease = threads.acquireMessages(threadId, { persist: true, complete: true });
	let messages = [];
	try {
		await lease.query.loadIfNeeded();
		throwIfAborted(signal);
		const raw = lease.query.data?.messages || [];
		messages = threads.votes?.project?.(raw) || raw;
	} finally {
		lease.release();
	}
	const cards = challengeCards(messages, viewerId);
	const images = await Promise.all(cards.map((card) => imageForChallenge(card)));
	throwIfAborted(signal);
	return {
		items: cards.map((card, index) => challengeCacheItem(card, images[index]))
	};
}

function challengeCacheItem(card, image) {
	const creation = image?.creation && !image.creation._error ? image.creation : null;
	const id = Number(creation?.created_image_id ?? creation?.id);
	const url = String(image?.url || '').trim();
	return {
		challengeId: card.challengeId,
		title: card.title,
		image: url,
		width: Number(image?.width) || 0,
		height: Number(image?.height) || 0,
		nsfw: image?.nsfw === true,
		creation: Number.isFinite(id) && id > 0 ? {
			id,
			created_image_id: id,
			image_url: url || String(creation.image_url || creation.url || '').trim(),
			file_path: creation.file_path || '',
			media_type: creation.media_type || 'image',
			status: creation.status || '',
			published: creation.published === true || creation.published === 1,
			width: Number(image?.width) || Number(creation.width) || 0,
			height: Number(image?.height) || Number(creation.height) || 0,
			nsfw: image?.nsfw === true
		} : null
	};
}

const LOADERS = {
	feed: loadFeed,
	commented: loadCommented,
	explore: loadExplore,
	articles: loadArticles,
	challenges: loadChallenges
};

function presentCreation(item) {
	const id = creationId(item);
	const image = thumbFor(item);
	return {
		id,
		created_image_id: id,
		title: String(item?.title || ''),
		width: Number(item?.width) || 0,
		height: Number(item?.height) || 0,
		image,
		image_url: image || String(item?.image_url || item?.url || '').trim(),
		fit_thumbnail_url: image,
		file_path: item?.file_path || '',
		media_type: creationMediaType(item) || 'image',
		status: item?.status || '',
		published: item?.published === true || item?.published === 1,
		nsfw: item?.nsfw === true
	};
}

function presentArticle(post) {
	const image = String(post?.image_url || '').trim();
	return {
		slug: post?.slug,
		title: post?.title || '',
		width: Number(post?.width) || 0,
		height: Number(post?.height) || 0,
		image,
		image_url: image,
		creation_id: post?.creation_id,
		file_path: post?.file_path || '',
		filename: post?.filename || '',
		published: post?.published === true,
		status: post?.status || '',
		nsfw: post?.nsfw === true
	};
}

function presentChallenge(item) {
	return {
		challengeId: item?.challengeId,
		title: item?.title || 'Challenge',
		image: String(item?.image || '').trim(),
		width: Number(item?.width) || 0,
		height: Number(item?.height) || 0,
		nsfw: item?.nsfw === true,
		creation: item?.creation || null
	};
}

function presentHomeCard(id, item) {
	if (item?.skeleton) return { skeleton: true, width: Number(item.width) || 201, height: Number(item.height) || 268 };
	if (id === 'challenges') return presentChallenge(item);
	if (id === 'articles') return presentArticle(item);
	return presentCreation(item);
}

export async function loadHomeSection(id, context = {}) {
	const load = LOADERS[id];
	if (!load) return { items: [] };
	const fetchJson = context.fetchJson || fetchJsonWithStatusDeduped;
	const result = await load({ ...context, fetchJson });
	return { items: (Array.isArray(result?.items) ? result.items : []).map((item) => presentHomeCard(id, item)) };
}
