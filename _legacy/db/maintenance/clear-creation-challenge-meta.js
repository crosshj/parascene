#!/usr/bin/env node
/**
 * Clear stuck challenge organizer / feed-pin meta on a creation, and remove
 * editorial pins that target it. Use after a soft-deleted challenge left stamps.
 *
 * Usage: node db/maintenance/clear-creation-challenge-meta.js <creation_id>
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
	removeChallengeOrganizerRefFromMeta,
	listChallengeOrganizerRefsFromMeta
} from '../../src/shared/challengeOrganizerRefMeta.js';
import { removeChallengeFeedPinFromMeta } from '../../src/shared/challengeSubmitMeta.js';
import {
	FEED_EDITORIAL_PINS_POLICY_KEY,
	parseEditorialPinPolicyDocument,
	serializeEditorialPinPolicyDocument,
	validateEditorialPinPolicyDocument
} from '../../api_routes/feed/editorialPinPolicy.js';

const CREATIONS_TABLE = 'prsn_created_images';
const POLICY_TABLE = 'prsn_policy_knobs';

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

function parseMeta(raw) {
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
	if (typeof raw === 'string') {
		try {
			const o = JSON.parse(raw);
			if (o && typeof o === 'object' && !Array.isArray(o)) return { ...o };
		} catch {
			// ignore
		}
	}
	return {};
}

async function main() {
	const creationId = Number(process.argv[2]);
	if (!Number.isFinite(creationId) || creationId <= 0) {
		console.error('Usage: node db/maintenance/clear-creation-challenge-meta.js <creation_id>');
		process.exit(1);
	}

	const sb = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
		auth: { persistSession: false }
	});

	const { data: row, error } = await sb
		.from(CREATIONS_TABLE)
		.select('id, meta')
		.eq('id', creationId)
		.maybeSingle();
	if (error) throw error;
	if (!row) {
		console.error(`Creation ${creationId} not found`);
		process.exit(1);
	}

	let meta = parseMeta(row.meta);
	const before = {
		organizer: meta.challenge_organizer_refs || null,
		pins: meta.challenge_feed_pins || null
	};

	for (const ref of listChallengeOrganizerRefsFromMeta(meta)) {
		meta = removeChallengeOrganizerRefFromMeta(meta, {
			challenge_id: ref.challenge_id,
			role: ref.role
		});
	}
	delete meta.challenge_organizer_refs;

	const feedPins = Array.isArray(meta.challenge_feed_pins) ? [...meta.challenge_feed_pins] : [];
	for (const pin of feedPins) {
		const pinId = pin?.pin_id != null ? String(pin.pin_id).trim() : '';
		if (pinId) meta = removeChallengeFeedPinFromMeta(meta, pinId);
	}
	delete meta.challenge_feed_pins;

	const { error: upErr } = await sb.from(CREATIONS_TABLE).update({ meta }).eq('id', creationId);
	if (upErr) throw upErr;

	console.log(`Updated creation ${creationId} meta`);
	console.log(' before:', JSON.stringify(before));
	console.log(
		' after: ',
		JSON.stringify({
			organizer: meta.challenge_organizer_refs || null,
			pins: meta.challenge_feed_pins || null
		})
	);

	const { data: pol, error: polSelErr } = await sb
		.from(POLICY_TABLE)
		.select('key, value, description')
		.eq('key', FEED_EDITORIAL_PINS_POLICY_KEY)
		.maybeSingle();
	if (polSelErr) throw polSelErr;

	let doc = { defaults: {}, pins: [] };
	if (pol?.value) {
		try {
			const raw = typeof pol.value === 'string' ? JSON.parse(pol.value) : pol.value;
			doc = parseEditorialPinPolicyDocument(raw);
		} catch (err) {
			console.warn('Could not parse pin policy:', err?.message || err);
		}
	}

	const pins = Array.isArray(doc.pins) ? [...doc.pins] : [];
	const kept = pins.filter((p) => Number(p?.created_image_id) !== creationId);
	const removed = pins.length - kept.length;
	if (removed <= 0) {
		console.log('No editorial pins targeted this creation');
		return;
	}

	const parsed = parseEditorialPinPolicyDocument({ defaults: doc.defaults, pins: kept });
	const validated = validateEditorialPinPolicyDocument(parsed);
	if (!validated.ok) {
		console.warn('Pin policy validate failed:', validated.error);
		return;
	}
	const serialized = serializeEditorialPinPolicyDocument(validated.document);
	const now = new Date().toISOString();
	const { error: polErr } = await sb.from(POLICY_TABLE).upsert(
		{
			key: FEED_EDITORIAL_PINS_POLICY_KEY,
			value: serialized,
			description:
				pol?.description ||
				'Sitewide editorial feed pins: inject creations on page 1 with placement and display knobs.',
			updated_at: now
		},
		{ onConflict: 'key' }
	);
	if (polErr) throw polErr;
	console.log(`Removed ${removed} editorial pin(s) targeting creation ${creationId}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
