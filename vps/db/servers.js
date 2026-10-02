// WWW server membership and avatar rules, without provider credentials.
export function createServersStore(client, users) {
	async function result(request) {
		const { data, error } = await request;
		if (error) throw error;
		return data || [];
	}
	return {
		async list(userId) {
			const [viewer, rows, memberships] = await Promise.all([
				users.byId(userId),
				result(client.from('prsn_servers').select('id,user_id,name,description,status,members_count,created_at,meta').order('id')),
				result(client.from('prsn_server_members').select('server_id').eq('user_id', userId)),
			]);
			const admin = viewer?.role === 'admin';
			const joined = new Set(memberships.map(row => Number(row.server_id)));
			return { viewer_is_admin: admin, servers: rows.filter(row => admin || row.status !== 'suspended').map(row => {
				const owner = Number(row.user_id) === Number(userId);
				const publicGeneration = [1, 6].includes(Number(row.id));
				return {
					id: row.id, name: row.name, description: row.description, status: row.status,
					avatar_url: typeof row.meta?.avatar_url === 'string' ? row.meta.avatar_url.trim() || null : null,
					members_count: publicGeneration ? null : row.members_count || 0, created_at: row.created_at,
					is_owner: owner, is_member: publicGeneration || owner || joined.has(Number(row.id)),
					can_manage: owner || admin, can_join_leave: !publicGeneration, suspended: row.status === 'suspended',
				};
			}) };
		},
	};
}
