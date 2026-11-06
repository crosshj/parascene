export const POSTED_CREATION_PROOF_QUERY_KEYS = Object.freeze([
	'share_version',
	'share_token',
	'chat_message_id',
	'comment_id',
]);

export function parseSharePathFromHref(raw) {
	const s = String(raw || '').trim();
	if (!s) return null;
	try {
		const u = new URL(s, 'https://www.parascene.com');
		const m = u.pathname.match(/^\/s\/(v\d+)\/([^/]+)\/[^/]+$/i);
		if (!m) return null;
		return { shareVersion: m[1], shareToken: decodeURIComponent(m[2]) };
	} catch {
		return null;
	}
}

export function postedCreationProofFromElement(el) {
	if (!(el instanceof Element)) return null;
	const wrap =
		el.closest?.('.connect-chat-creation-embed[data-creation-id], .connect-comment[data-creation-id], [data-creation-id]') ||
		el;
	const msg = el.closest?.('.connect-chat-msg[data-chat-message-id], [data-chat-message-id]');
	const comment =
		el.closest?.('.connect-comment[data-comment-id], .comment-item[data-comment-id], [data-comment-id]');
	const proof = {};
	const mid = String(msg?.getAttribute?.('data-chat-message-id') || wrap?.getAttribute?.('data-chat-message-id') || '').trim();
	if (mid && /^\d+$/.test(mid) && Number(mid) > 0) proof.chatMessageId = mid;
	const cid = String(comment?.getAttribute?.('data-comment-id') || wrap?.getAttribute?.('data-comment-id') || '').trim();
	if (cid && /^\d+$/.test(cid) && Number(cid) > 0) proof.commentId = cid;
	const shareVersion = String(
		wrap?.getAttribute?.('data-share-version') || el.getAttribute?.('data-share-version') || ''
	).trim();
	const shareToken = String(
		wrap?.getAttribute?.('data-share-token') || el.getAttribute?.('data-share-token') || ''
	).trim();
	if (shareVersion && shareToken) {
		proof.shareVersion = shareVersion;
		proof.shareToken = shareToken;
	} else {
		const fromHref = parseSharePathFromHref(
			el.getAttribute?.('href') || el.getAttribute?.('data-creation-link-original') || ''
		);
		if (fromHref) {
			proof.shareVersion = fromHref.shareVersion;
			proof.shareToken = fromHref.shareToken;
		}
	}
	return Object.keys(proof).length ? proof : null;
}

export function appendPostedCreationProofToHref(href, proof) {
	const raw = String(href || '').trim();
	if (!raw || !proof || typeof proof !== 'object') return raw;
	let url;
	try {
		url = new URL(raw, 'http://localhost');
	} catch {
		return raw;
	}
	if (proof.shareVersion && proof.shareToken) {
		url.searchParams.set('share_version', String(proof.shareVersion));
		url.searchParams.set('share_token', String(proof.shareToken));
	}
	if (proof.chatMessageId) url.searchParams.set('chat_message_id', String(proof.chatMessageId));
	if (proof.commentId) url.searchParams.set('comment_id', String(proof.commentId));
	return `${url.pathname}${url.search}${url.hash}`;
}

export function stripPostedCreationProofFromSearchParams(searchParams) {
	if (!searchParams || typeof searchParams.delete !== 'function') return searchParams;
	for (const key of POSTED_CREATION_PROOF_QUERY_KEYS) searchParams.delete(key);
	return searchParams;
}

export function postedCreationProofFromSearch(search) {
	const params =
		search instanceof URLSearchParams
			? search
			: new URLSearchParams(typeof search === 'string' ? search.replace(/^\?/, '') : '');
	const proof = {};
	const shareVersion = String(params.get('share_version') || '').trim();
	const shareToken = String(params.get('share_token') || '').trim();
	if (shareVersion && shareToken) {
		proof.shareVersion = shareVersion;
		proof.shareToken = shareToken;
	}
	const chatMessageId = String(params.get('chat_message_id') || '').trim();
	if (chatMessageId && /^\d+$/.test(chatMessageId) && Number(chatMessageId) > 0) {
		proof.chatMessageId = chatMessageId;
	}
	const commentId = String(params.get('comment_id') || '').trim();
	if (commentId && /^\d+$/.test(commentId) && Number(commentId) > 0) {
		proof.commentId = commentId;
	}
	return Object.keys(proof).length ? proof : null;
}

export function postedCreationProofQueryString(proof) {
	if (!proof || typeof proof !== 'object') return '';
	const params = new URLSearchParams();
	if (proof.shareVersion && proof.shareToken) {
		params.set('share_version', String(proof.shareVersion));
		params.set('share_token', String(proof.shareToken));
	}
	if (proof.chatMessageId) params.set('chat_message_id', String(proof.chatMessageId));
	if (proof.commentId) params.set('comment_id', String(proof.commentId));
	return params.toString();
}
