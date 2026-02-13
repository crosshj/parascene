/**
 * Default policy knob values for related creations algorithm.
 * Keys must match policy_knobs (related.*). Used when key is missing.
 */
export const RELATED_PARAM_DEFAULTS = {
	"related.lineage_weight": "100",
	"related.lineage_min_slots": "2",
	"related.same_server_method_weight": "80",
	"related.same_creator_weight": "50",
	"related.fallback_weight": "20",
	"related.click_next_weight": "50",
	"related.transition_cap_k": "50",
	"related.transition_decay_half_life_days": "7",
	"related.transition_window_days": "0",
	"related.random_fraction": "0.1",
	"related.random_slots_per_batch": "0",
	"related.batch_size": "10",
	"related.candidate_cap_per_signal": "100",
	"related.fallback_enabled": "true"
};

/** @type {string[]} */
export const RELATED_PARAM_KEYS = Object.keys(RELATED_PARAM_DEFAULTS);
