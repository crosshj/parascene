import { getSupabaseServiceClient } from '../create/supabaseService.js';
import { canViewUnpublishedCreationViaChallengeMessage, canViewUnpublishedCreationViaChallengeHero, summarizeChallengeSubmissionPhases } from '../create/challengeSubmitShared.js';
import { listChallengeOrganizerRefsFromMeta, challengeOrganizerRefRoleLabel } from '../../client/shared/challengeOrganizerRefMeta.js';

export async function challengeCreationForViewer({ creations, viewer, creationId, query = {}, sb = getSupabaseServiceClient() }) {
 if (!sb || !viewer || typeof creations.byIdForShare !== 'function') return null;
 const row = await creations.byIdForShare(creationId);
 if (!row) return null;
 const meta = typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta || {};
 if (meta.nsfw && viewer.meta?.enableNsfw !== true && Number(row.user_id) !== Number(viewer.id) && viewer.role !== 'admin') return null;
 const args = { ancestorRow: row, viewerUserId: viewer.id };
 const messageId = Number(query.challenge_message_id ?? query.challenge_msg);
 const allowed = Number.isSafeInteger(messageId) && messageId > 0
  ? await canViewUnpublishedCreationViaChallengeMessage(sb, { ...args, challengeMessageId: messageId })
  : await canViewUnpublishedCreationViaChallengeHero(sb, { ...args, challengeId: query.challenge_id });
 return allowed ? row : null;
}

const ENTRY_CREATION_FIELDS = 'id, user_id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, unavailable_at';
const ENTRY_CREATION_LIMIT = 200;

function creationMeta(row) {
	const meta = row?.meta;
	if (meta && typeof meta === 'object') return meta;
	if (typeof meta === 'string') {
		try { return JSON.parse(meta) || {}; } catch { return {}; }
	}
	return {};
}

function submissionProof(message, threadId, creationId) {
	if (!message || Number(message.thread_id) !== Number(threadId)) return false;
	let body = message.body;
	if (typeof body === 'string') {
		try { body = JSON.parse(body); } catch { return false; }
	}
	if (!body || String(body.kind || '').trim() !== 'challenge_submission') return false;
	return Number(body.created_image_id) === Number(creationId);
}

/**
 * One read of the creations a challenge card grid needs.
 * Membership is checked once. Creations, submission proofs, and creator names
 * are each loaded with a single query instead of once per card.
 * @param {{ sb: object, viewer: { id: number, role?: string, meta?: object }, threadId: number, items: { id: number, messageId?: number }[], serialize: (row: object) => object }} args
 */
export async function listChallengeEntryCreations({ sb, viewer, threadId, items, serialize }) {
	const tid = Number(threadId);
	const vid = Number(viewer?.id);
	if (!sb || !Number.isFinite(tid) || tid <= 0 || !Number.isFinite(vid) || vid <= 0) return [];
	const requested = [];
	const seen = new Set();
	for (const item of Array.isArray(items) ? items : []) {
		const id = Number(item?.id);
		if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
		seen.add(id);
		const messageId = Number(item?.messageId);
		requested.push({ id, messageId: Number.isInteger(messageId) && messageId > 0 ? messageId : null });
		if (requested.length >= ENTRY_CREATION_LIMIT) break;
	}
	if (!requested.length) return [];

	const thread = await sb.from('prsn_chat_threads').select('type, channel_slug').eq('id', tid).maybeSingle();
	if (thread.error) throw thread.error;
	const threadRow = thread.data;
	if (!threadRow || threadRow.type !== 'channel' || String(threadRow.channel_slug || '').toLowerCase() !== 'challenges') return [];
	const member = await sb.from('prsn_chat_members').select('user_id').eq('thread_id', tid).eq('user_id', vid).maybeSingle();
	if (member.error) throw member.error;
	if (!member.data) return [];

	const messageIds = requested.map((item) => item.messageId).filter((id) => id != null);
	const messages = messageIds.length
		? await sb.from('prsn_chat_messages').select('id, thread_id, body').in('id', messageIds)
		: { data: [] };
	if (messages.error) throw messages.error;
	const messageById = new Map((messages.data || []).map((row) => [Number(row.id), row]));

	const creations = await sb.from('prsn_created_images').select(ENTRY_CREATION_FIELDS).in('id', requested.map((item) => item.id));
	if (creations.error) throw creations.error;
	const creationById = new Map((creations.data || []).map((row) => [Number(row.id), row]));

	const admin = viewer.role === 'admin';
	const nsfwAllowed = viewer.meta?.enableNsfw === true;
	const allowed = [];
	for (const item of requested) {
		const row = creationById.get(item.id);
		if (!row) continue;
		const unavailable = row.unavailable_at != null && row.unavailable_at !== '';
		if (unavailable && !admin) continue;
		const owner = Number(row.user_id) === vid;
		const published = row.published === true || row.published === 1;
		const completed = (row.status || 'completed') === 'completed';
		if (!completed && !owner && !admin) continue;
		const meta = creationMeta(row);
		if (meta.nsfw && !nsfwAllowed && !owner && !admin) continue;
		const proved = item.messageId != null && submissionProof(messageById.get(item.messageId), tid, item.id);
		if (!owner && !published && !admin && !proved) continue;
		allowed.push({ row, messageId: proved ? item.messageId : null });
	}
	if (!allowed.length) return [];

	const userIds = [...new Set(allowed.map((item) => Number(item.row.user_id)).filter((id) => id > 0))];
	const profiles = userIds.length
		? await sb.from('prsn_user_profiles').select('user_id, user_name, display_name, avatar_url').in('user_id', userIds)
		: { data: [] };
	if (profiles.error) throw profiles.error;
	const profileByUser = new Map((profiles.data || []).map((row) => [Number(row.user_id), row]));

	return allowed.map(({ row, messageId }) => {
		const payload = serialize(row);
		const profile = profileByUser.get(Number(row.user_id));
		payload.creator = profile ? {
			id: Number(row.user_id),
			user_name: profile.user_name ?? null,
			display_name: profile.display_name ?? null,
			avatar_url: profile.avatar_url ?? null
		} : { id: Number(row.user_id), user_name: null, display_name: null, avatar_url: null };
		appendChallengeMediaProof(payload, messageId);
		return payload;
	});
}

export function appendChallengeMediaProof(payload, messageId) {
 if (!Number.isSafeInteger(Number(messageId)) || Number(messageId) <= 0) return;
 for (const field of ['url', 'thumbnail_url', 'fit_thumbnail_url', 'video_thumbnail_url', 'video_url', 'audio_url']) {
  if (!payload[field]) continue;
  const raw = String(payload[field]);
  if (!raw.startsWith('/api/')) continue;
  const url = new URL(raw, 'https://parascene.invalid');
  url.searchParams.set('challenge_message_id', String(messageId));
  payload[field] = url.pathname + url.search + url.hash;
 }
}

export async function appendChallengeEntryState(meta, response) {
 const refs = listChallengeOrganizerRefsFromMeta(meta);
 response.challenge_organizer = { active: refs.length > 0, refs: refs.map(ref => ({ challenge_id: ref.challenge_id, role: ref.role, label: challengeOrganizerRefRoleLabel(ref.role) })) };
 if (!meta?.challenge_submissions?.length) return;
 try {
  const summary = await summarizeChallengeSubmissionPhases({ sb: getSupabaseServiceClient(), meta });
  response.challenge_entry = { has_submission: summary.hasSubmission, all_ended: summary.allEnded, any_active: summary.anyActive, entries: summary.entries };
 } catch { response.challenge_entry = { has_submission: true, all_ended: false, any_active: true, entries: [] }; }
}
