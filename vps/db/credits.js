import { createChallengeQueries } from './challenges.js';
import { performCreditTip } from '../services/credits/tip.js';

const TABLE = 'prsn_user_credits';

function utcDayStart(value = new Date()) {
	return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function createCreditsStore(client) {
	async function get(userId) {
		const { data, error } = await client.from(TABLE)
			.select('id, user_id, balance, last_daily_claim_at, updated_at')
			.eq('user_id', userId).maybeSingle();
		if (error) throw error;
		if (data) return data;
		const { error: insertError } = await client.from(TABLE)
			.upsert({ user_id: userId, balance: 100, last_daily_claim_at: null }, { onConflict: 'user_id', ignoreDuplicates: true });
		if (insertError) throw insertError;
		const { data: created, error: readError } = await client.from(TABLE)
			.select('id, user_id, balance, last_daily_claim_at, updated_at')
			.eq('user_id', userId).single();
		if (readError) throw readError;
		return created;
	}

	async function claimDaily(userId, amount = 10, attempt = 0) {
		const current = await get(userId);
		const todayStart = utcDayStart();
		const lastClaim = current.last_daily_claim_at ? new Date(current.last_daily_claim_at) : null;
		if (lastClaim && utcDayStart(lastClaim).getTime() >= todayStart.getTime()) {
			return { success: false, balance: Number(current.balance) || 0, lastClaimDate: current.last_daily_claim_at, message: 'Daily credits already claimed today' };
		}

		// Include the previously observed claim timestamp in the update predicate. This
		// makes concurrent requests compete for the same daily claim instead of both
		// succeeding. Credits stay server-authoritative; the browser never awards them.
		let query = client.from(TABLE).update({
			balance: (Number(current.balance) || 0) + amount,
			last_daily_claim_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		}).eq('user_id', userId);
		query = query.eq('balance', current.balance);
		query = lastClaim ? query.eq('last_daily_claim_at', current.last_daily_claim_at) : query.is('last_daily_claim_at', null);
		const { data, error } = await query.select('balance, last_daily_claim_at').maybeSingle();
		if (error) throw error;
		if (!data) {
			const latest = await get(userId);
			const latestClaim = latest.last_daily_claim_at ? new Date(latest.last_daily_claim_at) : null;
			if (latestClaim && utcDayStart(latestClaim).getTime() >= todayStart.getTime()) {
				return { success: false, balance: Number(latest.balance) || 0, lastClaimDate: latest.last_daily_claim_at, message: 'Daily credits already claimed today' };
			}
			if (attempt < 2) return claimDaily(userId, amount, attempt + 1);
			return { success: false, balance: Number(latest.balance) || 0, lastClaimDate: latest.last_daily_claim_at, message: 'Credits changed while claiming. Please try again.' };
		}
		return { success: true, balance: Number(data.balance) || 0, lastClaimDate: data.last_daily_claim_at, message: 'Daily credits claimed successfully' };
	}

	async function tip(input) {
		const queries = createChallengeQueries(client);
		return performCreditTip({
			...input,
			findUser: async (id) => {
				const { data, error } = await client.from('prsn_users').select('id').eq('id', id).maybeSingle();
				if (error) throw error;
				return data || null;
			},
			findCreation: async (id) => {
				const { data, error } = await client.from('prsn_created_images').select('id').eq('id', id).maybeSingle();
				if (error) throw error;
				return data || null;
			},
			policyValue: async () => {
				const { data, error } = await client.from('prsn_policy_knobs').select('value').eq('key', 'min_days_before_tip').maybeSingle();
				if (error) throw error;
				return data?.value ?? null;
			},
			transfer: (fromUserId, toUserId, amount) => queries.transferCredits.run(fromUserId, toUserId, amount),
			recordTip: (...args) => queries.insertTipActivity.run(...args),
			notify: (...args) => queries.insertNotification.run(...args)
		});
	}

	return { get, claimDaily, tip };
}
