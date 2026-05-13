#!/usr/bin/env node
/**
 * Inspect a prsn_created_images row (and related feed rows) to explain why
 * /creations/:id video hero may be broken — mirrors how api_routes/create.js
 * derives media_type and video_url from meta.
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (recommended; anon may hit RLS).
 *
 * Usage:
 *   node scripts/debug-creation-video.cjs 9731
 *   node scripts/debug-creation-video.cjs 9731 --json
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

function mustEnv(name) {
	const v = process.env[name];
	if (!v || !String(v).trim()) throw new Error(`Missing required env var: ${name}`);
	return String(v).trim();
}

function hasFlag(name) {
	return process.argv.slice(2).includes(`--${name}`);
}

function parseMeta(raw) {
	if (raw == null) return null;
	if (typeof raw === 'object') return raw;
	if (typeof raw !== 'string') return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function isModeratedError(status, meta) {
	if (status !== 'failed' || meta == null) return false;
	try {
		const parts = [];
		if (typeof meta.error === 'string' && meta.error.trim()) parts.push(meta.error.trim());
		const pe = meta.provider_error;
		if (pe != null && typeof pe === 'object' && pe.body != null) {
			const b = pe.body;
			if (typeof b === 'string') parts.push(b.trim());
			else if (typeof b === 'object') {
				if (typeof b.error === 'string' && b.error.trim()) parts.push(b.error.trim());
				else if (typeof b.message === 'string' && b.message.trim()) parts.push(b.message.trim());
			}
		}
		const errorText = parts.join(' ').toLowerCase();
		return errorText.length > 0 && (errorText.includes('moderated') || errorText.includes('flagged as sensitive'));
	} catch {
		return false;
	}
}

function printTitle(title) {
	console.log('\n--- ' + title + ' ---\n');
}

function deriveApiVideoFields(meta) {
	const mediaType = typeof meta?.media_type === 'string' ? meta.media_type : 'image';
	const videoMeta = meta && typeof meta === 'object' ? meta.video : null;
	const rawVideoUrl =
		videoMeta && typeof videoMeta.file_path === 'string' && videoMeta.file_path
			? videoMeta.file_path
			: null;
	return { mediaType, videoMeta, rawVideoUrl };
}

function buildDiagnoses(creationId, row, meta) {
	const out = [];
	if (!row) {
		out.push({ level: 'error', msg: `No row in prsn_created_images for id=${creationId}.` });
		return out;
	}

	const status = row.status || 'completed';
	const published = row.published === true || row.published === 1;
	const unavailable = row.unavailable_at != null && String(row.unavailable_at).trim() !== '';

	if (unavailable) {
		out.push({
			level: 'warn',
			msg: 'unavailable_at is set — owners get 404 from /api/create/images/:id unless lineage admin path; video never loads for owner.'
		});
	}

	const { mediaType, rawVideoUrl } = deriveApiVideoFields(meta);

	if (status !== 'completed') {
		const timeoutAt = meta && typeof meta.timeout_at === 'string' ? new Date(meta.timeout_at).getTime() : NaN;
		const timedOut = status === 'creating' && Number.isFinite(timeoutAt) && Date.now() > timeoutAt;
		out.push({
			level: 'warn',
			msg: timedOut
				? `status is "${status}" and timeout_at is in the past — UI treats as failed/timed out.`
				: `status is "${status}" (not completed) — hero stays loading or error until worker finishes.`
		});
	}

	if (status === 'failed' || (status === 'creating' && meta && typeof meta.timeout_at === 'string' && Date.now() > new Date(meta.timeout_at).getTime())) {
		if (isModeratedError(status, meta)) {
			out.push({ level: 'warn', msg: 'Failure looks moderation-related (is_moderated_error path in UI).' });
		} else if (meta?.error || meta?.provider_error) {
			out.push({
				level: 'info',
				msg: 'meta.error / provider_error present — inspect JSON below for provider message.'
			});
		}
	}

	if (mediaType === 'video' && !rawVideoUrl) {
		out.push({
			level: 'error',
			msg: 'meta.media_type is "video" but meta.video.file_path is missing/empty — API sets video_url null; creation-detail.js will not set video src (broken hero).'
		});
	}

	if (mediaType !== 'video' && rawVideoUrl) {
		out.push({
			level: 'info',
			msg: 'meta.video.file_path exists but media_type is not "video" — API still exposes raw path as video_url; UI may still pick image branch depending on media_type.'
		});
	}

	if (mediaType === 'video' && rawVideoUrl && status === 'completed') {
		out.push({
			level: 'info',
			msg: 'DB shape matches what create route expects for video — if playback still fails, check storage/CORS/object at file_path or CDN.'
		});
	}

	const provStatus = typeof meta?.provider_status === 'string' ? meta.provider_status : '';
	if (status === 'completed' && provStatus && provStatus !== 'succeeded' && provStatus !== 'completed') {
		out.push({
			level: 'warn',
			msg: `Row status is "completed" but meta.provider_status is "${provStatus}" — creation may have been finalized in DB before async video metadata was written.`
		});
	}

	if (!published) {
		out.push({
			level: 'info',
			msg: 'published is false — non-owners get 404 unless admin/share/lineage/challenge rules apply (separate from video file metadata).'
		});
	}

	return out;
}

async function loadCreatedImage(db, id) {
	const { data, error } = await db
		.from('prsn_created_images')
		.select(
			'id, user_id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, unavailable_at'
		)
		.eq('id', id)
		.maybeSingle();
	if (error) throw new Error(`prsn_created_images: ${error.message}`);
	return data;
}

async function loadFeedItems(db, createdImageId) {
	const { data, error } = await db
		.from('prsn_feed_items')
		.select('id, title, created_at, created_image_id')
		.eq('created_image_id', createdImageId)
		.limit(20);
	if (error) throw new Error(`prsn_feed_items: ${error.message}`);
	return Array.isArray(data) ? data : [];
}

async function main() {
	const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
	const rawId = argv[0];
	const id = Number(rawId);
	if (!Number.isFinite(id) || id <= 0) {
		console.error('Usage: node scripts/debug-creation-video.cjs <created_image_id>');
		console.error('Example: node scripts/debug-creation-video.cjs 9731');
		process.exit(1);
	}

	const asJson = hasFlag('json');
	const supabaseUrl = mustEnv('SUPABASE_URL');
	const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
	if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY');

	const db = createClient(supabaseUrl, key, { auth: { persistSession: false } });

	const row = await loadCreatedImage(db, id);
	const meta = parseMeta(row?.meta);
	const { mediaType, videoMeta, rawVideoUrl } = deriveApiVideoFields(meta);
	const diagnoses = buildDiagnoses(id, row, meta);

	let feedItems = [];
	try {
		feedItems = await loadFeedItems(db, id);
	} catch (e) {
		feedItems = { _error: e.message };
	}

	const summary = row
		? {
				id: row.id,
				user_id: row.user_id,
				status: row.status || 'completed',
				published: row.published === true || row.published === 1,
				unavailable_at: row.unavailable_at,
				filename: row.filename,
				file_path: row.file_path,
				width: row.width,
				height: row.height,
				derived_media_type: mediaType,
				derived_video_file_path: rawVideoUrl,
				meta_video_object: videoMeta,
				is_moderated_error: isModeratedError(row.status || 'completed', meta)
			}
		: { id, found: false };

	if (asJson) {
		console.log(
			JSON.stringify(
				{
					summary,
					meta: meta,
					diagnoses,
					feed_items: feedItems
				},
				null,
				2
			)
		);
		return;
	}

	printTitle(`prsn_created_images id=${id}`);
	if (!row) {
		console.log('(no row)');
	} else {
		console.log(JSON.stringify(summary, null, 2));
	}

	printTitle('Full meta (JSON)');
	console.log(meta == null ? '(null)' : JSON.stringify(meta, null, 2));

	printTitle('Likely causes for /creations hero');
	if (diagnoses.length === 0) {
		console.log('(no heuristics triggered)');
	} else {
		for (const d of diagnoses) {
			console.log(`[${d.level}] ${d.msg}`);
		}
	}

	printTitle('prsn_feed_items referencing this created_image_id');
	if (feedItems && feedItems._error) {
		console.log('Could not load:', feedItems._error);
	} else if (!Array.isArray(feedItems) || feedItems.length === 0) {
		console.log('(none — feed cards may still work via other paths)');
	} else {
		console.log(JSON.stringify(feedItems, null, 2));
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
