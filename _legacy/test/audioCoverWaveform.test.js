import { describe, expect, test } from '@jest/globals';
import {
	audioCoverWaveformHtml,
	audioCardViaLabel,
	buildAudioCardEmbedSrc,
	creationMediaType,
	creationNeedsAudioWaveformCover,
	resolveChatAudioPlayerSrc,
	resolveCreationAudioPlayUrl,
} from '../public/shared/audioCoverWaveform.js';

describe('creationNeedsAudioWaveformCover', () => {
	test('generated speech with a stored still is treated as real cover art', () => {
		expect(
			creationNeedsAudioWaveformCover({
				media_type: 'audio',
				url: '/api/images/created/26_30718_cover.png?creation_id=30718',
				meta: { media_type: 'audio', method: 'replicateSpeech' },
			})
		).toBe(false);
	});

	test('list payload without cover_source still keeps a PNG', () => {
		expect(
			creationNeedsAudioWaveformCover({
				media_type: 'audio',
				url: '/api/images/created/26_30718_1789796784571_iz942qu.png?creation_id=30718',
				thumbnail_url:
					'/api/images/created/26_30718_1789796784571_iz942qu.png?creation_id=30718&variant=thumbnail',
				meta: { media_type: 'audio', method: 'lyria' },
			})
		).toBe(false);
	});

	test('speech placeholder cover uses waveform', () => {
		expect(
			creationNeedsAudioWaveformCover({
				media_type: 'audio',
				url: '/api/images/created/1',
				meta: { media_type: 'audio', method: 'replicateSpeech', cover_placeholder: true },
			})
		).toBe(true);
	});

	test('audio with no image uses waveform', () => {
		expect(creationNeedsAudioWaveformCover({ media_type: 'audio', meta: { media_type: 'audio' } })).toBe(true);
	});

	test('procedural cover is treated as real album art', () => {
		expect(
			creationNeedsAudioWaveformCover({
				media_type: 'audio',
				url: '/api/images/created/9.png',
				meta: { media_type: 'audio', cover_source: 'procedural' },
			})
		).toBe(false);
	});

	test('Suno / real cover keeps the image', () => {
		expect(
			creationNeedsAudioWaveformCover({
				media_type: 'audio',
				url: 'https://cdn.example/cover.jpg',
				meta: { media_type: 'audio', import: { provider: 'suno' } },
			})
		).toBe(false);
	});

	test('YouTube imports keep their thumbnail, never a waveform', () => {
		expect(
			creationNeedsAudioWaveformCover({
				media_type: 'video',
				url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
				meta: { media_type: 'video', import: { provider: 'youtube', video_id: 'abc' } },
			})
		).toBe(false);
		expect(
			creationMediaType({
				url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
				meta: { import: { provider: 'youtube' }, method: 'voice-over' },
			})
		).toBe('video');
	});

	test('placeholder file_path is not album art', () => {
		expect(
			creationNeedsAudioWaveformCover({
				media_type: 'audio',
				file_path: '/api/images/created/1.png',
				meta: { media_type: 'audio', method: 'lyria' },
			})
		).toBe(false);
		expect(
			creationNeedsAudioWaveformCover({
				media_type: 'audio',
				url: '/images/audio-cover-waveform.svg',
				meta: { media_type: 'audio', import: { provider: 'file' } },
			})
		).toBe(true);
		expect(
			creationNeedsAudioWaveformCover({
				media_type: 'audio',
				url: '/images/audio-cover-waveform.svg',
				file_path: '/api/images/created/26_30718_cover.png',
				meta: { media_type: 'audio' },
			})
		).toBe(false);
	});

	test('images never get a waveform cover', () => {
		expect(creationNeedsAudioWaveformCover({ media_type: 'image', url: '/x.png' })).toBe(false);
		expect(creationMediaType({ meta: { media_type: 'audio' } })).toBe('audio');
	});

	test('audio CDN id without media_type still uses waveform', () => {
		expect(
			creationNeedsAudioWaveformCover({
				meta: { audio: { cdn_id: 'o_aaaaaaaaaaaaaaaaaaaaaaaa' } },
			})
		).toBe(true);
		expect(
			creationMediaType({
				audio_url: '/api/create/images/9/audio',
				meta: { audio: { cdn_id: 'o_aaaaaaaaaaaaaaaaaaaaaaaa' } },
			})
		).toBe('audio');
	});
});

describe('resolveCreationAudioPlayUrl', () => {
	test('share token wins over a private audio_url so pasted share links can play', () => {
		expect(resolveCreationAudioPlayUrl({ audio_url: '/api/create/images/3/audio' })).toBe(
			'/api/create/images/3/audio'
		);
		expect(
			resolveCreationAudioPlayUrl(
				{ audio_url: '/api/create/images/3/audio' },
				{ creationId: 3, shareVersion: 'v1', shareToken: 'tok' }
			)
		).toBe('/api/share/v1/tok/cdn-audio');
		expect(resolveCreationAudioPlayUrl({}, { creationId: 9 })).toBe('/api/create/images/9/audio');
	});
});

describe('audio player card src', () => {
	test('hosted audio uses audio-card without a Suno wordmark page', () => {
		const src = buildAudioCardEmbedSrc({
			title: 'Glass',
			coverUrl: '/api/images/created/a.png',
			audioUrl: '/api/create/images/9/audio',
			href: '/creations/9',
			durationSec: 92,
		});
		expect(src.startsWith('/audio-card.html?')).toBe(true);
		expect(src).toContain('t=Glass');
		expect(src).toContain('src=%2Fapi%2Fcreate%2Fimages%2F9%2Faudio');
		expect(src).toContain('href=%2Fcreations%2F9');
		expect(src).toContain('dur=92');
	});

	test('hosted audio without a title omits t so the card can show Untitled', () => {
		const src = buildAudioCardEmbedSrc({
			coverUrl: '/api/images/created/a.png',
			audioUrl: '/api/create/images/9/audio',
			href: '/creations/9',
		});
		expect(src).not.toContain('t=');
		expect(src).toContain('href=%2Fcreations%2F9');
	});

	test('Suno imports keep the Suno card', () => {
		expect(
			resolveChatAudioPlayerSrc({
				meta: { import: { provider: 'suno', song_id: 'a793f774-75fc-48b0-93ea-6089c6804506' } },
				title: 'Harbor',
				audioUrl: '/api/create/images/9/audio',
			})
		).toBe('/suno-card.html?id=a793f774-75fc-48b0-93ea-6089c6804506&t=Harbor');
	});

	test('file imports use the logo-less card', () => {
		const src = resolveChatAudioPlayerSrc({
			meta: { import: { provider: 'file' } },
			title: 'Demo',
			coverUrl: '/api/images/created/a.png',
			audioUrl: '/api/create/images/4/audio',
		});
		expect(src.startsWith('/audio-card.html?')).toBe(true);
		expect(src).not.toContain('via=');
	});

	test('hosted card via label is a quiet server · model mark', () => {
		expect(audioCardViaLabel({ server_name: 'Parascene Blue', args: { model: 'lyria-002' } })).toBe(
			'BLUE · lyria-002'
		);
		expect(audioCardViaLabel({ server_name: 'Blue', args: { model: 'minimax_music' } })).toBe(
			'BLUE · minimax_music'
		);
		expect(
			audioCardViaLabel({
				server_name: 'Parascene Blue',
				args: { model: 'checkpoints/FLUX1/flux1-schnell-fp8.safetensors' },
			})
		).toBe('BLUE · flux1-schnell-fp8');
		expect(audioCardViaLabel({ import: { provider: 'file' } })).toBe('');
		const src = resolveChatAudioPlayerSrc({
			meta: { server_name: 'Parascene Blue', args: { model: 'lyria-002' } },
			title: 'Harbor',
			audioUrl: '/api/create/images/9/audio',
		});
		expect(src).toContain('via=BLUE');
		expect(src).toContain('lyria-002');
	});

	test('hosted audio card asks the parent to open creation detail', async () => {
		const { readFile } = await import('node:fs/promises');
		const html = await readFile(new URL('../public/audio-card.html', import.meta.url), 'utf8');
		expect(html).toContain("type: 'prsn-creation-detail-overlay-navigate'");
		expect(html).not.toMatch(/id="open"[^>]*target="_blank"/);
		expect(html).toContain('id="via"');
	});
});

describe('audioCoverWaveformHtml', () => {
	test('renders the desktop bar count', () => {
		const svg = audioCoverWaveformHtml();
		expect(svg).toContain('viewBox="0 0 100 100"');
		expect((svg.match(/<rect /g) || []).length).toBe(17);
	});
});
