import test from "node:test";
import assert from "node:assert/strict";
import {
	isRecommendableCreationRow,
	filterRecommendableCreationIds
} from "../api_routes/utils/recommendableCreations.js";

test("isRecommendableCreationRow accepts published available creations", () => {
	assert.equal(isRecommendableCreationRow({ id: 1, published: true, unavailable_at: null }), true);
	assert.equal(isRecommendableCreationRow({ id: 1, published: 1, unavailable_at: null }), true);
});

test("isRecommendableCreationRow rejects unpublished or unavailable creations", () => {
	assert.equal(isRecommendableCreationRow({ id: 1, published: false, unavailable_at: null }), false);
	assert.equal(isRecommendableCreationRow({ id: 1, published: true, unavailable_at: "2026-01-01T00:00:00Z" }), false);
	assert.equal(isRecommendableCreationRow(null), false);
});

test("filterRecommendableCreationIds preserves order and drops stale ids", async () => {
	const supabase = {
		from() {
			return {
				select() {
					return {
						in: async () => ({
							data: [
								{ id: 2, published: true, unavailable_at: null },
								{ id: 3, published: false, unavailable_at: null },
								{ id: 4, published: true, unavailable_at: "2026-01-01T00:00:00Z" }
							],
							error: null
						})
					};
				}
			};
		}
	};
	const filtered = await filterRecommendableCreationIds(supabase, [3, 2, 4, 99]);
	assert.deepEqual(filtered, [2]);
});
