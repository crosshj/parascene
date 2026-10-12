import { describe, expect, test } from '@jest/globals';
import { buildMutateLineageMetaFields } from '../api_routes/utils/mutateLineageMeta.js';

describe('buildMutateLineageMetaFields', () => {
	test('starts history with parent when parent has no history', () => {
		expect(buildMutateLineageMetaFields({}, 10)).toEqual({
			history: [10],
			mutate_of_id: 10,
			direct_parent_ids: [10],
		});
		expect(buildMutateLineageMetaFields(null, 10)).toEqual({
			history: [10],
			mutate_of_id: 10,
			direct_parent_ids: [10],
		});
	});

	test('extends parent history with parent id', () => {
		expect(buildMutateLineageMetaFields({ history: [5, 8] }, 10)).toEqual({
			history: [5, 8, 10],
			mutate_of_id: 10,
			direct_parent_ids: [10],
		});
	});

	test('returns null for invalid source id', () => {
		expect(buildMutateLineageMetaFields({ history: [1] }, 0)).toBeNull();
		expect(buildMutateLineageMetaFields({ history: [1] }, 'x')).toBeNull();
	});
});
