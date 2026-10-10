import assert from 'node:assert/strict';
import test from 'node:test';
import { pngSize } from '../client/shared/queueFromFrameModal.js';

test('png size reads the IHDR dimensions', () => {
	const bytes = new Uint8Array(24);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, 1920);
	view.setUint32(20, 1080);
	assert.deepEqual(pngSize(bytes), { width: 1920, height: 1080 });
	assert.deepEqual(pngSize(new Uint8Array([1, 2, 3])), { width: 0, height: 0 });
});
