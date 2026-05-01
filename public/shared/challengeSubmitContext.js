/**
 * Remembers which Challenges channel thread the viewer opened so creation detail can offer
 * “Submit to challenge” without bloating the URL. Cleared after TTL.
 */
const STORAGE_KEY = 'parascene_challenge_submit_ctx_v1';
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Call when the Challenges lane loads (real thread id).
 * @param {number | string | null | undefined} threadId
 */
export function captureChallengeSubmitThread(threadId) {
	const tid = Number(threadId);
	if (!Number.isFinite(tid) || tid <= 0) return;
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ threadId: tid, at: Date.now() }));
	} catch {
		// ignore quota / private mode
	}
}

/**
 * @returns {{ threadId: number } | null}
 */
export function readChallengeSubmitContext() {
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const o = JSON.parse(raw);
		const tid = Number(o.threadId);
		const at = Number(o.at);
		if (!Number.isFinite(tid) || tid <= 0) return null;
		if (!Number.isFinite(at) || Date.now() - at > MAX_AGE_MS) {
			sessionStorage.removeItem(STORAGE_KEY);
			return null;
		}
		return { threadId: tid };
	} catch {
		return null;
	}
}

export function clearChallengeSubmitContext() {
	try {
		sessionStorage.removeItem(STORAGE_KEY);
	} catch {
		// ignore
	}
}
