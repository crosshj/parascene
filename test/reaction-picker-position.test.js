import assert from 'node:assert/strict';
import test from 'node:test';
import { reactionPickerPosition } from '../client/components/Messages/placeReactionPicker.js';

const viewport = { offsetLeft: 0, offsetTop: 0, width: 390, height: 700 };
const popup = { width: 220, height: 110 };

test('opens below the button when the composer is clear', () => {
	const placed = reactionPickerPosition({
		anchor: { left: 24, top: 200, bottom: 228 },
		popup,
		viewport,
		composerTop: 640,
	});
	assert.equal(placed.left, 24);
	assert.equal(placed.top, 232);
	assert.ok(placed.top + popup.height < 640);
});

test('opens above the button when below would cover the composer', () => {
	const placed = reactionPickerPosition({
		anchor: { left: 24, top: 560, bottom: 588 },
		popup,
		viewport,
		composerTop: 600,
	});
	assert.equal(placed.top, 560 - 4 - popup.height);
	assert.ok(placed.top + popup.height <= 600 - 8);
});

test('keeps the picker on the visual viewport when the layout viewport is taller', () => {
	const placed = reactionPickerPosition({
		anchor: { left: 16, top: 40, bottom: 68 },
		popup,
		viewport: { offsetLeft: 0, offsetTop: 180, width: 390, height: 420 },
		composerTop: 360,
	});
	assert.equal(placed.top, 180 + 68 + 4);
	assert.ok(placed.top + popup.height <= 180 + 360 - 8);
	assert.ok(placed.top < 180 + 420);
});

test('clamps a wide picker inside the visual viewport', () => {
	const placed = reactionPickerPosition({
		anchor: { left: 300, top: 200, bottom: 228 },
		popup,
		viewport,
		composerTop: null,
	});
	assert.equal(placed.left, 390 - 8 - popup.width);
	assert.equal(placed.top, 232);
});
