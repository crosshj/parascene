import { describe, expect, test } from '@jest/globals';
import {
	audioCoverWaveformHtml,
	creationMediaType,
	creationNeedsAudioWaveformCover,
	resolveCreationAudioPlayUrl,
} from '../public/shared/audioCoverWaveform.js';

describe('creationNeedsAudioWaveformCover', () => {
	test('generated speech with a placeholder PNG still uses waveform', () => {
		expect(
			creationNeedsAudioWaveformCover({
				media_type: 'audio',
				url: '/api/images/created/1',
				meta: { media_type: 'audio', method: 'replicateSpeech' },
			})
		).toBe(true);
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
		).toBe(true);
		expect(
			creationNeedsAudioWaveformCover({
				media_type: 'audio',
				url: '/images/audio-cover-waveform.svg',
				meta: { media_type: 'audio', import: { provider: 'file' } },
			})
		).toBe(true);
	});

	test('images never get a waveform cover', () => {
		expect(creationNeedsAudioWaveformCover({ media_type: 'image', url: '/x.png' })).toBe(false);
		expect(creationMediaType({ meta: { media_type: 'audio' } })).toBe('audio');
	});

	test('audio CDN id without media_type still uses waveform', () => {
		expect(
			creationNeedsAudioWaveformCover({
				url: '/api/images/created/1',
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

describe('audioCoverWaveformHtml', () => {
	test('renders the desktop bar count', () => {
		const svg = audioCoverWaveformHtml();
		expect(svg).toContain('viewBox="0 0 100 100"');
		expect((svg.match(/<rect /g) || []).length).toBe(17);
	});
});
