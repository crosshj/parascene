import { esc } from '../../../shared/challenges/constants.js';
import {
	pickChallengeHeroImageUrl,
	pickChallengeResultsCreationUrl,
	pickChallengeTopicVoteCreationUrl
} from '../../../shared/challenges/challengeAdmin.js';
import { fetchCreationEmbedPayload, parseHeroCreationOrShareRef } from '../../../shared/userText.js';
import { creationCardMarkup, createCreationMediaLoader, creationMediaType, creationOriginalUrl } from '../../../shared/creationGrid.js';
import {
	buildSunoCardEmbedSrc,
	isPlaceholderAudioCover,
	parseCreationCoverMeta,
	sunoSongIdFromImportMeta
} from '../../../shared/audioCoverWaveform.js';
import { nsfwMediaUrl } from '../../../shared/nsfwPolicy.js';
import { avatarPendingFaceHtml, getAvatarColor, normalizeAvatarUrl } from '../../../shared/avatar.js';
import { buildProfilePath } from '../../../shared/profileLinks.js';
import { segmentedControlHtml } from '../../../components/SegmentedControl/SegmentedControl.js';
import { renderChallengeAboutSection } from './detailsRewardView.js';

/** @type {Map<string, { aboutOpen?: boolean, filter?: 'all' | 'mine' }>} */
const detailUiState = new Map();

/**
 * @param {string} challengeId
 * @param {number} entryCount
 */
export function challengeDetailUiState(challengeId, entryCount) {
	const key = String(challengeId || '').trim();
	const saved = key ? detailUiState.get(key) : null;
	const aboutOpen = typeof saved?.aboutOpen === 'boolean' ? saved.aboutOpen : entryCount === 0;
	const filter = saved?.filter === 'mine' ? 'mine' : 'all';
	return { aboutOpen, filter };
}

/**
 * @param {string} challengeId
 * @param {{ aboutOpen?: boolean, filter?: 'all' | 'mine' }} patch
 */
export function rememberChallengeDetailUi(challengeId, patch) {
	const key = String(challengeId || '').trim();
	if (!key || !patch) return;
	detailUiState.set(key, { ...detailUiState.get(key), ...patch });
}

function placeLabel(place) {
	const n = Math.floor(Number(place));
	if (n === 1) return '1st';
	if (n === 2) return '2nd';
	if (n === 3) return '3rd';
	return Number.isFinite(n) && n > 0 ? `${n}th` : '';
}

function placeMetal(place) {
	const n = Math.floor(Number(place));
	if (n === 1) return 'gold';
	if (n === 2) return 'silver';
	if (n === 3) return 'bronze';
	return '';
}

function kindBarHtml(label, { metal = '', userName = '', withUser = false } = {}) {
	const text = String(label || '').trim();
	if (!text) return '';
	const dot = metal
		? `<span class="challenge-card-kind-dot challenge-card-kind-dot--${esc(metal)}" aria-hidden="true"></span>`
		: '';
	const name = String(userName || '').trim();
	let user = '';
	if (withUser) {
		const hidden = name ? '' : ' hidden';
		user = `<span class="challenge-card-kind-sep" aria-hidden="true"${hidden}>·</span><span class="challenge-card-kind-user" data-challenge-kind-user${hidden}>${esc(name)}</span>`;
	}
	const prize = withUser ? ' challenge-card-kind-bar--prize' : '';
	return `<span class="challenge-card-kind-bar${prize}"><span class="challenge-card-kind-label">${dot}<span class="challenge-card-kind-rank">${esc(text)}</span>${user}</span></span>`;
}

function senderUserName(row) {
	const name = row?.msg?.sender_user_name;
	return typeof name === 'string' ? name.trim() : '';
}

/**
 * Placed winners once results are published. Creation id comes from the saved results.
 * @param {object | null | undefined} cfg
 * @param {object[]} ranked
 */
export function placedWinnerRows(cfg, ranked) {
	const winners = Array.isArray(cfg?.results?.winners) ? cfg.results.winners : [];
	const byCreation = new Map();
	const byMessage = new Map();
	for (const row of Array.isArray(ranked) ? ranked : []) {
		if (row?.creationId) byCreation.set(Number(row.creationId), row);
		if (row?.messageId) byMessage.set(Number(row.messageId), row);
	}
	const out = [];
	const seen = new Set();
	for (const raw of winners) {
		const place = Number(raw?.place);
		const creationId = Number(raw?.created_image_id);
		const messageId = Number(raw?.message_id);
		if (!Number.isFinite(place) || place < 1) continue;
		if (!Number.isFinite(creationId) || creationId <= 0 || seen.has(creationId)) continue;
		seen.add(creationId);
		const entry = byCreation.get(creationId) || byMessage.get(messageId) || null;
		out.push({
			place,
			creationId,
			messageId: Number.isFinite(messageId) && messageId > 0 ? messageId : entry?.messageId || 0,
			senderId: entry?.senderId ?? (Number(raw?.user_id) > 0 ? Number(raw.user_id) : null),
			userName: senderUserName(entry)
		});
	}
	out.sort((a, b) => a.place - b.place);
	return out;
}

function creationRefId(raw) {
	const parsed = parseHeroCreationOrShareRef(typeof raw === 'string' ? raw : '');
	if (parsed?.kind !== 'creation') return null;
	const id = Number(parsed.creationId);
	return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Editorial posts attached to the challenge: announce, results, topic vote.
 * @param {object | null | undefined} cfg
 */
export function relatedChallengePosts(cfg) {
	const specs = [
		['Announce', pickChallengeHeroImageUrl(cfg)],
		['Results', pickChallengeResultsCreationUrl(cfg)],
		['Topic vote', pickChallengeTopicVoteCreationUrl(cfg)]
	];
	const out = [];
	const seen = new Set();
	for (const [label, ref] of specs) {
		const id = creationRefId(ref);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		out.push({ label, creationId: id });
	}
	return out;
}

function entryCardHtml({ creationId, senderId, messageId, challengeId, kindLabel, kindMetal, kindUser, winner, post, fixed, mineHidden, challengeEnded }) {
	const cid = Number(creationId);
	if (!Number.isFinite(cid) || cid <= 0) return '';
	const senderAttr =
		senderId != null && Number(senderId) > 0 ? ` data-sender-id="${esc(senderId)}"` : '';
	const messageAttr =
		messageId != null && Number(messageId) > 0 ? ` data-message-id="${esc(messageId)}"` : '';
	const hidden = mineHidden ? ' hidden' : '';
	const endedAttr = challengeEnded ? ' data-challenge-ended="1"' : '';
	const winnerAttr = winner ? ' data-challenge-winner="1"' : '';
	const postAttr = post ? ' data-challenge-post="1"' : '';
	const fixedAttr = fixed ? ' data-challenge-grid-fixed="1"' : '';
	return `<a class="challenge-entry-card-link" href="/creations/${encodeURIComponent(String(cid))}" data-challenge-entry-card data-creation-id="${esc(cid)}" data-challenge-id="${esc(challengeId)}"${senderAttr}${messageAttr}${endedAttr}${winnerAttr}${postAttr}${fixedAttr} data-challenge-entry-pending${hidden}>
			<div data-challenge-entry-card-slot>
				<div class="feed-card feed-card--image-only creation-grid__card" aria-hidden="true">
					<div class="feed-card-image loading" aria-hidden="true"></div>
				</div>
			</div>
			${kindBarHtml(kindLabel, { metal: kindMetal, userName: kindUser, withUser: Boolean(winner) })}
		</a>`;
}

function viewerOwnsSender(senderId, viewerId) {
	const viewer = Number(viewerId);
	const sender = Number(senderId);
	return viewer > 0 && sender === viewer;
}

function entriesEmptyMarkup(kind, { hidden, title, message = '' }) {
	const messageHtml = message
		? `<div class="route-empty-message">${esc(message)}</div>`
		: '';
	return `<div class="route-empty challenge-entries-empty" data-challenge-entries-empty="${esc(kind)}"${hidden ? ' hidden' : ''}>
		<div class="route-empty-title">${esc(title)}</div>
		${messageHtml}
	</div>`;
}

function submissionRecency(row) {
	const created = Date.parse(String(row?.msg?.created_at || ''));
	if (Number.isFinite(created)) return created;
	const messageId = Number(row?.messageId);
	return Number.isFinite(messageId) ? messageId : 0;
}

function renderEntriesSection({ related, winners, rows, challengeId, viewerId, filter, challengeEnded, headMetaHtml = '' }) {
	const signedIn = Number(viewerId) > 0;
	const mine = signedIn && filter === 'mine';
	const senderByCreation = new Map();
	for (const row of [...rows, ...winners]) {
		const id = Number(row?.creationId);
		const sender = Number(row?.senderId);
		if (id > 0 && sender > 0) senderByCreation.set(id, sender);
	}
	const fixedSpecs = [
		...related.map((post) => ({
			creationId: post.creationId,
			senderId: senderByCreation.get(Number(post.creationId)) || null,
			challengeId,
			kindLabel: post.label,
			post: true,
			fixed: true,
			challengeEnded
		})),
		...winners.map((row) => ({
			creationId: row.creationId,
			senderId: row.senderId,
			messageId: row.messageId,
			challengeId,
			kindLabel: placeLabel(row.place),
			kindMetal: placeMetal(row.place),
			kindUser: row.userName,
			winner: true,
			fixed: true,
			challengeEnded
		}))
	];
	const fixedCards = fixedSpecs.map((spec) =>
		entryCardHtml({
			...spec,
			mineHidden: mine && !viewerOwnsSender(spec.senderId, viewerId)
		})
	);
	const entryCards = rows.map((row) =>
		entryCardHtml({
			creationId: row.creationId,
			senderId: row.senderId,
			messageId: row.messageId,
			challengeId,
			mineHidden: mine && !viewerOwnsSender(row.senderId, viewerId),
			challengeEnded
		})
	);
	const cards = [...fixedCards, ...entryCards].join('');
	const toggle = signedIn
		? segmentedControlHtml({
				label: 'Entries',
				name: 'entries',
				value: mine ? 'mine' : 'all',
				options: [
					{ id: 'all', label: 'All' },
					{ id: 'mine', label: 'Mine' }
				]
			})
		: '';
	const mineVisible =
		fixedSpecs.filter((spec) => viewerOwnsSender(spec.senderId, viewerId)).length +
		rows.filter((row) => viewerOwnsSender(row.senderId, viewerId)).length;
	const allEmpty = rows.length === 0 && fixedCards.length === 0;
	const mineEmpty = mine && mineVisible === 0;
	const emptyAll = entriesEmptyMarkup('all', { hidden: !allEmpty, title: 'No submissions yet' });
	const emptyMine = signedIn
		? entriesEmptyMarkup('mine', {
				hidden: !mineEmpty,
				title: 'No results',
				message: 'You have no entries in this challenge.'
			})
		: '';
	const gridHidden = allEmpty || mineEmpty ? ' hidden' : '';
	const meta = typeof headMetaHtml === 'string' && headMetaHtml.trim()
		? `<div class="challenge-pane-entries-meta">${headMetaHtml}</div>`
		: '';
	const head = meta || toggle ? `<div class="challenge-pane-entries-head">${meta}${toggle}</div>` : '';
	return `<section class="creation-browse challenge-entries-lane" data-challenge-entries data-challenge-id="${esc(challengeId)}">
			${head}
			${emptyAll}
			${emptyMine}
			<div class="route-cards content-cards-image-grid creation-browse-grid challenge-entry-grid" data-challenge-entries-grid${gridHidden}>${cards}</div>
		</section>`;
}

/**
 * About stays in the narrow column. Related posts, winners, and entries share one grid.
 * @param {{
 *   cfg: object,
 *   phase: string,
 *   ranked: object[],
 *   viewerId: number | null,
 *   challengeId: string,
 *   headMetaHtml?: string,
 *   newestFirst?: boolean,
 * }} vm
 * @returns {{ narrow: string, entries: string }}
 */
export function renderChallengeEntrySections(vm) {
	const cfg = vm.cfg && typeof vm.cfg === 'object' ? vm.cfg : {};
	const challengeId = String(vm.challengeId || cfg.challenge_id || '').trim();
	const ranked = Array.isArray(vm.ranked) ? vm.ranked : [];
	const ui = challengeDetailUiState(challengeId, ranked.length);
	const winners = vm.phase === 'results' ? placedWinnerRows(cfg, ranked) : [];
	const winnerIds = new Set(winners.map((row) => Number(row.creationId)));
	const rest = ranked.filter((row) => !winnerIds.has(Number(row.creationId)));
	if (vm.newestFirst) rest.sort((a, b) => submissionRecency(b) - submissionRecency(a));
	const challengeEnded = vm.phase === 'finalizing' || vm.phase === 'results' || vm.phase === 'deleted' || vm.phase === 'purged';
	const narrow = renderChallengeAboutSection(cfg, { open: ui.aboutOpen, challengeId });
	const related = relatedChallengePosts(cfg);
	const entries =
		related.length || winners.length || rest.length || ranked.length === 0
			? renderEntriesSection({
					related,
					winners,
					rows: rest,
					challengeId,
					viewerId: vm.viewerId ?? null,
					filter: ui.filter,
					challengeEnded,
					headMetaHtml: vm.headMetaHtml || ''
				})
			: '';
	return { narrow, entries };
}

/**
 * Show All or Mine without rebuilding the page.
 * @param {ParentNode} root
 * @param {string} challengeId
 * @param {'all' | 'mine'} filter
 * @param {number | null} viewerId
 */
export function applyChallengeEntryFilter(root, challengeId, filter, viewerId) {
	const cid = String(challengeId || '').trim();
	const section = root.querySelector?.(
		`[data-challenge-entries][data-challenge-id="${CSS.escape(cid)}"]`
	);
	if (!(section instanceof HTMLElement)) return;
	const mine = filter === 'mine' && Number(viewerId) > 0;
	const cards = section.querySelectorAll('[data-challenge-entry-card]');
	let visible = 0;
	for (const card of cards) {
		if (!(card instanceof HTMLElement)) continue;
		const hide = mine && !cardIsViewers(card, viewerId);
		card.hidden = hide;
		if (!hide) visible += 1;
	}
	const grid = section.querySelector('[data-challenge-entries-grid]');
	if (grid instanceof HTMLElement) grid.hidden = visible === 0;
	const allEmpty = section.querySelector('[data-challenge-entries-empty="all"]');
	const mineEmpty = section.querySelector('[data-challenge-entries-empty="mine"]');
	if (allEmpty instanceof HTMLElement) allEmpty.hidden = mine || visible > 0 || cards.length > 0;
	if (mineEmpty instanceof HTMLElement) mineEmpty.hidden = !mine || visible > 0;
	const group = section.querySelector('[data-segmented-control]');
	if (group instanceof HTMLElement) {
		for (const button of group.querySelectorAll('[data-segmented-value]')) {
			if (!(button instanceof HTMLButtonElement)) continue;
			const on = button.getAttribute('data-segmented-value') === (mine ? 'mine' : 'all');
			button.classList.toggle('is-active', on);
			button.setAttribute('aria-checked', on ? 'true' : 'false');
			button.tabIndex = on ? 0 : -1;
		}
	}
}

function syncEntryFilter(root, link, viewerId) {
	const section = link.closest?.('[data-challenge-entries]');
	if (!(section instanceof HTMLElement)) return;
	const active = section.querySelector('[data-segmented-value].is-active');
	const filter = active?.getAttribute('data-segmented-value') === 'mine' ? 'mine' : 'all';
	applyChallengeEntryFilter(root, section.getAttribute('data-challenge-id') || '', filter, viewerId);
}

const entryRecords = new WeakMap();
const entryLoads = new WeakMap();

function creationIsPublished(record) {
	return record?.published === true || record?.published === 1;
}

function entryOwnerId(record) {
	const ownerId = Number(record?.user_id ?? record?.creator?.id);
	return Number.isFinite(ownerId) && ownerId > 0 ? ownerId : 0;
}

function cardIsViewers(card, viewerId) {
	const viewer = Number(viewerId);
	if (!Number.isFinite(viewer) || viewer <= 0) return false;
	return Number(card.getAttribute('data-sender-id')) === viewer || Number(card.getAttribute('data-owner-id')) === viewer;
}

function entryBelongsToViewer(record, viewerId, senderId = 0) {
	const viewer = Number(viewerId);
	if (!Number.isFinite(viewer) || viewer <= 0) return false;
	const ownerId = entryOwnerId(record);
	if (ownerId > 0) return ownerId === viewer;
	const sender = Number(senderId);
	return Number.isFinite(sender) && sender === viewer;
}

/**
 * The viewer's own entry, and any published creation, opens creation detail.
 * An unpublished entry opens the lightbox and shows who made it. Posts do not. The detail button stays off until the creation is published.
 * @param {object | null | undefined} record
 * @param {{ post?: boolean, viewerId?: number | null }} [opts]
 */
export function challengeEntryPreviewPlan(record, { post = false, viewerId = null } = {}) {
	if (entryBelongsToViewer(record, viewerId) || creationIsPublished(record)) {
		return { direct: true, showUser: false, showDetail: false };
	}
	return { direct: false, showUser: !post, showDetail: false };
}

/**
 * Drop challenge submissions the viewer just withdrew, before the channel refresh lands.
 * @param {object[]} messages
 * @param {Iterable<number>} creationIds
 */
export function omitWithdrawnChallengeSubmissions(messages, creationIds) {
	const ids = creationIds instanceof Set ? creationIds : new Set(creationIds);
	if (!ids.size) return Array.isArray(messages) ? messages : [];
	return (Array.isArray(messages) ? messages : []).filter((message) => {
		let payload = message?.body;
		if (typeof payload === 'string') {
			try { payload = JSON.parse(payload); } catch { return true; }
		}
		if (!payload || payload.kind !== 'challenge_submission') return true;
		return !ids.has(Number(payload.created_image_id));
	});
}

function rememberChallengeEntry(link, record, viewerId) {
	entryRecords.set(link, record);
	const ownerId = entryOwnerId(record);
	if (ownerId > 0) link.setAttribute('data-owner-id', String(ownerId));
	const id = link.getAttribute('data-creation-id') || '';
	const own = entryBelongsToViewer(record, viewerId, link.getAttribute('data-sender-id'));
	if (own || creationIsPublished(record)) {
		link.setAttribute('data-challenge-entry-direct', '1');
		link.setAttribute('href', `/creations/${encodeURIComponent(id)}`);
		link.removeAttribute('role');
		return;
	}
	link.removeAttribute('href');
	link.removeAttribute('data-challenge-entry-direct');
	link.setAttribute('role', 'button');
	if (!link.getAttribute('aria-label')) link.setAttribute('aria-label', 'Preview creation');
}

function lightboxFrameSize(record) {
	const width = Number(record?.width);
	const height = Number(record?.height);
	return width > 0 && height > 0 ? { width, height } : {};
}

function sunoSongIdFromRecord(record) {
	const meta = parseCreationCoverMeta(record);
	const fromMeta = sunoSongIdFromImportMeta(meta);
	if (fromMeta) return fromMeta;
	const embedUrl = typeof meta?.import?.embed_url === 'string' ? meta.import.embed_url.trim() : '';
	if (!embedUrl) return '';
	try {
		const parsed = new URL(embedUrl);
		const host = parsed.hostname.toLowerCase();
		const match = parsed.pathname.match(/^\/embed\/([a-f0-9-]{36})\/?$/i);
		if ((host === 'suno.com' || host === 'www.suno.com') && match?.[1]) return match[1];
	} catch {
		return '';
	}
	return '';
}

function sunoLightboxEmbed(record) {
	if (creationMediaType(record) !== 'audio') return null;
	const meta = parseCreationCoverMeta(record);
	const provider = typeof meta?.import?.provider === 'string' ? meta.import.provider.trim().toLowerCase() : '';
	if (provider !== 'suno') return null;
	const songId = sunoSongIdFromRecord(record);
	const title =
		(typeof meta?.import?.title === 'string' && meta.import.title.trim()) ||
		(typeof record?.title === 'string' && record.title.trim()) ||
		(songId ? `suno ${songId.slice(0, 8)}` : 'Suno song');
	const url = buildSunoCardEmbedSrc(songId, title);
	return url ? { url, title } : null;
}

function audioLightboxArt(record) {
	const original = String(creationOriginalUrl(record) || '').trim();
	const originalIsArt = original && !isPlaceholderAudioCover(original);
	const fallback = [record?.cover_url, record?.cover_image_url, record?.fit_thumbnail_url, record?.thumbnail_url]
		.find((value) => typeof value === 'string' && value.trim() && !isPlaceholderAudioCover(value.trim()));
	const art = originalIsArt ? original : String(fallback || '').trim();
	return art ? nsfwMediaUrl(art, record, { sourceVariant: 'original' }) : '';
}

export function challengeEntryLightboxMedia(record) {
	const type = creationMediaType(record);
	const frame = lightboxFrameSize(record);
	const imageUrl = nsfwMediaUrl(creationOriginalUrl(record) || record?.url || '', record, { sourceVariant: 'original' });
	const suno = sunoLightboxEmbed(record);
	if (suno) {
		return { kind: 'suno', url: suno.url, title: suno.title, artwork: audioLightboxArt(record), ...frame };
	}
	if (type === 'video' && record?.video_url && !imageUrl.includes('variant=blur')) {
		return { kind: 'video', url: String(record.video_url), artwork: '', ...frame };
	}
	if (type === 'audio' && (record?.audio_url || record?.url) && !imageUrl.includes('variant=blur')) {
		return { kind: 'audio', url: String(record.audio_url || record.url), artwork: audioLightboxArt(record), ...frame };
	}
	return { kind: 'image', url: imageUrl, artwork: '', ...frame };
}

let lightboxPromise = null;

function entryLightbox() {
	lightboxPromise ??= import('../../../components/MediaLightbox/MediaLightbox.js').then((mod) => mod.createMediaLightbox());
	return lightboxPromise;
}

export function closeChallengeEntryPreview() {
	if (!lightboxPromise) return;
	void lightboxPromise.then((box) => box.close());
}

function lightboxMediaStage(overlay) {
	const stage = overlay.querySelector(
		'.chat-inline-image-lightbox-image-slot, .chat-inline-image-lightbox-video-slot, .chat-inline-image-lightbox-suno-stage, .chat-inline-image-lightbox-audio-slot'
	);
	if (stage instanceof HTMLElement) return stage;
	const img = overlay.querySelector('.chat-inline-image-lightbox-img, .chat-inline-image-lightbox-canvas');
	if (!(img instanceof HTMLElement) || !(img.parentElement instanceof HTMLElement)) return null;
	if (img.parentElement.classList.contains('challenge-entry-lightbox-stage')) return img.parentElement;
	const wrap = document.createElement('div');
	wrap.className = 'challenge-entry-lightbox-stage';
	img.parentElement.insertBefore(wrap, img);
	wrap.append(img);
	return wrap;
}

function appendLightboxUser(stage, creator) {
	const userName = String(creator?.user_name || '').trim();
	const handle = userName ? `@${userName}` : '';
	const profile = buildProfilePath({ userName, userId: creator?.id });
	const row = document.createElement(profile ? 'a' : 'div');
	row.className = 'challenge-entry-lightbox-user';
	if (profile) {
		row.href = profile;
		row.setAttribute('data-spa-link', '');
	}
	const avatar = document.createElement('span');
	avatar.className = 'challenge-entry-lightbox-avatar';
	const color = getAvatarColor(userName || creator?.id || handle);
	avatar.style.setProperty('--challenge-entry-lightbox-avatar', color);
	avatar.innerHTML = avatarPendingFaceHtml(normalizeAvatarUrl(creator?.avatar_url), userName.charAt(0), {
		imgClass: 'challenge-entry-lightbox-avatar-img',
		fallbackClass: 'avatar-fallback-label'
	});
	row.append(avatar);
	if (handle) {
		const handleEl = document.createElement('span');
		handleEl.className = 'challenge-entry-lightbox-name';
		handleEl.textContent = handle;
		row.append(handleEl);
	}
	stage.append(row);
	return row;
}

function appendLightboxDetail(footer, creationId) {
	const link = document.createElement('a');
	link.className = 'btn-primary chat-inline-image-lightbox-footer-btn challenge-entry-lightbox-detail';
	link.href = `/creations/${encodeURIComponent(String(creationId))}`;
	link.setAttribute('data-spa-link', '');
	link.textContent = 'Go to creation';
	footer.append(link);
}

async function openChallengeEntryLightbox(record, plan) {
	const media = challengeEntryLightboxMedia(record);
	if (!media.url) return;
	const box = await entryLightbox();
	box.open(media);
	const overlay = box.element;
	if (!(overlay instanceof HTMLElement) || (!plan.showUser && !plan.showDetail)) return;
	const closeOnLink = (event) => {
		const link = event.target?.closest?.('a[href]');
		if (!(link instanceof HTMLAnchorElement)) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		box.close();
	};
	if (plan.showUser && record?.creator) {
		const stage = lightboxMediaStage(overlay);
		if (stage) appendLightboxUser(stage, record.creator)?.addEventListener('click', closeOnLink);
	}
	if (!plan.showDetail) return;
	const footer = document.createElement('div');
	footer.className = 'chat-inline-image-lightbox-footer';
	appendLightboxDetail(footer, record?.id || record?.created_image_id);
	overlay.append(footer);
	footer.addEventListener('click', closeOnLink);
}

async function previewChallengeEntry(card, viewerId) {
	const load = entryLoads.get(card);
	if (load) await load;
	if (!card.isConnected) return;
	if (card.getAttribute('data-challenge-entry-direct') === '1') {
		const href = card.getAttribute('href');
		if (href) document.dispatchEvent(new CustomEvent('parascene:navigate', { detail: { href } }));
		return;
	}
	const record = entryRecords.get(card);
	if (!record) return;
	const plan = challengeEntryPreviewPlan(record, {
		post: card.getAttribute('data-challenge-post') === '1',
		viewerId
	});
	if (plan.direct) {
		const id = card.getAttribute('data-creation-id') || record.id;
		document.dispatchEvent(new CustomEvent('parascene:navigate', { detail: { href: `/creations/${encodeURIComponent(String(id))}` } }));
		return;
	}
	await openChallengeEntryLightbox(record, plan);
}

/**
 * Other people's entries open a full-size preview. The viewer's own entry keeps its detail link.
 * @param {HTMLElement} root
 * @param {{ viewerId?: number | null }} opts
 */
export function attachChallengeEntryPreview(root, { viewerId = null } = {}) {
	const onActivate = (event) => {
		const card = event.target?.closest?.('[data-challenge-entry-card]');
		if (!(card instanceof HTMLElement) || !root.contains(card)) return;
		if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if (card.getAttribute('data-challenge-entry-direct') === '1') return;
		event.preventDefault();
		event.stopPropagation();
		void previewChallengeEntry(card, viewerId);
	};
	root.addEventListener('click', onActivate);
	root.addEventListener('keydown', onActivate);
	return () => {
		root.removeEventListener('click', onActivate);
		root.removeEventListener('keydown', onActivate);
		closeChallengeEntryPreview();
	};
}

function fillWinnerBarUser(link, record) {
	const name = String(record?.creator?.user_name || '').trim();
	if (!name) return;
	const user = link.querySelector('[data-challenge-kind-user]');
	if (!(user instanceof HTMLElement)) return;
	user.textContent = name;
	user.hidden = false;
	const sep = user.previousElementSibling;
	if (sep instanceof HTMLElement && sep.classList.contains('challenge-card-kind-sep')) sep.hidden = false;
}

function paintChallengeEntry(root, link, data, viewerId) {
	const slot = link.querySelector('[data-challenge-entry-card-slot]');
	if (!(slot instanceof HTMLElement)) return;
	if (!data || data._error) {
		link.removeAttribute('data-challenge-entry-pending');
		return;
	}
	const record = { ...data, challenge_ended: true };
	rememberChallengeEntry(link, record, viewerId);
	fillWinnerBarUser(link, record);
	syncEntryFilter(root, link, viewerId);
	slot.innerHTML = creationCardMarkup(record, {
		revealChallengeMedia: true,
		hideChallengeBadge: true
	});
	link.removeAttribute('data-challenge-entry-pending');
}

function loadOneChallengeEntry(root, link, viewerId) {
	const job = (async () => {
		const id = Number(link.getAttribute('data-creation-id'));
		if (!Number.isFinite(id) || id <= 0) return;
		const challengeId = link.getAttribute('data-challenge-id') || '';
		const messageId = Number(link.getAttribute('data-message-id'));
		const data = await fetchCreationEmbedPayload(id, null, {
			challengeId,
			challengeMessageId: Number.isFinite(messageId) && messageId > 0 ? messageId : undefined
		});
		paintChallengeEntry(root, link, data, viewerId);
	})();
	entryLoads.set(link, job);
	return job;
}

function entryRequest(link) {
	const id = Number(link.getAttribute('data-creation-id'));
	const messageId = Number(link.getAttribute('data-message-id'));
	return {
		id,
		messageId: Number.isFinite(messageId) && messageId > 0 ? messageId : null
	};
}

/**
 * Fill entry and related-post slots from creation records.
 * Cached challenge payloads paint immediately. The rest of a challenge is one request.
 * @param {ParentNode} root
 * @param {{ viewerId?: number | null, entryCreations?: { cached?: (challengeId: string) => object[] | null, load?: (challengeId: string, items: { id: number, messageId: number | null }[]) => Promise<object[]> } | null }} [opts]
 */
export async function hydrateChallengeEntryCards(root, { viewerId = null, entryCreations = null } = {}) {
	const pending = [...(root.querySelectorAll?.('[data-challenge-entry-pending]') || [])];
	/** @type {Map<string, HTMLElement[]>} */
	const groups = new Map();
	const loose = [];
	for (const link of pending) {
		if (!(link instanceof HTMLElement)) continue;
		const challengeId = link.getAttribute('data-challenge-id') || '';
		if (!challengeId || !entryCreations) {
			loose.push(link);
			continue;
		}
		const list = groups.get(challengeId) || [];
		list.push(link);
		groups.set(challengeId, list);
	}

	await Promise.all([
		...loose.map((link) => loadOneChallengeEntry(root, link, viewerId)),
		...[...groups].map(async ([challengeId, links]) => {
			const known = new Map((entryCreations.cached?.(challengeId) || []).map((row) => [Number(row.id), row]));
			const missing = [];
			for (const link of links) {
				const request = entryRequest(link);
				const data = known.get(request.id);
				if (data) paintChallengeEntry(root, link, data, viewerId);
				else if (Number.isFinite(request.id) && request.id > 0) missing.push({ link, request });
			}
			if (!missing.length || typeof entryCreations.load !== 'function') {
				await Promise.all(missing.map(({ link }) => loadOneChallengeEntry(root, link, viewerId)));
				return;
			}
			const loaded = await entryCreations.load(challengeId, missing.map(({ request }) => request));
			const byId = new Map((loaded || []).map((row) => [Number(row.id), row]));
			await Promise.all(missing.map(async ({ link, request }) => {
				const data = byId.get(request.id);
				if (data) paintChallengeEntry(root, link, data, viewerId);
				else await loadOneChallengeEntry(root, link, viewerId);
			}));
		})
	]);
	const grids = root.querySelectorAll?.('.challenge-entry-grid') || [];
	for (const grid of grids) {
		if (grid instanceof HTMLElement) createCreationMediaLoader(grid);
	}
}
