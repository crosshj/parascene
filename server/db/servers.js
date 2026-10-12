import { buildProviderHeaders, resolveProviderAuthToken } from '../services/create/providerAuth.js';

const PUBLIC_GENERATION_SERVER_IDS = [1, 6];
const SERVER_FIELDS = 'id,user_id,name,description,status,members_count,created_at,updated_at,meta,server_url,auth_token,server_config';

// Provider form configuration is public to authorized members; credentials stay server-side.
function publicCreateConfig(raw) {
 let config = raw;
 if (typeof raw === 'string') { try { config = JSON.parse(raw); } catch { return null; } }
 if (!config || typeof config !== 'object') return null;
 const { custom_headers, auth_token, api_key, ...publicConfig } = config;
 return publicConfig;
}

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
				result(client.from('prsn_servers').select('id,user_id,name,description,status,members_count,created_at,meta,server_config').order('id')),
				result(client.from('prsn_server_members').select('server_id').eq('user_id', userId)),
			]);
			const admin = viewer?.role === 'admin';
			const joined = new Set(memberships.map(row => Number(row.server_id)));
			return { viewer_is_admin: admin, servers: rows.filter(row => admin || row.status !== 'suspended').map(row => {
				const owner = Number(row.user_id) === Number(userId);
				const publicGeneration = [1, 6].includes(Number(row.id));
				return {
					...(owner || admin || publicGeneration || joined.has(Number(row.id)) ? { server_config: publicCreateConfig(row.server_config) } : {}),
					id: row.id, name: row.name, description: row.description, status: row.status,
					avatar_url: typeof row.meta?.avatar_url === 'string' ? row.meta.avatar_url.trim() || null : null,
					members_count: publicGeneration ? null : row.members_count || 0, created_at: row.created_at,
					is_owner: owner, is_member: publicGeneration || owner || joined.has(Number(row.id)),
					can_manage: owner || admin, can_join_leave: !publicGeneration, suspended: row.status === 'suspended',
				};
			}) };
		},
		async join(userId, serverId) {
			const id = Number(serverId);
			if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error('Invalid server ID'), { status: 400 });
			const { data: server, error } = await client.from('prsn_servers').select('id, user_id, status').eq('id', id).maybeSingle();
			if (error) throw error;
			if (!server) throw Object.assign(new Error('Server not found'), { status: 404 });
			if ([1, 6].includes(id)) throw Object.assign(new Error('You are already a member of this server'), { status: 400 });
			if (server.status === 'suspended') throw Object.assign(new Error('This server is not available'), { status: 400 });
			if (Number(server.user_id) === Number(userId)) throw Object.assign(new Error('You are already a member of this server'), { status: 400 });
			const { data: existing, error: memberError } = await client.from('prsn_server_members').select('server_id').eq('server_id', id).eq('user_id', userId).maybeSingle();
			if (memberError) throw memberError;
			if (existing) throw Object.assign(new Error('You are already a member of this server'), { status: 400 });
			const inserted = await client.from('prsn_server_members').insert({ server_id: id, user_id: userId });
			if (inserted.error) {
				if (inserted.error.code === '23505') throw Object.assign(new Error('You are already a member of this server'), { status: 400 });
				throw inserted.error;
			}
			const { data: current, error: countError } = await client.from('prsn_servers').select('members_count').eq('id', id).maybeSingle();
			if (countError) throw countError;
			const { error: updateError } = await client.from('prsn_servers').update({ members_count: (Number(current?.members_count) || 0) + 1 }).eq('id', id);
			if (updateError) throw updateError;
			return { success: true };
		},
		async leave(userId, serverId) {
			const server = await loadServer(serverId);
			if (PUBLIC_GENERATION_SERVER_IDS.includes(Number(server.id))) throw Object.assign(new Error('You cannot leave this server'), { status: 400 });
			if (Number(server.user_id) === Number(userId)) throw Object.assign(new Error('Server owners cannot leave their own server'), { status: 400 });
			const { data: existing, error: memberError } = await client.from('prsn_server_members').select('server_id').eq('server_id', server.id).eq('user_id', userId).maybeSingle();
			if (memberError) throw memberError;
			if (!existing) throw Object.assign(new Error('You are not a member of this server'), { status: 400 });
			const removed = await client.from('prsn_server_members').delete().eq('server_id', server.id).eq('user_id', userId);
			if (removed.error) throw removed.error;
			const { error: updateError } = await client.from('prsn_servers').update({ members_count: Math.max(0, (Number(server.members_count) || 0) - 1) }).eq('id', server.id);
			if (updateError) throw updateError;
			return { success: true };
		},
		async getById(userId, serverId) {
			const server = await loadServer(serverId);
			return { server: await presentServer(server, userId) };
		},
		async update(userId, serverId, payload = {}) {
			const server = await loadServer(serverId);
			const viewer = await users.byId(userId);
			const admin = viewer?.role === 'admin';
			if (server.status === 'suspended' && !admin) throw Object.assign(new Error('Server not found'), { status: 404 });
			if (Number(server.user_id) !== Number(userId) && !admin) throw Object.assign(new Error('Forbidden: You do not have permission to manage this server'), { status: 403 });
			const patch = { updated_at: new Date().toISOString() };
			if (payload.name !== undefined) {
				const nextName = String(payload.name || '').trim();
				if (!nextName) throw Object.assign(new Error('name must be a non-empty string when provided'), { status: 400 });
				patch.name = nextName;
			}
			if (payload.status !== undefined) {
				const nextStatus = String(payload.status || '').trim();
				if (!nextStatus) throw Object.assign(new Error('status must be a non-empty string when provided'), { status: 400 });
				if ((nextStatus === 'suspended' || server.status === 'suspended') && !admin) throw Object.assign(new Error('Forbidden: Only admins can set or change suspended status'), { status: 403 });
				patch.status = nextStatus;
			}
			if (payload.server_url !== undefined) {
				if (typeof payload.server_url !== 'string' || !payload.server_url.trim()) throw Object.assign(new Error('server_url must be a non-empty string when provided'), { status: 400 });
				let providerUrl;
				try { providerUrl = new URL(payload.server_url.trim()); }
				catch { throw Object.assign(new Error('server_url must be a valid URL'), { status: 400 }); }
				if (!['http:', 'https:'].includes(providerUrl.protocol)) throw Object.assign(new Error('server_url must be an HTTP or HTTPS URL'), { status: 400 });
				patch.server_url = providerUrl.toString().replace(/\/$/, '');
			}
			if (payload.auth_token !== undefined) {
				if (payload.auth_token !== null && typeof payload.auth_token !== 'string') throw Object.assign(new Error('auth_token must be a string when provided'), { status: 400 });
				patch.auth_token = resolveProviderAuthToken(payload.auth_token);
			}
			if (payload.description !== undefined) patch.description = payload.description || null;
			if (payload.avatar_url !== undefined) {
				if (payload.avatar_url !== null && typeof payload.avatar_url !== 'string') throw Object.assign(new Error('avatar_url must be a string or null when provided'), { status: 400 });
				const avatarUrl = typeof payload.avatar_url === 'string' ? payload.avatar_url.trim() : '';
				const nextMeta = server.meta && typeof server.meta === 'object' && !Array.isArray(server.meta) ? { ...server.meta } : {};
				if (avatarUrl) nextMeta.avatar_url = avatarUrl;
				else delete nextMeta.avatar_url;
				patch.meta = Object.keys(nextMeta).length ? nextMeta : null;
			}
			if (payload.custom_headers !== undefined) {
				const customHeaders = parseCustomHeaders(payload.custom_headers);
				const existingConfig = server.server_config && typeof server.server_config === 'object' && !Array.isArray(server.server_config) ? server.server_config : {};
				patch.server_config = { ...existingConfig, ...(customHeaders ? { custom_headers: customHeaders } : {}) };
			}
			const updated = await client.from('prsn_servers').update(patch).eq('id', server.id).select(SERVER_FIELDS).maybeSingle();
			if (updated.error) throw updated.error;
			if (!updated.data) throw Object.assign(new Error('Failed to update server'), { status: 500 });
			return { success: true, server: await presentServer(updated.data, userId) };
		},
		async test(userId, serverId) {
			const server = await manageableServer(userId, serverId);
			const capabilities = await readProviderCapabilities(server.server_url, server.auth_token, server.server_config?.custom_headers);
			return { capabilities, server_url: String(server.server_url).replace(/\/$/, '') };
		},
		async refresh(userId, serverId, payload = {}) {
			const server = await manageableServer(userId, serverId);
			const override = payload.custom_headers === undefined ? null : parseCustomHeaders(payload.custom_headers);
			const capabilities = await readProviderCapabilities(server.server_url, server.auth_token, override || server.server_config?.custom_headers);
			const existingConfig = server.server_config && typeof server.server_config === 'object' && !Array.isArray(server.server_config) ? server.server_config : {};
			const nextConfig = { ...capabilities, custom_headers: existingConfig.custom_headers ?? capabilities.custom_headers };
			const updated = await client.from('prsn_servers').update({ server_config: nextConfig, updated_at: new Date().toISOString() }).eq('id', server.id);
			if (updated.error) throw updated.error;
			return { capabilities: nextConfig, server_url: String(server.server_url).replace(/\/$/, '') };
		},
	};

	async function loadServer(serverId) {
		const id = Number(serverId);
		if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error('Invalid server ID'), { status: 400 });
		const { data, error } = await client.from('prsn_servers').select(SERVER_FIELDS).eq('id', id).maybeSingle();
		if (error) throw error;
		if (!data) throw Object.assign(new Error('Server not found'), { status: 404 });
		return data;
	}

	async function manageableServer(userId, serverId) {
		const server = await loadServer(serverId);
		const viewer = await users.byId(userId);
		const admin = viewer?.role === 'admin';
		if (server.status === 'suspended' && !admin) throw Object.assign(new Error('Server not found'), { status: 404 });
		if (Number(server.user_id) !== Number(userId) && !admin) throw Object.assign(new Error('Forbidden: You do not have permission to manage this server'), { status: 403 });
		if (!server.server_url) throw Object.assign(new Error('Server URL not configured'), { status: 400 });
		return server;
	}

	async function presentServer(server, userId) {
		const viewer = await users.byId(userId);
		const admin = viewer?.role === 'admin';
		if (server.status === 'suspended' && !admin) throw Object.assign(new Error('Server not found'), { status: 404 });
		const owner = Number(server.user_id) === Number(userId);
		const publicGeneration = PUBLIC_GENERATION_SERVER_IDS.includes(Number(server.id));
		let member = owner || publicGeneration;
		if (!member) {
			const { data, error } = await client.from('prsn_server_members').select('server_id').eq('server_id', server.id).eq('user_id', userId).maybeSingle();
			if (error) throw error;
			member = Boolean(data);
		}
		const canManage = owner || admin;
		const presented = {
			id: server.id,
			name: server.name,
			avatar_url: typeof server.meta?.avatar_url === 'string' ? server.meta.avatar_url.trim() || null : null,
			description: server.description,
			status: server.status,
			members_count: publicGeneration ? null : (server.members_count || 0),
			created_at: server.created_at,
			updated_at: server.updated_at,
			is_owner: owner,
			is_member: member,
			can_manage: canManage,
			can_join_leave: !publicGeneration,
			suspended: server.status === 'suspended',
			viewer_is_admin: admin,
		};
		if (server.user_id) {
			const [ownerUser, ownerProfile] = await Promise.all([users.byId(server.user_id), users.profileByUserId(server.user_id)]);
			if (ownerUser) {
				const emailPrefix = ownerUser.email ? String(ownerUser.email).split('@')[0] : null;
				presented.owner = {
					id: ownerUser.id,
					display_name: ownerProfile?.display_name?.trim() || ownerProfile?.user_name?.trim() || emailPrefix || `User ${ownerUser.id}`,
					user_name: ownerProfile?.user_name?.trim() || emailPrefix || null,
					avatar_url: ownerProfile?.avatar_url?.trim() || null,
					email_prefix: emailPrefix,
				};
			}
		}
		if (canManage) {
			presented.server_url = server.server_url;
			presented.auth_token = server.auth_token;
			presented.server_config = server.server_config;
		} else if (member) {
			presented.server_config = publicCreateConfig(server.server_config);
		}
		return presented;
	}
}

function parseCustomHeaders(value) {
	if (value == null || value === '') return null;
	let parsed = value;
	if (typeof value === 'string') {
		try { parsed = JSON.parse(value); }
		catch { throw Object.assign(new Error('custom_headers must be valid JSON when provided'), { status: 400 }); }
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('custom_headers must be a JSON object when provided'), { status: 400 });
	const headers = {};
	for (const [key, entry] of Object.entries(parsed)) {
		if (entry == null) continue;
		headers[key] = String(entry);
	}
	return Object.keys(headers).length ? headers : null;
}

async function readProviderCapabilities(serverUrl, authToken, customHeaders) {
	const normalizedUrl = String(serverUrl).replace(/\/$/, '');
	try {
		const response = await fetch(normalizedUrl, {
			method: 'GET',
			headers: buildProviderHeaders({ Accept: 'application/json' }, authToken, customHeaders),
			signal: AbortSignal.timeout(10000),
		});
		if (!response.ok) throw Object.assign(new Error(`Provider server returned error: ${response.status} ${response.statusText}`), { status: 400 });
		const capabilities = await response.json();
		if (!capabilities?.methods || typeof capabilities.methods !== 'object') throw Object.assign(new Error("Provider server response missing or invalid 'methods' field"), { status: 400 });
		return capabilities;
	} catch (error) {
		if (error.status) throw error;
		if (error.name === 'TimeoutError' || error.name === 'AbortError') throw Object.assign(new Error('Provider server did not respond within 10 seconds'), { status: 400 });
		throw Object.assign(new Error(`Failed to connect to provider server: ${error.message}`), { status: 400 });
	}
}
