/**
 * Regenerate public/shared/createServersDefault.js from live public generation servers.
 *
 * Usage: node db/maintenance/generate_create_servers_default.js
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDb } from '../index.js';
import { isPublicGenerationServerId } from '../../public/shared/generationDefaults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '../../public/shared/createServersDefault.js');

function processServers(rawServers) {
	let list = Array.isArray(rawServers) ? rawServers : [];
	list = list.filter(
		(server) =>
			!server.suspended &&
			(isPublicGenerationServerId(server.id) ||
				server.id === 1 ||
				server.is_owner === true ||
				server.is_member === true)
	);
	return list.map((server) => {
		const s = { ...server };
		if (s.server_config && typeof s.server_config === 'string') {
			try {
				s.server_config = JSON.parse(s.server_config);
			} catch {
				s.server_config = null;
			}
		}
		if (s.server_config && typeof s.server_config === 'object') {
			const { custom_headers, ...rest } = s.server_config;
			s.server_config = rest;
		}
		return s;
	});
}

async function main() {
	const { queries } = await openDb({ quiet: true });
	const all = await queries.selectServers.all();
	const raw = all
		.filter((s) => s.status !== 'suspended' && isPublicGenerationServerId(s.id))
		.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
		.map((s) => ({
			id: s.id,
			name: s.name,
			description: s.description,
			status: s.status,
			is_owner: false,
			is_member: true,
			can_manage: false,
			can_join_leave: false,
			suspended: false,
			server_config: s.server_config,
		}));
	const processed = processServers(raw);
	if (processed.length === 0) {
		console.error('No public generation servers found; refusing to write an empty default.');
		process.exitCode = 1;
		return;
	}
	const body =
		'/**\n' +
		' * Baked default for create page cold start (public generation servers).\n' +
		' * Regenerate: node db/maintenance/generate_create_servers_default.js\n' +
		' */\n\n' +
		"export const CREATE_SERVERS_CACHE_KEY = 'create-servers-cache';\n\n" +
		'/** @type {Array<{ id: number, name: string, server_config?: object, is_member?: boolean, is_owner?: boolean, suspended?: boolean }>} */\n' +
		`export const DEFAULT_CREATE_SERVERS = ${JSON.stringify(processed, null, '\t')};\n`;
	writeFileSync(OUT_PATH, body);
	console.log(
		`Wrote ${OUT_PATH} with ${processed.length} server(s): ${processed.map((s) => s.id).join(', ')}`
	);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
