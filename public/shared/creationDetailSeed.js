/**
 * Same-origin seed so creation detail (iframe or in-shell) can paint from a feed card
 * without waiting on GET /api/create/images/:id.
 */

import { groupActionSupportedWhenKnown } from './creationGroupMedia.js';
import {
	audioCoverWaveformHtml,
	creationNeedsAudioWaveformCover,
} from './audioCoverWaveform.js';

export const CREATION_DETAIL_SEED_KEY = 'prsn-creation-detail-seed';
export const CREATOR_STRIP_CACHE_KEY = 'prsn-creator-detail-strip';
export const VIEWER_COMPOSER_CACHE_KEY = 'prsn-viewer-comment-composer';

function numId(value) {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function seedTitleText(value) {
	return typeof value === 'string' ? value.trim() : '';
}

function pickSeedTitle(...values) {
	for (const value of values) {
		const t = seedTitleText(value);
		if (t && t !== 'Untitled') return t;
	}
	for (const value of values) {
		const t = seedTitleText(value);
		if (t) return t;
	}
	return '';
}

function parseKnownCommentCount(value) {
	if (value == null || value === '') return null;
	const n = Number(value);
	if (!Number.isFinite(n) || n < 0) return null;
	return Math.floor(n);
}

function seedPublishedFlag(value) {
	if (value === true || value === 1 || value === '1') return true;
	if (value === false || value === 0 || value === '0') return false;
	return null;
}

function seedIsPublished(seedLike) {
	const flag = seedPublishedFlag(seedLike?.published);
	return flag == null ? true : flag;
}

function mergePublishedFlags(primaryValue, fallbackValue) {
	const primary = seedPublishedFlag(primaryValue);
	if (primary != null) return primary;
	const fallback = seedPublishedFlag(fallbackValue);
	if (fallback != null) return fallback;
	return true;
}

function seedDisplayTitle(seedLike) {
	const raw = seedTitleText(seedLike?.title);
	if (raw && raw !== 'Untitled') return { text: raw, untitled: false };
	return { text: 'Untitled', untitled: true };
}

function pickSeedString(...values) {
	for (const value of values) {
		const t = seedTitleText(value);
		if (t) return t;
	}
	return '';
}

function pickSeedMediaType(...values) {
	for (const value of values) {
		const t = typeof value === 'string' ? value.trim().toLowerCase() : '';
		if (t === 'audio' || t === 'video') return t;
	}
	return 'image';
}

function pickFollowerCount(...values) {
	let found = false;
	let fallback = 0;
	for (const value of values) {
		if (value == null || value === '') continue;
		const n = Number(value);
		if (!Number.isFinite(n) || n < 0) continue;
		found = true;
		if (n > 0) return n;
		fallback = n;
	}
	return found ? fallback : null;
}

function seedAuthorPlan(item) {
	const raw = item?.author_plan || item?.creator?.plan || item?.sender_plan;
	return raw === 'founder' ? 'founder' : '';
}

function seedFollowerCount(item) {
	return pickFollowerCount(
		item?.creator_follower_count,
		item?.author_follower_count,
		item?.follower_count,
		item?.stats?.followers_count
	);
}

function mergeSeedThumbList(...lists) {
	const out = [];
	const seen = new Set();
	for (const list of lists) {
		if (!Array.isArray(list)) continue;
		for (const value of list) {
			const url = typeof value === 'string' ? value.trim() : '';
			if (!url || seen.has(url)) continue;
			seen.add(url);
			out.push(url);
		}
	}
	return out;
}

function seedGroupSourceCountFromMeta(meta) {
	const group = meta?.group && typeof meta.group === 'object' ? meta.group : null;
	if (group?.kind !== 'group_creations') return 0;
	const raw = Array.isArray(group.source_creations) ? group.source_creations : [];
	return raw.length;
}

function seedGroupThumbUrlsFromMeta(meta, creationId) {
	const group = meta?.group && typeof meta.group === 'object' ? meta.group : null;
	if (group?.kind !== 'group_creations') return [];
	const raw = Array.isArray(group.source_creations) ? group.source_creations : [];
	const coverId = Number(group.cover_source_id);
	const ordered = [...raw];
	if (Number.isFinite(coverId) && coverId > 0) {
		const idx = ordered.findIndex((row) => Number(row?.id) === coverId);
		if (idx > 0) {
			const [cover] = ordered.splice(idx, 1);
			ordered.unshift(cover);
		}
	}
	const out = [];
	const seen = new Set();
	for (const row of ordered) {
		const url = typeof row?.file_path === 'string' ? row.file_path.trim() : '';
		if (!url || seen.has(url)) continue;
		seen.add(url);
		out.push(url);
	}
	return out;
}

function seedGroupSourceEntries(seed) {
	const meta = seedMetaObject(seed);
	const group = meta?.group && typeof meta.group === 'object' ? meta.group : null;
	const fromMeta = [];
	if (group?.kind === 'group_creations') {
		const raw = Array.isArray(group.source_creations) ? group.source_creations : [];
		const coverId = Number(group.cover_source_id);
		const ordered = [...raw];
		if (Number.isFinite(coverId) && coverId > 0) {
			const idx = ordered.findIndex((row) => Number(row?.id) === coverId);
			if (idx > 0) {
				const [cover] = ordered.splice(idx, 1);
				ordered.unshift(cover);
			}
		}
		for (const row of ordered) {
			if (!row || typeof row !== 'object') continue;
			const id = Number(row.id);
			const url = typeof row.file_path === 'string' ? row.file_path.trim() : '';
			if (!(Number.isFinite(id) && id > 0) && !url) continue;
			const sourceMeta = row.meta && typeof row.meta === 'object' ? row.meta : null;
			fromMeta.push({
				id: Number.isFinite(id) && id > 0 ? id : 0,
				url,
				mediaType: String(sourceMeta?.media_type || row.media_type || '').trim().toLowerCase(),
				meta: sourceMeta,
			});
		}
	}
	const thumbs = Array.isArray(seed?.group_source_thumbs) ? seed.group_source_thumbs : [];
	// Thumbs can include the same source twice (raw file_path + `?creation_id=`).
	// Never let that inflate slots past the known source count.
	const knownCount = Math.max(fromMeta.length, Number(seed?.group_source_count) || 0);
	const count = knownCount > 0 ? knownCount : thumbs.length;
	if (count <= 0) return [];
	const out = [];
	for (let i = 0; i < count; i += 1) {
		const fromRow = fromMeta[i];
		const url =
			(fromRow && fromRow.url) ||
			(typeof thumbs[i] === 'string' ? thumbs[i].trim() : '') ||
			(i === 0 && typeof seed?.image_url === 'string' ? seed.image_url.trim() : '') ||
			(i === 0 && typeof seed?.thumbnail_url === 'string' ? seed.thumbnail_url.trim() : '');
		out.push({
			id: fromRow?.id || 0,
			url,
			mediaType: fromRow?.mediaType || '',
			meta: fromRow?.meta || null,
		});
	}
	return out;
}

function seedGroupSectionHtml(seed) {
	const esc = escapeSeedHtml;
	const entries = seedGroupSourceEntries(seed);
	if (!entries.length) return '';
	const isVideo = String(seed?.media_type || '').trim().toLowerCase() === 'video';
	const noun = isVideo ? 'video' : 'image';
	const subtitle = `${entries.length} ${noun}${entries.length === 1 ? '' : 's'}`;
	const isOwner = seedIsOwner(seed);
	const isPublished = seedIsPublished(seed);
	const group = seed?.meta?.group && typeof seed.meta.group === 'object' ? seed.meta.group : null;
	const showSetCover = isOwner && groupActionSupportedWhenKnown(group, 'set_cover');
	const showUngroup = isOwner && !isPublished && groupActionSupportedWhenKnown(group, 'ungroup');
	const slots = entries
		.map((entry, index) => {
			const active = index === 0 ? ' is-active' : '';
			const id = Number(entry.id);
			const hasId = Number.isFinite(id) && id > 0;
			const thumbAttr = hasId ? ` data-group-source-thumb="${id}"` : '';
			const aria = hasId
				? ` aria-label="View source #${id}"`
				: ' aria-label="Grouped creation"';
			const needsWave = creationNeedsAudioWaveformCover({
				media_type: entry.mediaType,
				url: entry.url,
				file_path: entry.url,
				meta: { ...(entry.meta || {}), media_type: entry.mediaType || entry.meta?.media_type },
			});
			const inner = needsWave
				? audioCoverWaveformHtml('creation-audio-wave creation-detail-group-wave')
				: entry.url
					? `<img src="${esc(entry.url)}" alt="" loading="eager" decoding="async">`
					: `<span class="skeleton" style="display: block; width: 100%; height: 100%;" aria-hidden="true"></span>`;
			const fallbackClass = needsWave
				? ' creation-detail-group-thumb--audio creation-audio-cover'
				: entry.url
					? ''
					: ' creation-detail-group-item-fallback';
			return `<div class="creation-detail-group-slot">
						<div class="creation-detail-group-thumb-wrap">
							<button type="button" class="creation-detail-group-item creation-detail-group-thumb${fallbackClass}${active}"${thumbAttr}${aria}>
								${inner}
							</button>
						</div>
					</div>`;
		})
		.join('');
	const actions = showSetCover || showUngroup
		? `<div class="creation-detail-group-actions">
						${showSetCover
							? `<button type="button" class="btn-secondary creation-detail-group-set-cover-btn" data-group-set-cover-btn disabled>Set as cover</button>`
							: ''}
						${showUngroup
							? `<button type="button" class="btn-secondary creation-detail-ungroup-btn" data-ungroup-btn>Ungroup Creations</button>`
							: ''}
					</div>`
		: '';
	return `<section class="creation-detail-group-section" data-group-creation-section data-seed-group-count="${entries.length}">
				<div class="creation-detail-group-header">
					<h3 class="creation-detail-group-title">Grouped Creations</h3>
					<div class="creation-detail-group-subtitle">${esc(subtitle)}</div>
				</div>
				<div class="creation-detail-group-grid">${slots}</div>
				${actions}
			</section>
			<div class="creation-detail-group-divider" aria-hidden="true"></div>`;
}

/**
 * Prefer the in-memory feed/creations row, but keep click-scraped title/image when lookup omitted them.
 * @param {object | null | undefined} primary
 * @param {object | null | undefined} fallback
 * @returns {object | null}
 */
export function mergeCreationDetailSeeds(primary, fallback) {
	if (!primary && !fallback) return null;
	if (!primary) return fallback;
	if (!fallback) return primary;
	const width = Number(primary.width) > 0 ? primary.width : fallback.width;
	const height = Number(primary.height) > 0 ? primary.height : fallback.height;
	return {
		...fallback,
		...primary,
		title: pickSeedTitle(primary.title, fallback.title),
		image_url: pickSeedString(primary.image_url, fallback.image_url),
		thumbnail_url: pickSeedString(primary.thumbnail_url, fallback.thumbnail_url, primary.image_url, fallback.image_url),
		author_user_name: pickSeedString(primary.author_user_name, fallback.author_user_name),
		author_display_name: pickSeedString(primary.author_display_name, fallback.author_display_name),
		author_avatar_url: pickSeedString(primary.author_avatar_url, fallback.author_avatar_url),
		author_plan:
			primary.author_plan === 'founder' || fallback.author_plan === 'founder'
				? 'founder'
				: pickSeedString(primary.author_plan, fallback.author_plan),
		creator_follower_count: pickFollowerCount(primary.creator_follower_count, fallback.creator_follower_count, primary.follower_count, fallback.follower_count),
		width: Number.isFinite(Number(width)) ? Number(width) : 0,
		height: Number.isFinite(Number(height)) ? Number(height) : 0,
		meta: primary.meta || fallback.meta,
		published: mergePublishedFlags(primary.published, fallback.published),
		media_type: pickSeedMediaType(primary.media_type, fallback.media_type),
		comment_count: (() => {
			const a = parseKnownCommentCount(primary.comment_count);
			const b = parseKnownCommentCount(fallback.comment_count);
			if (a == null) return b;
			if (b == null) return a;
			return Math.max(a, b);
		})(),
		group_source_count: (() => {
			const metaCount = Math.max(
				seedGroupSourceCountFromMeta(primary.meta),
				seedGroupSourceCountFromMeta(fallback.meta)
			);
			if (metaCount > 0) return metaCount;
			return Math.max(Number(primary.group_source_count) || 0, Number(fallback.group_source_count) || 0);
		})(),
		group_source_thumbs: mergeSeedThumbList(
			primary.group_source_thumbs,
			fallback.group_source_thumbs,
			seedGroupThumbUrlsFromMeta(primary.meta, primary.id),
			seedGroupThumbUrlsFromMeta(fallback.meta, fallback.id)
		),
		status: pickSeedString(primary.status, fallback.status),
		import_provider: pickSeedString(primary.import_provider, fallback.import_provider),
		editorial_pin: Boolean(primary.editorial_pin || fallback.editorial_pin),
		editorial_pin_show_metadata:
			primary.editorial_pin_show_metadata === false || fallback.editorial_pin_show_metadata === false
				? false
				: true,
		viewer_user_id: numId(primary.viewer_user_id) || numId(fallback.viewer_user_id),
		viewer_avatar_url: pickSeedString(primary.viewer_avatar_url, fallback.viewer_avatar_url),
		viewer_display_name: pickSeedString(primary.viewer_display_name, fallback.viewer_display_name),
		viewer_user_name: pickSeedString(primary.viewer_user_name, fallback.viewer_user_name),
		viewer_plan:
			primary.viewer_plan === 'founder' || fallback.viewer_plan === 'founder'
				? 'founder'
				: pickSeedString(primary.viewer_plan, fallback.viewer_plan),
		video_url: pickSeedString(primary.video_url, fallback.video_url),
		challenge_ended: Boolean(primary.challenge_ended || fallback.challenge_ended),
	};
}

function looksLikeLatestCommentRow(item) {
	if (!item || typeof item !== 'object') return false;
	if (!numId(item.created_image_id)) return false;
	return (
		item.created_image_title != null ||
		item.created_image_url != null ||
		item.created_image_thumbnail_url != null ||
		item.created_image_user_id != null ||
		item.created_image_published != null ||
		item.created_image_meta != null
	);
}

function feedLikeItemFromLatestCommentRow(item) {
	const id = numId(item.created_image_id);
	const imageUrl =
		(typeof item.created_image_url === 'string' && item.created_image_url.trim()) ||
		(typeof item.created_image_thumbnail_url === 'string' && item.created_image_thumbnail_url.trim()) ||
		'';
	const thumb =
		(typeof item.created_image_thumbnail_url === 'string' && item.created_image_thumbnail_url.trim()) ||
		imageUrl;
	return {
		created_image_id: id,
		id,
		title: typeof item.created_image_title === 'string' ? item.created_image_title : '',
		image_url: imageUrl,
		thumbnail_url: thumb,
		media_type: typeof item.created_image_media_type === 'string' ? item.created_image_media_type : 'image',
		user_id: item.created_image_user_id,
		author_user_name: item.created_image_user_name,
		author_display_name: item.created_image_display_name,
		author_avatar_url: item.created_image_avatar_url,
		author_plan: item.created_image_owner_plan,
		published: item.created_image_published,
		created_at: item.created_image_created_at || null,
		meta: item.created_image_meta && typeof item.created_image_meta === 'object' ? item.created_image_meta : null,
		nsfw: Boolean(item.nsfw),
		status: 'completed',
	};
}

/**
 * @param {object | null | undefined} item
 * @returns {object | null}
 */
export function feedItemToCreationDetailSeed(item) {
	if (!item || typeof item !== 'object') return null;
	if (looksLikeLatestCommentRow(item)) item = feedLikeItemFromLatestCommentRow(item);
	const id = numId(item.created_image_id ?? item.id);
	if (!id) return null;
	const groupId = numId(item.group_id);
	const imageUrl =
		(typeof item.url === 'string' && item.url.trim()) ||
		(typeof item.image_url === 'string' && item.image_url.trim()) ||
		(typeof item.thumbnail_url === 'string' && item.thumbnail_url.trim()) ||
		'';
	const thumb =
		(typeof item.thumbnail_url === 'string' && item.thumbnail_url.trim()) || imageUrl;
	const { text: title, untitled: titleUntitled } = seedDisplayTitle({
		title: typeof item.title === 'string' ? item.title : '',
		published: item.published,
	});
	const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
	const authorUserName =
		typeof item.author_user_name === 'string' ? item.author_user_name.trim() : '';
	const authorDisplay =
		typeof item.author_display_name === 'string'
			? item.author_display_name.trim()
			: typeof item.author === 'string'
				? item.author.trim()
				: '';
	const authorAvatar =
		typeof item.author_avatar_url === 'string' ? item.author_avatar_url.trim() : '';
	const userId = numId(item.user_id);
	let meta = item.meta && typeof item.meta === 'object' ? item.meta : null;
	if (typeof item.meta === 'string' && item.meta) {
		try {
			meta = JSON.parse(item.meta);
		} catch {
			meta = null;
		}
	}
	const width = Number(item.width);
	const height = Number(item.height);
	return {
		id,
		group_id: groupId,
		image_url: imageUrl,
		thumbnail_url: thumb,
		video_url: typeof item.video_url === 'string' ? item.video_url.trim() : '',
		media_type: typeof item.media_type === 'string' ? item.media_type : 'image',
		width: Number.isFinite(width) && width > 0 ? width : 0,
		height: Number.isFinite(height) && height > 0 ? height : 0,
		title,
		title_untitled: titleUntitled,
		summary,
		like_count: Number(item.like_count) || 0,
		viewer_liked: Boolean(item.viewer_liked),
		comment_count: parseKnownCommentCount(item.comment_count),
		group_source_count: seedGroupSourceCountFromMeta(meta),
		group_source_thumbs: seedGroupThumbUrlsFromMeta(meta, id),
		nsfw: Boolean(item.nsfw),
		user_id: userId,
		author_user_name: authorUserName,
		author_display_name: authorDisplay,
		author_avatar_url: authorAvatar,
		author_plan: seedAuthorPlan(item),
		creator_follower_count: seedFollowerCount(item),
		created_at: item.created_at || null,
		published_at: item.published_at || item.created_at || null,
		published: seedPublishedFlag(item.published) !== false,
		status: typeof item.status === 'string' ? item.status.trim() : '',
		editorial_pin: item.editorial_pin === true,
		editorial_pin_show_metadata: item.editorial_pin_show_metadata !== false,
		import_provider:
			meta?.import && typeof meta.import.provider === 'string' ? meta.import.provider.trim() : '',
		meta,
		challenge_ended: item.challenge_ended === true,
	};
}

/**
 * Map a detail seed into the creation payload mutate expects.
 * When sourceId is set (group mutate), the seed must have a matching mutate_source_id.
 * @param {object | null | undefined} seed
 * @param {{ sourceId?: unknown }} [opts]
 * @returns {object | null}
 */
export function seedToMutateCreation(seed, opts = {}) {
	if (!seed || typeof seed !== 'object') return null;
	const sourceId = numId(opts?.sourceId);
	if (sourceId) {
		const tagged = numId(seed.mutate_source_id);
		if (!tagged || tagged !== sourceId) return null;
	}
	const imageUrl = pickSeedString(
		sourceId ? seed.mutate_image_url : '',
		seed.image_url,
		seed.url,
		seed.thumbnail_url
	);
	if (!imageUrl) return null;
	const id = sourceId || numId(seed.id);
	if (!id) return null;
	const status =
		typeof seed.status === 'string' && seed.status.trim() ? seed.status.trim() : 'completed';
	const width = Number(seed.width);
	const height = Number(seed.height);
	const userId = numId(seed.user_id);
	const groupId = sourceId ? numId(seed.id) : numId(seed.group_id);
	const creator =
		seed.creator && typeof seed.creator === 'object'
			? seed.creator
			: userId
				? {
					id: userId,
					user_name: seed.author_user_name || null,
					display_name: seed.author_display_name || null,
					avatar_url: seed.author_avatar_url || null,
				}
				: null;
	return {
		id,
		url: imageUrl,
		status,
		title: typeof seed.title === 'string' ? seed.title : '',
		group_id: groupId,
		user_id: userId,
		width: Number.isFinite(width) && width > 0 ? width : 0,
		height: Number.isFinite(height) && height > 0 ? height : 0,
		published: seedPublishedFlag(seed.published),
		media_type: typeof seed.media_type === 'string' && seed.media_type.trim()
			? seed.media_type.trim()
			: 'image',
		creator,
		meta: seed.meta && typeof seed.meta === 'object' ? seed.meta : null,
	};
}

/**
 * @param {Event | null | undefined} ev
 * @param {number} creationId
 * @returns {object | null}
 */
export function creationDetailSeedFromClick(ev, creationId) {
	const id = numId(creationId);
	if (!id) return null;
	const target = ev?.target;
	if (!(target instanceof Element)) return null;
	const card = target.closest('[data-creation-id], .feed-card, .route-card, .connect-comment');
	const titleEl = card instanceof Element ? card.querySelector('.feed-card-title, .connect-comment-creation-title, .connect-comment-title, .route-details-title, .creation-detail-title') : null;
	const title = titleEl?.textContent?.trim() || '';
	const titleUntitled = Boolean(titleEl?.classList?.contains('feed-card-title--untitled') || titleEl?.classList?.contains('creation-detail-title-untitled'));
	const handleEl = card instanceof Element
		? card.querySelector('.connect-comment-creator .comment-author-handle, .feed-card-author-handle, .connect-comment-author')
		: null;
	const displayEl = card instanceof Element
		? card.querySelector('.connect-comment-creator .comment-author-name')
		: null;
	const founder = Boolean(
		card instanceof Element &&
			card.querySelector('.connect-comment-creator .founder-name, .feed-card-content .founder-name, .avatar-with-founder-flair, .founder-flair-avatar-ring')
	);
	const thumbImg =
		card instanceof Element
			? card.querySelector('.connect-comment-thumb-img, .feed-card-img')
			: null;
	const img =
		thumbImg instanceof HTMLImageElement
			? thumbImg
			: (card instanceof Element && card.querySelector('img')) ||
				(target instanceof HTMLImageElement ? target : null);
	const previewFromCard =
		card instanceof Element ? String(card.dataset.previewImageUrl || '').trim() : '';
	const src =
		previewFromCard ||
		(img instanceof HTMLImageElement ? String(img.currentSrc || img.src || '').trim() : '');
	const nw = img instanceof HTMLImageElement ? Number(img.naturalWidth) : 0;
	const nh = img instanceof HTMLImageElement ? Number(img.naturalHeight) : 0;
	const avatarImg = card instanceof Element
		? card.querySelector('.connect-comment-creator .comment-avatar-img, .connect-comment-creator img, .feed-card-avatar-img, .founder-flair-avatar-inner img, .creation-detail-author-avatar')
		: null;
	const avatarUrl =
		avatarImg instanceof HTMLImageElement ? String(avatarImg.currentSrc || avatarImg.src || '').trim() : '';
	const publishedAttr = card instanceof Element ? card.dataset.published : undefined;
	const published =
		publishedAttr === '1' ? true : publishedAttr === '0' ? false : null;
	const mediaTypeRaw = card instanceof Element ? String(card.dataset.mediaType || '').trim().toLowerCase() : '';
	const mediaType =
		mediaTypeRaw === 'audio' || mediaTypeRaw === 'video'
			? mediaTypeRaw
			: card instanceof Element && card.querySelector('.creation-music-badge:not(.creation-video-import-badge)')
				? 'audio'
				: card instanceof Element && card.querySelector('.creation-video-import-badge')
					? 'video'
					: 'image';
	const importProvider =
		card instanceof Element ? String(card.dataset.importProvider || '').trim() : '';
	const comment_count =
		card instanceof Element && Object.prototype.hasOwnProperty.call(card.dataset, 'commentCount')
			? parseKnownCommentCount(card.dataset.commentCount)
			: null;
	const userId = card instanceof Element ? numId(card.dataset.userId) : null;
	const status = card instanceof Element ? String(card.dataset.creationStatus || '').trim() : '';
	const editorialPin = card instanceof Element && card.dataset.editorialPin === '1';
	const editorialPinShowMetadata =
		card instanceof Element && card.dataset.editorialPinShowMetadata === '0' ? false : null;
	const groupSourceCountRaw = card instanceof Element ? Number(card.dataset.groupSourceCount) : NaN;
	const groupImgs =
		card instanceof Element
			? Array.from(card.querySelectorAll('.feed-card-group-img, [data-feed-card-group-carousel] img'))
			: [];
	const group_source_thumbs = [];
	const seenGroupThumbs = new Set();
	for (const img of groupImgs) {
		if (!(img instanceof HTMLImageElement)) continue;
		const url = String(img.currentSrc || img.src || '').trim();
		if (!url || seenGroupThumbs.has(url)) continue;
		seenGroupThumbs.add(url);
		group_source_thumbs.push(url);
	}
	const datasetCount =
		Number.isFinite(groupSourceCountRaw) && groupSourceCountRaw > 0 ? groupSourceCountRaw : 0;
	const scrapedCount =
		card instanceof Element && card.dataset.groupCreation === '1'
			? Math.max(group_source_thumbs.length, 1)
			: group_source_thumbs.length;
	const group_source_count = datasetCount > 0 ? datasetCount : scrapedCount;
	if (!group_source_thumbs.length && src && group_source_count > 0) group_source_thumbs.push(src);
	return {
		id,
		image_url: src,
		thumbnail_url: src,
		width: Number.isFinite(nw) && nw > 0 ? nw : 0,
		height: Number.isFinite(nh) && nh > 0 ? nh : 0,
		title,
		title_untitled: titleUntitled,
		author_user_name: handleEl?.textContent?.replace(/^@/, '').trim() || '',
		author_display_name: displayEl?.textContent?.trim() || '',
		author_avatar_url: avatarUrl,
		author_plan: founder ? 'founder' : '',
		like_count: 0,
		viewer_liked: false,
		media_type: mediaType,
		comment_count,
		group_source_count,
		group_source_thumbs,
		user_id: userId,
		status,
		import_provider: importProvider,
		editorial_pin: editorialPin,
		...(editorialPinShowMetadata === false ? { editorial_pin_show_metadata: false } : {}),
		...(published != null ? { published } : {}),
	};
}

export function writeCreationDetailSeed(seed) {
	if (!seed || typeof seed !== 'object') return;
	const id = numId(seed.id);
	if (!id) return;
	try {
		sessionStorage.setItem(
			CREATION_DETAIL_SEED_KEY,
			JSON.stringify({ ...seed, id, cachedAt: Date.now() })
		);
	} catch {
		// quota / private mode
	}
}

/**
 * @param {number} creationId
 * @returns {object | null}
 */
export function readCreationDetailSeed(creationId) {
	const id = numId(creationId);
	if (!id) return null;
	try {
		const raw = sessionStorage.getItem(CREATION_DETAIL_SEED_KEY);
		if (!raw) return null;
		const o = JSON.parse(raw);
		if (numId(o?.id) !== id) return null;
		const age = Date.now() - Number(o.cachedAt || 0);
		if (Number.isFinite(age) && age > 5 * 60 * 1000) return null;
		return applyViewerComposerCacheToSeed(applyCreatorStripCacheToSeed(o));
	} catch {
		return null;
	}
}

function readCreatorStripCacheMap() {
	try {
		const raw = sessionStorage.getItem(CREATOR_STRIP_CACHE_KEY);
		if (!raw) return {};
		const o = JSON.parse(raw);
		return o && typeof o === 'object' ? o : {};
	} catch {
		return {};
	}
}

/**
 * @param {{ userId?: unknown, plan?: unknown, followerCount?: unknown, avatarUrl?: unknown, displayName?: unknown }} entry
 */
export function writeCreatorStripCache(entry) {
	const userId = numId(entry?.userId ?? entry?.user_id);
	if (!userId) return;
	try {
		const all = readCreatorStripCacheMap();
		const prev = all[String(userId)] && typeof all[String(userId)] === 'object' ? all[String(userId)] : {};
		all[String(userId)] = {
			plan: entry.plan === 'founder' || prev.plan === 'founder' ? 'founder' : '',
			followerCount: pickFollowerCount(entry.followerCount, entry.creator_follower_count, prev.followerCount),
			avatarUrl: pickSeedString(entry.avatarUrl, entry.author_avatar_url, prev.avatarUrl),
			displayName: pickSeedString(entry.displayName, entry.author_display_name, prev.displayName),
			cachedAt: Date.now(),
		};
		sessionStorage.setItem(CREATOR_STRIP_CACHE_KEY, JSON.stringify(all));
	} catch {
		// quota / private mode
	}
}

export function writeViewerComposerCache(entry) {
	if (!entry || typeof entry !== 'object') return;
	try {
		const prev = readViewerComposerCache() || {};
		const next = {
			userId: numId(entry.userId ?? entry.user_id ?? entry.viewer_user_id ?? entry.id) || prev.userId || null,
			avatarUrl: pickSeedString(entry.avatarUrl, entry.viewer_avatar_url, prev.avatarUrl),
			displayName: pickSeedString(entry.displayName, entry.viewer_display_name, prev.displayName),
			userName: pickSeedString(entry.userName, entry.viewer_user_name, prev.userName),
			plan:
				entry.plan === 'founder' || entry.viewer_plan === 'founder' || prev.plan === 'founder'
					? 'founder'
					: '',
			cachedAt: Date.now(),
		};
		if (!next.userId && !next.avatarUrl && !next.displayName) return;
		sessionStorage.setItem(VIEWER_COMPOSER_CACHE_KEY, JSON.stringify(next));
	} catch {
		// quota / private mode
	}
}

export function readViewerComposerCache() {
	try {
		const raw = sessionStorage.getItem(VIEWER_COMPOSER_CACHE_KEY);
		if (!raw) return null;
		const o = JSON.parse(raw);
		if (!o || typeof o !== 'object') return null;
		const age = Date.now() - Number(o.cachedAt || 0);
		if (Number.isFinite(age) && age > 30 * 60 * 1000) return null;
		return o;
	} catch {
		return null;
	}
}

export function applyViewerComposerCacheToSeed(seed) {
	if (!seed || typeof seed !== 'object') return seed;
	const cached = readViewerComposerCache();
	if (!cached) return seed;
	return mergeCreationDetailSeeds(seed, {
		viewer_user_id: cached.userId,
		viewer_avatar_url: cached.avatarUrl,
		viewer_display_name: cached.displayName,
		viewer_user_name: cached.userName,
		viewer_plan: cached.plan,
	});
}

export function applyViewerComposerToSeed(seed, viewer) {
	if (!seed || typeof seed !== 'object') return seed;
	const next = {
		...seed,
		viewer_user_id: numId(viewer?.id ?? viewer?.userId ?? viewer?.user_id) || numId(seed.viewer_user_id),
		viewer_avatar_url: pickSeedString(viewer?.avatarUrl, viewer?.viewer_avatar_url, seed.viewer_avatar_url),
		viewer_display_name: pickSeedString(viewer?.displayName, viewer?.viewer_display_name, seed.viewer_display_name),
		viewer_user_name: pickSeedString(viewer?.userName, viewer?.viewer_user_name, seed.viewer_user_name),
		viewer_plan:
			viewer?.plan === 'founder' || seed.viewer_plan === 'founder' ? 'founder' : pickSeedString(viewer?.plan, seed.viewer_plan),
	};
	writeViewerComposerCache(next);
	return applyViewerComposerCacheToSeed(next);
}

export function readCreatorStripCache(userId) {
	const id = numId(userId);
	if (!id) return null;
	const row = readCreatorStripCacheMap()[String(id)];
	if (!row || typeof row !== 'object') return null;
	const age = Date.now() - Number(row.cachedAt || 0);
	if (Number.isFinite(age) && age > 30 * 60 * 1000) return null;
	return row;
}

export function applyCreatorStripCacheToSeed(seed) {
	if (!seed || typeof seed !== 'object') return seed;
	const cached = readCreatorStripCache(seed.user_id);
	if (!cached) return seed;
	return mergeCreationDetailSeeds(seed, {
		author_plan: cached.plan,
		creator_follower_count: cached.followerCount,
		author_avatar_url: cached.avatarUrl,
		author_display_name: cached.displayName,
	});
}

const creatorStripPrefetch = new Map();

export function prefetchCreatorStrip(userId) {
	const id = numId(userId);
	if (!id) return Promise.resolve(null);
	const cached = readCreatorStripCache(id);
	if (cached) return Promise.resolve(cached);
	const existing = creatorStripPrefetch.get(id);
	if (existing) return existing;
	const pending = fetch(`/api/users/${id}/profile`, { credentials: 'include' })
		.then((res) => (res.ok ? res.json() : null))
		.then((data) => {
			if (!data) return null;
			const entry = {
				userId: id,
				plan: data.plan === 'founder' ? 'founder' : '',
				followerCount: Number(data.stats?.followers_count ?? 0) || 0,
				avatarUrl: typeof data.profile?.avatar_url === 'string' ? data.profile.avatar_url : '',
				displayName: typeof data.profile?.display_name === 'string' ? data.profile.display_name : '',
			};
			writeCreatorStripCache(entry);
			return readCreatorStripCache(id);
		})
		.catch(() => null);
	creatorStripPrefetch.set(id, pending);
	return pending;
}

export async function enrichCreationDetailSeedCreatorStrip(creationId, { waitMs = 400 } = {}) {
	const seed = readCreationDetailSeed(creationId);
	if (!seed?.user_id) return seed;
	if (readCreatorStripCache(seed.user_id)) {
		const next = applyCreatorStripCacheToSeed(seed);
		writeCreationDetailSeed(next);
		return next;
	}
	const wait = prefetchCreatorStrip(seed.user_id);
	const timeoutMs = Number(waitMs);
	const raced =
		Number.isFinite(timeoutMs) && timeoutMs > 0
			? await Promise.race([
					wait,
					new Promise((resolve) => {
						setTimeout(() => resolve(null), timeoutMs);
					}),
				])
			: await wait;
	if (!raced) return seed;
	const next = applyCreatorStripCacheToSeed(readCreationDetailSeed(creationId) || seed);
	writeCreationDetailSeed(next);
	return next;
}

function escapeSeedHtml(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function seedMetaObject(seed) {
	const meta = seed?.meta;
	if (meta && typeof meta === 'object' && !Array.isArray(meta)) return meta;
	if (typeof meta === 'string' && meta) {
		try {
			const parsed = JSON.parse(meta);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
		} catch {
			return null;
		}
	}
	return null;
}

function seedPromptText(meta) {
	if (!meta) return '';
	const stored = typeof meta.user_prompt === 'string' ? meta.user_prompt.trim() : '';
	if (stored) return stored;
	const args = meta.args;
	const argsPrompt =
		args && typeof args === 'object' && !Array.isArray(args) && typeof args.prompt === 'string'
			? args.prompt.trim()
			: '';
	if (!argsPrompt || argsPrompt.startsWith('{')) return '';
	return argsPrompt;
}

function seedDisplayModel(meta) {
	const args = meta?.args;
	if (!args || typeof args !== 'object' || Array.isArray(args)) return '';
	const raw =
		typeof args.model === 'string' ? args.model.trim() : String(args.model ?? '').trim();
	if (!raw) return '';
	return raw.includes(':') ? raw.split(':')[0] : raw;
}

function seedDurationStr(meta) {
	if (!meta) return '';
	let ms =
		typeof meta.duration_ms === 'number' && Number.isFinite(meta.duration_ms)
			? meta.duration_ms
			: null;
	if (ms == null) {
		const started = meta.started_at ? Date.parse(meta.started_at) : NaN;
		const endedRaw = meta.completed_at || meta.failed_at || null;
		const ended = endedRaw ? Date.parse(endedRaw) : NaN;
		if (Number.isFinite(started) && Number.isFinite(ended) && ended >= started) {
			ms = ended - started;
		}
	}
	if (!Number.isFinite(ms) || ms <= 0) return '';
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	const rem = Math.round(seconds % 60);
	if (minutes >= 60) {
		const hours = Math.floor(minutes / 60);
		return `${hours}h ${minutes % 60}m`;
	}
	return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`;
}

function seedRelativeTime(value) {
	const date = value instanceof Date ? value : new Date(value);
	if (!(date instanceof Date) || !Number.isFinite(date.valueOf())) return '';
	const deltaSec = Math.round((date.getTime() - Date.now()) / 1000);
	const abs = Math.abs(deltaSec);
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
	if (abs < 60) return rtf.format(deltaSec, 'second');
	const minutes = Math.round(deltaSec / 60);
	if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
	const hours = Math.round(deltaSec / 3600);
	if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
	const days = Math.round(deltaSec / 86400);
	if (Math.abs(days) < 30) return rtf.format(days, 'day');
	const months = Math.round(deltaSec / 2592000);
	if (Math.abs(months) < 12) return rtf.format(months, 'month');
	return rtf.format(Math.round(deltaSec / 31536000), 'year');
}

function seedMediaType(seed) {
	return pickSeedMediaType(seed?.media_type, seedMetaObject(seed)?.media_type);
}

function seedIsImportEmbed(seed) {
	const mediaType = seedMediaType(seed);
	if (mediaType === 'audio') return true;
	const provider = pickSeedString(seed?.import_provider, seedMetaObject(seed)?.import?.provider).toLowerCase();
	return mediaType === 'video' && provider === 'youtube';
}

function seedHasActiveFeedPin(meta) {
	const arr = meta?.challenge_feed_pins;
	if (!Array.isArray(arr) || arr.length === 0) return false;
	const now = Date.now();
	return arr.some((raw) => {
		if (!raw || typeof raw !== 'object') return false;
		if (!(raw.pin_id != null ? String(raw.pin_id).trim() : '')) return false;
		const startsAt = typeof raw.starts_at === 'string' && raw.starts_at.trim() ? Date.parse(raw.starts_at) : NaN;
		if (Number.isFinite(startsAt) && now < startsAt) return false;
		const until = typeof raw.until === 'string' && raw.until.trim() ? Date.parse(raw.until) : NaN;
		if (Number.isFinite(until) && now > until) return false;
		return true;
	});
}

function seedIsChallengeResults(meta) {
	return (
		Array.isArray(meta?.challenge_organizer_refs) &&
		meta.challenge_organizer_refs.some(
			(r) => r && typeof r === 'object' && String(r.role || '').trim().toLowerCase() === 'results'
		)
	);
}

function seedHasOrganizerRef(meta) {
	const arr = meta?.challenge_organizer_refs;
	if (!Array.isArray(arr) || arr.length === 0) return false;
	return arr.some((r) => r && typeof r === 'object' && String(r.challenge_id || '').trim());
}

function seedHasChallengeSubmissions(meta) {
	return Array.isArray(meta?.challenge_submissions) && meta.challenge_submissions.length > 0;
}

function seedIsGroupCreation(meta) {
	const kind = meta?.group?.kind;
	return kind === 'group_creations' || kind === 'group_v2';
}

function seedHideIdentifyChrome(seed) {
	if (seed?.editorial_pin_show_metadata === false) return true;
	const meta = seedMetaObject(seed);
	return seedHasActiveFeedPin(meta) || seedIsChallengeResults(meta);
}

function seedStatus(seed) {
	const s = typeof seed?.status === 'string' ? seed.status.trim().toLowerCase() : '';
	return s || 'completed';
}

function seedIsOwner(seed) {
	const viewer = numId(seed?.viewer_user_id);
	const owner = numId(seed?.user_id);
	if (!viewer || !owner) return false;
	return viewer === owner;
}

function seedShowComments(seed) {
	if (seedStatus(seed) === 'failed') return false;
	return seedIsPublished(seed) || seedHideIdentifyChrome(seed);
}

function seedViewerComposerReady(seed) {
	const avatar = typeof seed?.viewer_avatar_url === 'string' ? seed.viewer_avatar_url.trim() : '';
	const name = pickSeedString(seed?.viewer_display_name, seed?.viewer_user_name);
	return Boolean(avatar || name);
}

function seedCommentComposerHtml(seed) {
	const esc = escapeSeedHtml;
	if (!seedViewerComposerReady(seed)) {
		return `<div class="comment-input" data-comment-input data-comment-input-skeleton>
				<div class="comment-avatar"><span class="skeleton skeleton-circle" style="width: 32px; height: 32px;" aria-hidden="true"></span></div>
				<div class="comment-input-body">
					<div class="comment-composer-row">
						<span class="skeleton skeleton-line" style="display: block; height: 40px; border-radius: 8px; flex: 1;"></span>
					</div>
				</div>
			</div>`;
	}
	const avatarUrl = typeof seed.viewer_avatar_url === 'string' ? seed.viewer_avatar_url.trim() : '';
	const display = pickSeedString(seed.viewer_display_name, seed.viewer_user_name);
	const initial = (display || '?').charAt(0).toUpperCase();
	const founder = seed.viewer_plan === 'founder';
	const plusSvg = '<svg class="comment-input-attach-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>';
	const sendSvg = '<svg class="comment-send-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.6 21 12 3.4 3.4 3 10l11 2L3 14l.4 6.6Z"></path></svg>';
	const avatarInner = avatarUrl
		? `<img class="comment-avatar-img" src="${esc(avatarUrl)}" alt="">`
		: esc(initial);
	const avatarHtml = founder
		? `<div class="avatar-with-founder-flair avatar-with-founder-flair--sm">
							<div class="founder-flair-avatar-ring">
								<div class="founder-flair-avatar-inner" data-founder-flair-avatar-bg aria-hidden="true">
									${avatarInner}
								</div>
							</div>
						</div>`
		: avatarInner;
	return `<div class="comment-input" data-comment-input data-comment-input-adorned>
				<div class="comment-avatar"${founder ? '' : ' style="background: var(--surface);"'}>${avatarHtml}</div>
				<div class="comment-input-body">
					<div class="comment-composer-row">
						<button type="button" class="comment-input-attach" data-comment-attach aria-label="Attach image">${plusSvg}</button>
						<textarea class="comment-textarea comment-textarea--composer" rows="1" placeholder="What do you like about this creation?" maxlength="4000" data-comment-textarea></textarea>
						<button class="comment-submit-btn comment-submit-btn--composer" type="button" data-comment-submit>
							<span class="comment-action-btn-label comment-action-btn-label--arrow" aria-hidden="true">${sendSvg}</span>
							<span class="comment-action-btn-spinner" aria-hidden="true"></span>
						</button>
						<input type="file" hidden accept="image/*" data-comment-attach-input />
					</div>
					<span class="comment-input-attach-status" data-comment-attach-status aria-live="polite"></span>
				</div>
			</div>`;
}

function seedCommentsHtml(seed) {
	if (!seedShowComments(seed)) return '';
	const count = parseKnownCommentCount(seed?.comment_count);
	const known = count != null;
	const heading = !known ? 'Comments' : count === 1 ? '1 Comment' : `${count} Comments`;
	const emptyList =
		'<div class="route-empty route-empty-state comments-empty"><div class="route-empty-title">No comments yet</div><div class="route-empty-message">Be the first to say something.</div></div>';
	const skeletonRow = `<div class="creation-comments-skeleton-row">
				<div class="skeleton skeleton-circle" style="width:32px;height:32px;border-radius:50%"></div>
				<div class="creation-comments-skeleton-body">
					<div class="skeleton skeleton-line skeleton-line--short"></div>
					<div class="skeleton skeleton-line skeleton-line--medium"></div>
					<div class="skeleton skeleton-line" style="max-width:72%"></div>
				</div>
			</div>`;
	const skeletonList = `<div class="creation-comments-loading" role="status" aria-live="polite" aria-busy="true">${skeletonRow.repeat(
		known && count > 0 ? Math.min(count, 3) : 3
	)}</div>`;
	const listInner = known && count === 0 ? emptyList : skeletonList;
	const sortId = `comments-sort-${numId(seed.id) || 'pending'}`;
	const countAttr = known ? ` data-seed-comment-count="${count}"` : '';
	return `<div data-creation-comments-host${countAttr}>
			<div class="creation-comments-thread" data-creation-comments-thread>
				${seedCommentComposerHtml(seed)}
				<div class="creation-detail-comments-section" data-comments-section>
					<div class="comments-toolbar"${known && count === 0 ? ' style="display: none;"' : ''}>
						<h3 class="comments-heading"><span data-comment-count>${heading}</span></h3>
						<div class="comments-sort">
							<label class="comments-sort-label" for="${sortId}">Sort by</label>
							<select class="comments-sort-select" id="${sortId}" data-comments-sort disabled>
								<option value="asc">Oldest</option>
								<option value="desc">Most recent</option>
							</select>
						</div>
					</div>
					<div id="comments" data-comments-anchor></div>
					<div class="comment-list" data-comment-list>${listInner}</div>
				</div>
			</div>
		</div>`;
}

const SEED_HEART_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5 5 0 0 0-7.1 0L12 6.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l1.7 1.7L12 21l7.1-7.6 1.7-1.7a5 5 0 0 0 0-7.1z"></path></svg>`;
const SEED_SPARKLE_SVG = `<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-80q0-83-31.5-156T363-363q-54-54-127-85.5T80-480q83 0 156-31.5T363-597q54-54 85.5-127T480-880q0 83 31.5 156T597-597q54 54 127 85.5T880-480q-83 0-156 31.5T597-363q-54 54-85.5 127T480-80Z"></path></svg>`;
const SEED_SHARE_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 3.158V7.51c-5.428.223-8.27 3.75-8.875 11.199-.04.487-.07.975-.09 1.464l-.014.395c-.014.473.578.684.88.32.302-.368.61-.73.925-1.086l.244-.273c1.79-1.967 3-2.677 4.93-2.917a18.011 18.011 0 012-.112v4.346a1 1 0 001.646.763l9.805-8.297 1.55-1.31-1.55-1.31-9.805-8.297A1 1 0 0010 3.158Zm2 6.27v.002-4.116l7.904 6.688L12 18.689v-4.212l-2.023.024c-1.935.022-3.587.17-5.197 1.024a9 9 0 00-1.348.893c.355-1.947.916-3.39 1.63-4.425 1.062-1.541 2.607-2.385 5.02-2.485L12 9.428Z"></path></svg>`;
const SEED_CREDIT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M 9.301 16.612 L 9.301 7.758 L 12.641 7.758 C 13.231 7.758 13.678 7.786 13.988 7.841 C 14.424 7.915 14.788 8.053 15.08 8.257 C 15.376 8.459 15.614 8.745 15.791 9.112 C 15.97 9.477 16.06 9.881 16.06 10.318 C 16.06 11.071 15.821 11.709 15.34 12.231 C 14.862 12.753 13.996 13.013 12.744 13.013 L 10.474 13.013 L 10.474 16.612 L 9.301 16.612 Z M 10.474 11.967 L 12.762 11.967 C 13.518 11.967 14.057 11.826 14.375 11.544 C 14.694 11.264 14.853 10.866 14.853 10.354 C 14.853 9.985 14.759 9.667 14.572 9.403 C 14.385 9.141 14.138 8.967 13.832 8.881 C 13.634 8.829 13.271 8.803 12.739 8.803 L 10.474 8.803 L 10.474 11.967 Z" fill="currentColor" stroke-linejoin="miter" stroke-width="1"></path></svg>`;
const SEED_COPY_SVG = `<svg class="creation-detail-copy-prompt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const SEED_PUBLISH_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.5 8L14.5 1.5L10.5 14.5L8 9L1.5 8Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" /></svg>`;
const SEED_EDIT_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11.5 2.5L13.5 4.5L5.5 12.5H3.5V10.5L11.5 2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" /></svg>`;
const SEED_CHALLENGE_TROPHY_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"></path><path d="M7 8H5a2 2 0 0 1-2-2V5h4"></path><path d="M17 8h2a2 2 0 0 0 2-2V5h-4"></path></svg>`;
const SEED_CHALLENGE_COG_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0 1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0 1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;

function seedChallengeSlotHtml(seed) {
	const meta = seedMetaObject(seed);
	const isOwner = seedIsOwner(seed);
	const isPublished = seedIsPublished(seed);
	const completed = seedStatus(seed) === 'completed';
	const hasPin = seedHasActiveFeedPin(meta);
	const hasOrganizerRef = seedHasOrganizerRef(meta);
	const hasSubmissions = seedHasChallengeSubmissions(meta);
	const allEnded = seed?.challenge_ended === true;
	const showSubmit =
		isOwner &&
		completed &&
		!isPublished &&
		!seedIsGroupCreation(meta) &&
		!hasPin &&
		!hasOrganizerRef &&
		groupActionSupportedWhenKnown(meta?.group, 'challenge_submit');
	const showAssign =
		isOwner &&
		!isPublished &&
		!hasPin &&
		groupActionSupportedWhenKnown(meta?.group, 'challenge_assign');
	const challengesHref = '/chat/c/challenges';
	let banners = '';
	if (hasOrganizerRef && !hasPin) {
		const detail = isOwner
			? 'This creation is attached to a challenge as challenge media. It can’t be published, deleted, or submitted as an entry while that use remains.'
			: 'This creation is used as challenge media.';
		banners += `<div class="creation-detail-challenge-banner" role="status">
				<div class="creation-detail-challenge-banner-main">
					<div class="creation-detail-challenge-banner-icon">${SEED_CHALLENGE_TROPHY_SVG}</div>
					<div class="creation-detail-challenge-banner-body">
						<p class="creation-detail-challenge-banner-title">Challenge media</p>
						<p class="creation-detail-challenge-banner-detail">${detail}</p>
					</div>
				</div>
				<div class="creation-detail-challenge-banner-actions">
					<a class="creation-detail-challenge-banner-link btn-outlined" href="${challengesHref}">Open Challenges</a>
				</div>
			</div>`;
	}
	if (hasSubmissions) {
		const title = allEnded ? 'Challenge ended' : 'Challenge entry';
		const detail = allEnded
			? isOwner && !isPublished
				? 'This challenge has ended — you can now publish this creation.'
				: 'This creation was entered in a community challenge that has now ended.'
			: isOwner && !isPublished
				? 'This creation is entered in a challenge. Remove it from the challenge before deleting. You can publish it once the challenge ends.'
				: 'This creation was submitted to a community challenge.';
		const withdraw =
			isOwner && hasSubmissions && !allEnded
				? `<button type="button" class="creation-detail-challenge-banner-withdraw" data-challenge-withdraw-btn>Remove from challenge</button>`
				: '';
		banners += `<div class="creation-detail-challenge-banner${allEnded ? ' creation-detail-challenge-banner-ended' : ''}" role="status">
				<div class="creation-detail-challenge-banner-main">
					<div class="creation-detail-challenge-banner-icon">${SEED_CHALLENGE_TROPHY_SVG}</div>
					<div class="creation-detail-challenge-banner-body">
						<p class="creation-detail-challenge-banner-title">${title}</p>
						<p class="creation-detail-challenge-banner-detail">${detail}</p>
					</div>
				</div>
				<div class="creation-detail-challenge-banner-actions">
					<a class="creation-detail-challenge-banner-link btn-outlined" href="${challengesHref}">Open Challenges</a>
					${withdraw}
				</div>
			</div>`;
	}
	const actions =
		showSubmit || showAssign
			? `<div class="creation-detail-challenge-actions">
				<div class="creation-detail-challenge-actions-btns">
					${showSubmit
						? `<button type="button" class="creation-detail-challenge-submit-btn" data-challenge-submit-detail-btn>
						<span class="creation-detail-challenge-submit-btn-icon" aria-hidden="true">${SEED_CHALLENGE_TROPHY_SVG}</span>
						<span class="creation-detail-challenge-submit-btn-label">Submit to challenge</span>
					</button>`
						: ''}
					${showAssign
						? `<button type="button" class="creation-detail-challenge-submit-btn" data-organizer-assign-detail-btn>
						<span class="creation-detail-challenge-submit-btn-icon" aria-hidden="true">${SEED_CHALLENGE_COG_SVG}</span>
						<span class="creation-detail-challenge-submit-btn-label">Assign to challenge</span>
					</button>`
						: ''}
				</div>
				${showSubmit
					? `<p class="creation-detail-challenge-submit-hint">Enter this creation in an active challenge (Chat → Challenges).</p>`
					: ''}
				${showAssign && !showSubmit
					? `<p class="creation-detail-challenge-submit-hint">Organizers can attach this creation as challenge media.</p>`
					: ''}
			</div>`
			: '';
	return `<div class="creation-detail-challenge-slot" data-creation-detail-challenge-slot>${banners}${actions}</div>`;
}

/**
 * Immediate detail chrome (title, action strip, prompt, model/duration/published)
 * from a parent feed/creations cache row. Omits follower count when unknown.
 * @param {object | null | undefined} seed
 * @returns {string}
 */
export function creationDetailChromeHtmlFromSeed(seed) {
	if (!seed || typeof seed !== 'object') return '';
	const esc = escapeSeedHtml;
	const handle = typeof seed.author_user_name === 'string' ? seed.author_user_name.trim() : '';
	const display =
		(typeof seed.author_display_name === 'string' && seed.author_display_name.trim()) ||
		handle;
	const avatarUrl =
		typeof seed.author_avatar_url === 'string' ? seed.author_avatar_url.trim() : '';
	const userId = numId(seed.user_id);
	const likes = Number(seed.like_count) || 0;
	const liked = Boolean(seed.viewer_liked);
	const nsfw = Boolean(seed.nsfw);
	const founder = seed.author_plan === 'founder';
	const profileHref = handle ? `/p/${encodeURIComponent(handle)}` : userId ? `/user/${userId}` : '';
	const initial = (display || handle || '?').charAt(0).toUpperCase();
	const avatarInner = avatarUrl
		? `<img class="creation-detail-author-avatar" src="${esc(avatarUrl)}" alt="">`
		: esc(initial);
	const avatarHtml = founder
		? `<div class="avatar-with-founder-flair avatar-with-founder-flair--sm"><div class="founder-flair-avatar-ring"><div class="founder-flair-avatar-inner" style="background: ${avatarUrl ? 'var(--surface-strong)' : 'var(--surface)'};">${avatarInner}</div></div></div>`
		: `<span class="creation-detail-author-icon">${avatarInner}</span>`;
	const avatarWrap = profileHref
		? `<a class="creation-detail-action-strip-avatar" href="${esc(profileHref)}" aria-label="View ${esc(display || handle)} profile">${avatarHtml}</a>`
		: `<div class="creation-detail-action-strip-avatar" aria-hidden="true">${avatarHtml}</div>`;
	const followerCount = pickFollowerCount(seed.creator_follower_count, seed.follower_count);
	const followerKnown = followerCount != null;
	const creatorInfo = display
		? `<div class="creation-detail-action-strip-creator-info">
						<div class="creation-detail-action-strip-creator-name">${esc(display)}</div>
						<div class="creation-detail-action-strip-creator-followers">${
							followerKnown
								? `${followerCount} Followers`
								: `<span class="skeleton skeleton-line" style="width: 72px; height: 10px;" aria-hidden="true"></span>`
						}</div>
					</div>`
		: '';

	const meta = seedMetaObject(seed);
	const prompt = seedPromptText(meta);
	const caption = typeof seed.summary === 'string' ? seed.summary.trim() : '';
	const showCaption = caption && caption !== prompt;
	const serverName =
		typeof meta?.server_name === 'string' && meta.server_name.trim()
			? meta.server_name.trim()
			: '';
	const methodName =
		typeof meta?.method_name === 'string' && meta.method_name.trim()
			? meta.method_name.trim()
			: typeof meta?.method === 'string'
				? meta.method.trim()
				: '';
	const displayModel = seedDisplayModel(meta);
	const durationStr = seedDurationStr(meta);
	const isPublished = seedIsPublished(seed);
	const hideIdentify = seedHideIdentifyChrome(seed);
	const isOwner = seedIsOwner(seed);
	const status = seedStatus(seed);
	const isImportEmbed = seedIsImportEmbed(seed);
	const completed = status === 'completed';
	const publishedDateRaw = seed.published_at || seed.created_at || null;
	const publishedTimeAgo = publishedDateRaw ? seedRelativeTime(publishedDateRaw) : '';
	const metaBits = [];
	if (serverName && serverName !== 'Parascene') {
		metaBits.push(
			`<span class="creation-detail-description-meta-label">Server</span> <span class="creation-detail-description-meta-value">${esc(serverName)}</span>`
		);
	}
	if (methodName && methodName !== 'Replicate') {
		metaBits.push(
			`<span class="creation-detail-description-meta-label">Method</span> <span class="creation-detail-description-meta-value">${esc(methodName)}</span>`
		);
	}
	if (displayModel) {
		metaBits.push(
			`<span class="creation-detail-description-meta-label">Model</span> <span class="creation-detail-description-meta-value">${esc(displayModel)}</span>`
		);
	}
	if (durationStr) {
		metaBits.push(
			`<span class="creation-detail-description-meta-label">Duration</span> <span class="creation-detail-description-meta-value">${esc(durationStr)}</span>`
		);
	}
	const metaLine =
		hideIdentify || !metaBits.length
			? ''
			: `<div class="creation-detail-description-meta-line">${metaBits.join(' • ')}</div>`;

	const { text: title, untitled: titleUntitled } = seedDisplayTitle(seed);
	const titleRow =
		hideIdentify
			? nsfw
				? `<div class="creation-detail-title-row"><span class="creation-detail-nsfw-tag">NSFW</span></div>`
				: ''
			: title || nsfw
				? `<div class="creation-detail-title-row">
				${nsfw ? '<span class="creation-detail-nsfw-tag">NSFW</span>' : ''}
				${title ? `<div class="creation-detail-title${titleUntitled ? ' creation-detail-title-untitled' : ''}">${esc(title)}</div>` : ''}
			</div>`
				: '';

	const publishStatus = isPublished
		? publishedTimeAgo
			? `Published ${publishedTimeAgo}`
			: 'Published'
		: 'Not Published';
	const publishByline = hideIdentify
		? ''
		: `<div class="creation-detail-title-byline creation-detail-title-byline-mobile">${esc(publishStatus)}</div>`;

	const promptBlock = hideIdentify
		? ''
		: prompt
			? `<div class="creation-detail-prompt-label-row">
	<span class="creation-detail-prompt-label">Prompt</span>
	<button type="button" class="creation-detail-copy-prompt" data-copy-prompt-btn aria-label="Copy prompt" title="Copy prompt">${SEED_COPY_SVG}</button>
</div>${esc(prompt)}`
			: '';
	const descriptionInner = hideIdentify
		? ''
		: [showCaption ? esc(caption) : '', promptBlock].filter(Boolean).join('<br><br>');
	const descriptionPlain = descriptionInner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	const collapseDescription = descriptionPlain.length > 140;
	const descriptionHtml =
		hideIdentify || (!descriptionInner && !metaLine)
			? ''
			: `<div class="creation-detail-published">
					${descriptionInner ? `<div class="creation-detail-description-wrap${collapseDescription ? ' is-collapsed' : ''}" data-description-wrap>
						<div class="creation-detail-description" data-description>${descriptionInner}</div>
						<div class="creation-detail-description-toggle-row">
							<button type="button" class="btn-secondary creation-detail-description-toggle" data-description-toggle${collapseDescription ? '' : ' hidden'}>View Full</button>
						</div>
					</div>` : ''}
					${metaLine}
				</div>`;

	const showMutate = !isImportEmbed && completed && groupActionSupportedWhenKnown(meta?.group, 'remix');
	const showShare = !isImportEmbed && completed && groupActionSupportedWhenKnown(meta?.group, 'share');
	const showLike = isPublished && completed;
	const showTip = isPublished && !isOwner;
	const showPublish = isOwner && !isPublished && completed && groupActionSupportedWhenKnown(meta?.group, 'publish');
	const showEdit = isOwner && completed && groupActionSupportedWhenKnown(meta?.group, 'edit');
	const actionStrip = hideIdentify
		? ''
		: `<div class="creation-detail-action-strip has-overflow-right">
				<div class="creation-detail-action-strip-scroll">
					${avatarWrap}
					${creatorInfo}
					${showLike ? `<button type="button" class="creation-detail-action-strip-pill${liked ? ' is-liked' : ''}" aria-label="Like" aria-pressed="${liked ? 'true' : 'false'}" data-like-button>
						${SEED_HEART_SVG}
						<span class="creation-detail-action-strip-pill-count" data-like-count>${likes}</span>
					</button>` : ''}
					${showPublish ? `<button type="button" class="creation-detail-action-strip-pill" data-publish-btn>
						<span class="creation-detail-action-strip-pill-icon">${SEED_PUBLISH_SVG}</span>
						Publish
					</button>` : ''}
					${showMutate ? `<button type="button" class="creation-detail-action-strip-pill" data-mutate-btn>
						<span class="creation-detail-action-strip-pill-icon">${SEED_SPARKLE_SVG}</span>
						Mutate
					</button>` : ''}
					${showShare ? `<button type="button" class="creation-detail-action-strip-pill" data-share-btn>
						<span class="creation-detail-action-strip-pill-icon">${SEED_SHARE_SVG}</span>
						Share
					</button>` : ''}
					${showEdit ? `<button type="button" class="creation-detail-action-strip-pill" data-edit-btn>
						<span class="creation-detail-action-strip-pill-icon">${SEED_EDIT_SVG}</span>
						Edit
					</button>` : ''}
					${showTip ? `<button type="button" class="creation-detail-action-strip-pill" data-tip-creator-button aria-label="Tip">
						<span class="creation-detail-action-strip-pill-icon">${SEED_CREDIT_SVG}</span>
						<span>Tip</span>
					</button>` : ''}
					<button type="button" class="creation-detail-more-btn" aria-label="More options" data-creation-more-btn>
						<span class="creation-detail-more-dots" aria-hidden="true"></span>
					</button>
					<span class="creation-detail-action-strip-scroll-spacer" aria-hidden="true"></span>
				</div>
			</div>`;

	return `${titleRow}
			${publishByline}
			${actionStrip}
			${seedGroupSectionHtml(seed)}
			${descriptionHtml}
			${seedChallengeSlotHtml(seed)}
			${seedCommentsHtml(seed)}`;
}

/**
 * Bind View Full / Collapse on seed-painted chrome so it matches live detail.
 * @param {ParentNode | null | undefined} rootEl
 */
export function bindCreationDetailDescriptionCollapse(rootEl) {
	const root = rootEl instanceof Element ? rootEl : null;
	if (!root) return;
	const wrap = root.querySelector('[data-description-wrap]');
	const descriptionEl = root.querySelector('[data-description]');
	const toggleBtn = root.querySelector('[data-description-toggle]');
	if (!(wrap instanceof HTMLElement) || !(descriptionEl instanceof HTMLElement) || !(toggleBtn instanceof HTMLButtonElement)) {
		return;
	}
	if (!wrap.dataset.psDescInit) {
		if (!wrap.classList.contains('is-collapsed') && !toggleBtn.hidden) {
			wrap.classList.add('is-collapsed');
		}
		wrap.dataset.psDescInit = '1';
	}
	if (!descriptionEl.id) descriptionEl.id = 'creation-detail-description';
	toggleBtn.setAttribute('aria-controls', descriptionEl.id);
	function update() {
		const wasCollapsed = wrap.classList.contains('is-collapsed');
		wrap.classList.add('is-measuring');
		wrap.classList.add('is-collapsed');
		const overflows = descriptionEl.scrollHeight - descriptionEl.clientHeight > 4;
		wrap.classList.remove('is-measuring');
		if (!overflows) {
			wrap.classList.remove('is-collapsed');
			toggleBtn.hidden = true;
			return;
		}
		toggleBtn.hidden = false;
		if (!wasCollapsed) wrap.classList.remove('is-collapsed');
		const isCollapsed = wrap.classList.contains('is-collapsed');
		toggleBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
		toggleBtn.textContent = isCollapsed ? 'View Full' : 'Collapse';
	}
	update();
	requestAnimationFrame(() => requestAnimationFrame(update));
	if (!toggleBtn.dataset.psDescToggleBound) {
		toggleBtn.dataset.psDescToggleBound = '1';
		toggleBtn.addEventListener('click', () => {
			const isCollapsed = wrap.classList.toggle('is-collapsed');
			toggleBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
			toggleBtn.textContent = isCollapsed ? 'View Full' : 'Collapse';
		});
	}
}
