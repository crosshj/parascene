import { describe, expect, test } from '@jest/globals';
import {
	editorialPinMatchesSurface,
	isEditorialPinActive,
	normalizeEditorialPinConfig,
	parseEditorialPinPolicyDocument,
	validateEditorialPinPolicyDocument
} from '../api_routes/feed/editorialPinPolicy.js';
import {
	mergeEditorialPinIntoPage,
	resolveEditorialPinInsertIndex
} from '../api_routes/feed/editorialPin.js';

describe('editorialPinPolicy', () => {
	test('parses and validates pin document', () => {
		const doc = parseEditorialPinPolicyDocument({
			defaults: { min_index_flat: 4 },
			pins: [
				{
					created_image_id: 12440,
					enabled: true,
					until: '2026-06-10T23:59:59.999Z',
					show_metadata: false,
					surfaces: ['chat'],
					inject: { slot: 'after_third' }
				}
			]
		});
		const validated = validateEditorialPinPolicyDocument(doc);
		expect(validated.ok).toBe(true);
		expect(validated.document.pins[0].created_image_id).toBe(12440);
		expect(validated.document.pins[0].show_metadata).toBe(false);
		expect(validated.document.defaults.min_index_flat).toBe(4);
	});

	test('rejects invalid date range', () => {
		const pin = normalizeEditorialPinConfig({
			created_image_id: 1,
			starts_at: '2026-06-10T00:00:00.000Z',
			until: '2026-06-01T00:00:00.000Z'
		});
		const validated = validateEditorialPinPolicyDocument({ pins: [pin] });
		expect(validated.ok).toBe(false);
	});

	test('surface filter', () => {
		const pin = normalizeEditorialPinConfig({
			created_image_id: 1,
			surfaces: ['home']
		});
		expect(editorialPinMatchesSurface(pin.surfaces, 'chat')).toBe(false);
		expect(editorialPinMatchesSurface(pin.surfaces, '')).toBe(true);
		expect(isEditorialPinActive({ ...pin, enabled: true }, Date.now(), 'chat')).toBe(false);
	});
});

describe('resolveEditorialPinInsertIndex with policy config', () => {
	test('honors after_third slot with min floor', () => {
		const list = Array.from({ length: 6 }, (_, i) => ({ id: i + 1 }));
		const pin = normalizeEditorialPinConfig({
			created_image_id: 99,
			inject: { slot: 'after_third', min_index_flat: 5 }
		});
		const idx = resolveEditorialPinInsertIndex(list, pin, { min_index_flat: 3 }, {});
		expect(idx).toBe(5);
	});
});
