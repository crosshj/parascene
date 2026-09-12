import { describe, expect, test } from '@jest/globals';
import {
	PUBLIC_AUDIO_WAVEFORM_COVER_PATH,
	publicAudioWaveformCoverPath,
} from '../api_routes/utils/audioCoverPublic.js';

describe('publicAudioWaveformCoverPath', () => {
	test('generated speech with a placeholder cover uses the public waveform poster', () => {
		expect(
			publicAudioWaveformCoverPath('audio', {
				media_type: 'audio',
				cover_placeholder: true,
				method: 'replicateSpeech',
			}, '/api/images/created/1.png')
		).toBe(PUBLIC_AUDIO_WAVEFORM_COVER_PATH);
	});

	test('Suno album art is left alone', () => {
		expect(
			publicAudioWaveformCoverPath(
				'audio',
				{ media_type: 'audio', import: { provider: 'suno' } },
				'https://cdn.example/cover.jpg'
			)
		).toBeNull();
	});

	test('video is left alone', () => {
		expect(publicAudioWaveformCoverPath('video', { media_type: 'video' }, '/poster.jpg')).toBeNull();
	});

	test('old waveform SVG and audio streams are not album art', () => {
		expect(
			publicAudioWaveformCoverPath(
				'audio',
				{ media_type: 'audio', import: { provider: 'file' } },
				'https://www.parascene.com/static/audio-cover.svg'
			)
		).toBe(PUBLIC_AUDIO_WAVEFORM_COVER_PATH);
		expect(
			publicAudioWaveformCoverPath('audio', { media_type: 'audio' }, '/api/create/images/22/audio')
		).toBe(PUBLIC_AUDIO_WAVEFORM_COVER_PATH);
	});
});
