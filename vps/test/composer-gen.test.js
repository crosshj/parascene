import assert from 'node:assert/strict';
import test from 'node:test';
import {
	extractStyleKeyFromGenPrompt,
	parseGenCommand,
} from '../client/shared/composerGen.js';

test('parseGenCommand matches /gen prompts including quoted text', () => {
	assert.equal(parseGenCommand('hello'), null);
	assert.deepEqual(parseGenCommand('/gen'), { prompt: '' });
	assert.deepEqual(
		parseGenCommand('/gen Attention all! Support the vibe in #video-games!'),
		{ prompt: 'Attention all! Support the vibe in #video-games!' }
	);
	assert.deepEqual(
		parseGenCommand('/gen "Attention all!  Support the vibe in #video-games!"'),
		{ prompt: '"Attention all!  Support the vibe in #video-games!"' }
	);
	assert.deepEqual(parseGenCommand('  /GEN cool pig  '), { prompt: 'cool pig' });
});

test('extractStyleKeyFromGenPrompt strips trailing $style tokens', () => {
	assert.deepEqual(extractStyleKeyFromGenPrompt('a pig $anime'), {
		styleKey: 'anime',
		promptWithoutStyle: 'a pig',
	});
	assert.deepEqual(extractStyleKeyFromGenPrompt('plain prompt'), {
		styleKey: '',
		promptWithoutStyle: 'plain prompt',
	});
	assert.deepEqual(extractStyleKeyFromGenPrompt('x $none'), {
		styleKey: '',
		promptWithoutStyle: 'x',
	});
});
