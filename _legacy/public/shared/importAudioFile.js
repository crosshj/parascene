/**
 * Import a local audio file as a Parascene Creation.
 * Bytes go to Blue CDN (PUT); Vercel only mints URLs and stores the cover still.
 */

const AUDIO_MAX_BYTES = 50 * 1024 * 1024;

const EXT_TO_TYPE = {
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	flac: 'audio/flac',
	m4a: 'audio/mp4',
	aac: 'audio/aac',
	ogg: 'audio/ogg',
	oga: 'audio/ogg',
	webm: 'audio/webm',
	mp4: 'audio/mp4',
};

const ALLOWED_TYPES = new Set([
	'audio/mpeg',
	'audio/mp3',
	'audio/wav',
	'audio/x-wav',
	'audio/flac',
	'audio/ogg',
	'audio/mp4',
	'audio/aac',
	'audio/x-m4a',
	'audio/webm',
]);

export function contentTypeForAudioFile(file) {
	if (!(file instanceof File) && !(file instanceof Blob)) return '';
	const typed = typeof file.type === 'string' ? file.type.trim().toLowerCase().split(';')[0] : '';
	if (typed && ALLOWED_TYPES.has(typed)) return typed;
	const name = typeof file.name === 'string' ? file.name : '';
	const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
	return EXT_TO_TYPE[ext] || '';
}

export function isImportableAudioFile(file) {
	return Boolean(contentTypeForAudioFile(file));
}

function titleFromFilename(name) {
	const raw = typeof name === 'string' ? name.trim() : '';
	const base = raw.split(/[/\\]/).pop() || 'Audio';
	const stem = base.replace(/\.[a-z0-9]{1,8}$/i, '').trim();
	return (stem || 'Audio').slice(0, 200);
}

function readAudioDurationSec(file) {
	return new Promise((resolve) => {
		try {
			const url = URL.createObjectURL(file);
			const audio = new Audio();
			audio.preload = 'metadata';
			const done = (value) => {
				URL.revokeObjectURL(url);
				resolve(value);
			};
			audio.onloadedmetadata = () => {
				const d = Number(audio.duration);
				done(Number.isFinite(d) && d > 0 ? d : null);
			};
			audio.onerror = () => done(null);
			audio.src = url;
		} catch {
			resolve(null);
		}
	});
}

async function readJsonSafe(res) {
	try {
		return await res.json();
	} catch {
		return null;
	}
}

/**
 * @param {File} file
 * @param {{ creationToken?: string, onStatus?: (status: string) => void }} [options]
 */
export async function importAudioFile(file, options = {}) {
	const report = (status) => {
		if (typeof options.onStatus === 'function') options.onStatus(status);
	};

	if (!(file instanceof File)) {
		throw new Error('Choose an audio file.');
	}
	if (file.size <= 0) {
		throw new Error('That file is empty.');
	}
	if (file.size > AUDIO_MAX_BYTES) {
		throw new Error('Audio files must be 50 MB or smaller.');
	}
	const contentType = contentTypeForAudioFile(file);
	if (!contentType) {
		throw new Error('Use an audio file (mp3, wav, flac, m4a, ogg, aac).');
	}

	report('Preparing…');
	const durationSec = await readAudioDurationSec(file);
	const filename = typeof file.name === 'string' && file.name.trim() ? file.name.trim() : 'audio.mp3';

	report('Starting…');

	const startRes = await fetch('/api/create/import-audio/start', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({
			filename,
			content_type: contentType,
		}),
	});
	const startData = await readJsonSafe(startRes);
	if (!startRes.ok) {
		const msg =
			(typeof startData?.error === 'string' && startData.error.trim()) ||
			(startRes.status === 401 ? 'Sign in to import audio.' : 'Could not start audio import.');
		throw new Error(msg);
	}
	const uploadUrl = typeof startData?.upload_url === 'string' ? startData.upload_url.trim() : '';
	const ticket = typeof startData?.ticket === 'string' ? startData.ticket.trim() : '';
	if (!uploadUrl || !ticket) {
		throw new Error('Could not start audio import.');
	}

	report('Uploading…');
	const putRes = await fetch(uploadUrl, {
		method: 'PUT',
		headers: { 'Content-Type': contentType },
		body: file,
	});
	if (!putRes.ok) {
		let putMsg = 'Upload failed.';
		try {
			const putData = await putRes.json();
			if (typeof putData?.error === 'string' && putData.error.trim()) putMsg = putData.error.trim();
		} catch {
			// ignore
		}
		if (putRes.status === 413) putMsg = 'Audio files must be 50 MB or smaller.';
		throw new Error(putMsg);
	}

	report('Saving…');
	const finalizeBody = {
		ticket,
		filename,
		title: titleFromFilename(filename),
	};
	if (durationSec != null) finalizeBody.duration_sec = durationSec;
	if (typeof options.creationToken === 'string' && options.creationToken.trim()) {
		finalizeBody.creation_token = options.creationToken.trim();
	}

	const finRes = await fetch('/api/create/import-audio/finalize', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify(finalizeBody),
	});
	const data = await readJsonSafe(finRes);
	if (!finRes.ok) {
		const msg =
			(typeof data?.error === 'string' && data.error.trim()) ||
			(finRes.status === 401 ? 'Sign in to import audio.' : 'Could not import that audio file.');
		throw new Error(msg);
	}
	const id = Number(data?.id);
	if (!Number.isFinite(id) || id <= 0) {
		throw new Error('Import succeeded but no creation id was returned.');
	}
	return {
		id,
		title: typeof data?.title === 'string' ? data.title : '',
		warning: data?.warning || null,
	};
}
