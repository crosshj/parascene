import { describe, expect, test } from '@jest/globals';
import { renderRewardsSection } from '../src/chat/challenges/views/detailsRewardView.js';

function cfgWith(prizesOverrides = {}, extra = {}) {
	return {
		prizes: {
			main: { first: 400, second: 200, third: 100 },
			top_submitters: { enabled: false, amounts: [50, 30, 20] },
			top_voters: { enabled: false, amounts: [50, 30, 20] },
			...prizesOverrides
		},
		...extra
	};
}

describe('renderRewardsSection participation line', () => {
	test('hidden when both categories are off', () => {
		const html = renderRewardsSection(cfgWith());
		expect(html).not.toContain('Participation');
		expect(html).toContain('400 credits');
	});

	test('shows spot counts for both categories, without amounts', () => {
		const html = renderRewardsSection(
			cfgWith({
				top_submitters: { enabled: true, amounts: [50, 30, 20] },
				top_voters: { enabled: true, amounts: [40, 20, 10] }
			})
		);
		expect(html).toContain('Prizes for top 3 voters and top 3 submitters');
		// participation amounts must never leak before results
		expect(html).not.toContain('50 credits');
		expect(html).not.toContain('40 credits');
		expect(html).not.toContain('30 credits');
		expect(html).not.toContain('20 credits');
	});

	test('copy matches the single enabled category and its spot count', () => {
		expect(
			renderRewardsSection(
				cfgWith({ top_submitters: { enabled: true, amounts: [50, 30, 0] } })
			)
		).toContain('Prizes for top 2 submitters');
		expect(
			renderRewardsSection(
				cfgWith({ top_voters: { enabled: true, amounts: [50, 30, 20] } })
			)
		).toContain('Prizes for top 3 voters');
		expect(
			renderRewardsSection(
				cfgWith({ top_voters: { enabled: true, amounts: [50, 0, 0] } })
			)
		).toContain('Prizes for the top voter');
	});

	test('custom free text still renders alongside', () => {
		const html = renderRewardsSection(
			cfgWith({}, { reward_custom: 'Sponsor sticker pack' })
		);
		expect(html).toContain('Sponsor sticker pack');
	});

	test('no prizes block and no custom renders nothing', () => {
		expect(renderRewardsSection({})).toBe('');
	});
});
