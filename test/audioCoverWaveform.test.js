import { describe, expect, test } from '@jest/globals';
import {
	audioCoverWaveformHtml,
	creationMediaType,
	creationNeedsAudioWaveformCover,
} from '../public/shared/audioCoverWaveform.js';

describe('creationNeedsAudioWaveformCover', () => {
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

	test('images never get a waveform cover', () => {
		expect(creationNeedsAudioWaveformCover({ media_type: 'image', url: '/x.png' })).toBe(false);
		expect(creationMediaType({ meta: { media_type: 'audio' } })).toBe('audio');
	});
});

describe('audioCoverWaveformHtml', () => {
	test('renders the desktop bar count', () => {
		const svg = audioCoverWaveformHtml();
		expect(svg).toContain('viewBox="0 0 100 100"');
		expect((svg.match(/<rect /g) || []).length).toBe(17);
	});
});
