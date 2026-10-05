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
