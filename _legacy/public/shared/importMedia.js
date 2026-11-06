/**
 * Unified media import helpers (Suno + YouTube).
 */

import {
	extractSoloSunoImportUrl,
	extractSunoSongUrl,
	importSunoSongFromUrl,
	previewSunoImportFromUrl,
} from './importSuno.js';
import {
	extractSoloYoutubeImportUrl,
	extractYoutubeVideoUrl,
	importYoutubeVideoFromUrl,
	previewYoutubeImportFromUrl,
} from './importYoutube.js';

/**
 * @typedef {'suno' | 'youtube'} MediaImportProvider
 */

/**
 * @param {string} value
 * @returns {{ provider: MediaImportProvider, url: string } | null}
 */
export function detectMediaImportUrl(value) {
	const suno = extractSunoSongUrl(value);
	if (suno) return { provider: 'suno', url: suno };
	const youtube = extractYoutubeVideoUrl(value);
	if (youtube) return { provider: 'youtube', url: youtube };
	return null;
}

/**
 * Prompt is only a supported import URL (no other text).
 * @param {string} text
 * @returns {{ provider: MediaImportProvider, url: string } | null}
 */
export function extractSoloMediaImport(text) {
	const suno = extractSoloSunoImportUrl(text);
	if (suno) return { provider: 'suno', url: suno };
	const youtube = extractSoloYoutubeImportUrl(text);
	if (youtube) return { provider: 'youtube', url: youtube };
	return null;
}

/**
 * @param {MediaImportProvider} provider
 * @param {string} url
 */
export async function previewMediaImport(provider, url) {
	if (provider === 'youtube') {
		const preview = await previewYoutubeImportFromUrl(url);
		return {
			provider: 'youtube',
			url: preview.url,
			title: preview.title,
			cover_url: preview.cover_url,
			existing_id: preview.existing_id,
			kindLabel: 'Video',
		};
	}
	const preview = await previewSunoImportFromUrl(url);
	return {
		provider: 'suno',
		url: preview.url,
		title: preview.title,
		cover_url: preview.cover_url,
		existing_id: preview.existing_id,
		kindLabel: 'Song',
	};
}

/**
 * @param {MediaImportProvider} provider
 * @param {string} url
 * @param {{ creationToken?: string }} [options]
 */
export async function importMediaFromUrl(provider, url, options = {}) {
	if (provider === 'youtube') {
		return importYoutubeVideoFromUrl(url, options);
	}
	return importSunoSongFromUrl(url, options);
}
