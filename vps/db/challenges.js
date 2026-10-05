// Challenge prizes use the existing credit-transfer RPC and notification contract.
export function createChallengeQueries(serviceClient) {
const prefixedTable = name => 'prsn_' + name;
return {
insertNotification: {
			run: async (userId, role, title, message, link, actor_user_id, type, target, meta) => {
				// Use serviceClient to bypass RLS for backend operations
				const payload = {
					user_id: userId ?? null,
					role: role ?? null,
					title,
					message,
					link: link ?? null,
					acknowledged_at: null
				};
				if (actor_user_id != null) payload.actor_user_id = actor_user_id;
				if (type != null) payload.type = type;
				if (target != null) payload.target = typeof target === "string" ? target : JSON.stringify(target);
				if (meta != null) payload.meta = typeof meta === "object" ? meta : meta;
				const { data, error } = await serviceClient
					.from(prefixedTable("notifications"))
					.insert(payload)
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					changes: 1
				};
			}
		},
insertTipActivity: {
			run: async (fromUserId, toUserId, createdImageId, amount, message, source, meta) => {
				const payload = {
					from_user_id: fromUserId,
					to_user_id: toUserId,
					created_image_id: createdImageId || null,
					amount,
					message: message ?? null,
					source: source ?? null,
					meta: meta ?? null
				};
				const { data, error } = await serviceClient
					.from(prefixedTable("tip_activity"))
					.insert(payload)
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					changes: 1
				};
			}
		},
transferCredits: {
			run: async (fromUserId, toUserId, amount) => {
				const { data, error } = await serviceClient.rpc("prsn_transfer_credits", {
					from_user_id: fromUserId,
					to_user_id: toUserId,
					amount
				});
				if (error) throw error;
				// RPC returns a single-row table; PostgREST exposes it as an array
				const row = Array.isArray(data) ? data[0] : data;
				return row || null;
			}
		}
};
}
