import {
	mergeChallengeConfigFieldsForChallenge,
	mergeFullChallengeConfigForChallenge,
	pickChallengeResultsCreationUrl
} from '../src/chat/challenges/challengeAdmin.js';
import { deriveChallengePhase } from '../src/chat/challenges/model/phases.js';
import { renderChallengeOrganizerViewHtml } from '../src/chat/challenges/views/adminView.js';

describe('pickChallengeResultsCreationUrl', () => {
	test('reads results_creation_url', () => {
		expect(pickChallengeResultsCreationUrl({ results_creation_url: '/creations/12787' })).toBe(
			'/creations/12787'
		);
	});
});

describe('mergeChallengeConfigFieldsForChallenge', () => {
	test('last chronological patch wins per field', () => {
		const entries = [
			{
				payload: {
					kind: 'challenge_config',
					challenge_id: 'cake',
					results_creation_url: '/creations/1'
				}
			},
			{
				payload: {
					kind: 'challenge_config',
					challenge_id: 'cake',
					title: 'Updated title'
				}
			},
			{
				payload: {
					kind: 'challenge_config',
					challenge_id: 'cake',
					results_creation_url: '/creations/12787',
					results_published_at: '2026-06-01T12:00:00.000Z'
				}
			}
		];
		const merged = mergeChallengeConfigFieldsForChallenge(entries, 'cake');
		expect(merged.results_creation_url).toBe('/creations/12787');
		expect(merged.results_published_at).toBe('2026-06-01T12:00:00.000Z');
	});

	test('merged payload enters results phase', () => {
		const entries = [
			{
				payload: {
					kind: 'challenge_config',
					challenge_id: 'cake',
					voting_end_at: '2026-05-01T00:00:00.000Z',
					results_published_at: '2026-05-02T00:00:00.000Z',
					results_creation_url: '/creations/12787'
				}
			}
		];
		const merged = mergeChallengeConfigFieldsForChallenge(entries, 'cake');
		const phase = deriveChallengePhase(
			{ ...entries[0].payload, ...merged },
			Date.parse('2026-06-01T00:00:00.000Z')
		);
		expect(phase).toBe('results');
	});
});

describe('mergeFullChallengeConfigForChallenge', () => {
	test('merges all fields chronologically', () => {
		const entries = [
			{
				payload: {
					kind: 'challenge_config',
					challenge_id: 'cake',
					title: 'Original',
					hero_image_url: '/creations/1'
				}
			},
			{
				payload: {
					kind: 'challenge_config',
					challenge_id: 'cake',
					title: 'Updated title'
				}
			},
			{
				payload: {
					kind: 'challenge_config',
					challenge_id: 'cake',
					results_creation_url: '/creations/12787'
				}
			}
		];
		const merged = mergeFullChallengeConfigForChallenge(entries, 'cake');
		expect(merged.title).toBe('Updated title');
		expect(merged.hero_image_url).toBe('/creations/1');
		expect(merged.results_creation_url).toBe('/creations/12787');
	});
});

describe('completed challenge view — late results post', () => {
	test('shows add form when results URL is missing', () => {
		const html = renderChallengeOrganizerViewHtml(
			{
				challenge_id: 'one-prompt',
				title: 'One Prompt, Two Worlds',
				results_published_at: '2026-08-12T00:00:00.000Z'
			},
			{ configMessageId: 42, activeTab: 'pins' }
		);
		expect(html).toContain('data-challenge-admin-edit-section="results-late"');
		expect(html).toContain('name="results_creation_url"');
		expect(html).toContain('name="config_message_id"');
		expect(html).toContain('value="42"');
		expect(html).not.toContain('challenges-organize-view-link');
	});

	test('shows results link and no add form when a post is already attached', () => {
		const html = renderChallengeOrganizerViewHtml(
			{
				challenge_id: 'one-prompt',
				title: 'One Prompt, Two Worlds',
				results_creation_url: '/creations/21806',
				results_published_at: '2026-08-12T00:00:00.000Z'
			},
			{ configMessageId: 42, activeTab: 'pins' }
		);
		expect(html).not.toContain('data-challenge-admin-edit-section="results-late"');
		expect(html).toContain('href="/creations/21806"');
	});
});
