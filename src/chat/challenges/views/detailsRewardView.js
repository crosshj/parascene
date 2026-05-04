import {
	challengeConfigHasStructuredRewardFields,
	pickChallengeHeroImageUrl
} from '../challengeAdmin.js';
import { esc } from '../constants.js';

/**
 * Hero image above description (`hero_image_url` on challenge_config).
 * @param {object} cfg challenge_config
 * @param {string} [titleFallback] for img alt text
 */
export function renderChallengeHeroImage(cfg, titleFallback) {
	const raw = pickChallengeHeroImageUrl(cfg);
	if (!raw) return '';
	const alt =
		typeof titleFallback === 'string' && titleFallback.trim()
			? titleFallback.trim()
			: 'Challenge image';
	return `<section class="challenge-pane-section challenge-pane-hero-image-section" aria-label="Challenge image">
			<div class="challenge-pane-hero-image-wrap challenge-pane-hero-image-wrap--strip challenge-pane-hero-image-wrap--pending" data-challenge-hero-pending data-challenge-hero-ref="${esc(raw)}">
				<img class="challenge-pane-hero-image" alt="${esc(alt)}" loading="lazy" decoding="async" data-challenge-hero-img hidden />
				<p class="challenge-pane-muted challenge-pane-hero-image-fallback" data-challenge-hero-fallback hidden></p>
			</div>
		</section>`;
}

function trimReward(cfg, key) {
	if (!cfg || typeof cfg !== 'object') return '';
	const v = cfg[key];
	return v == null ? '' : String(v).trim();
}

/** Safe fragment for SVG id / url(#…) refs */
function svgDomId(uid) {
	return String(uid).replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Placement medals (1–3): full coin SVG with metallic gradient + rim + tinted digit.
 * @param {'gold'|'silver'|'bronze'} metal
 * @param {'1'|'2'|'3'} digit
 */
function svgPlacementMedal(metal, digit, uid) {
	const id = svgDomId(uid);
	const gf = `cr-f-${id}`;
	const gh = `cr-h-${id}`;
	const palettes =
		metal === 'gold'
			? {
					stops: ['#fde68a', '#f59e0b', '#92400e'],
					rim: '#b45309',
					digit: '#78350f'
				}
			: metal === 'silver'
				? {
						stops: ['#f3f4f6', '#9ca3af', '#4b5563'],
						rim: '#6b7280',
						digit: '#1f2937'
					}
				: {
						stops: ['#fcd9bd', '#c2410c', '#7c2d12'],
						rim: '#9a3412',
						digit: '#60200b'
					};
	const [s0, s1, s2] = palettes.stops;
	return `<div class="challenge-reward-coin-wrap" aria-hidden="true">
			<svg class="challenge-reward-coin-svg" viewBox="0 0 64 64" width="52" height="52" aria-hidden="true" focusable="false">
				<defs>
					<linearGradient id="${gf}" x1="14%" y1="10%" x2="86%" y2="90%">
						<stop offset="0%" stop-color="${s0}" />
						<stop offset="45%" stop-color="${s1}" />
						<stop offset="100%" stop-color="${s2}" />
					</linearGradient>
					<radialGradient id="${gh}" cx="34%" cy="28%" r="58%">
						<stop offset="0%" stop-color="rgba(255,255,255,0.42)" />
						<stop offset="55%" stop-color="rgba(255,255,255,0)" />
					</radialGradient>
				</defs>
				<circle cx="32" cy="32" r="25.5" fill="url(#${gf})" stroke="${palettes.rim}" stroke-width="7" />
				<circle cx="32" cy="32" r="25.5" fill="url(#${gh})" />
				<text x="32" y="41" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="26" font-weight="800" fill="${palettes.digit}">${digit}</text>
			</svg>
		</div>`;
}

function svgParticipationMedal(uid) {
	const id = svgDomId(uid);
	const gf = `cr-pf-${id}`;
	const gh = `cr-ph-${id}`;
	return `<div class="challenge-reward-coin-wrap" aria-hidden="true">
			<svg class="challenge-reward-coin-svg" viewBox="0 0 64 64" width="52" height="52" aria-hidden="true" focusable="false">
				<defs>
					<linearGradient id="${gf}" x1="14%" y1="10%" x2="86%" y2="90%">
						<stop offset="0%" stop-color="#bae6fd" />
						<stop offset="45%" stop-color="#38bdf8" />
						<stop offset="100%" stop-color="#0369a1" />
					</linearGradient>
					<radialGradient id="${gh}" cx="34%" cy="28%" r="58%">
						<stop offset="0%" stop-color="rgba(255,255,255,0.38)" />
						<stop offset="55%" stop-color="rgba(255,255,255,0)" />
					</radialGradient>
				</defs>
				<circle cx="32" cy="32" r="25.5" fill="url(#${gf})" stroke="#0284c7" stroke-width="7" />
				<circle cx="32" cy="32" r="25.5" fill="url(#${gh})" />
				<g transform="translate(20 20)" fill="#e0f2fe">
					<path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
				</g>
			</svg>
		</div>`;
}

function svgCustomMedal(uid) {
	const id = svgDomId(uid);
	const gf = `cr-cf-${id}`;
	const gh = `cr-ch-${id}`;
	return `<div class="challenge-reward-coin-wrap" aria-hidden="true">
			<svg class="challenge-reward-coin-svg" viewBox="0 0 64 64" width="52" height="52" aria-hidden="true" focusable="false">
				<defs>
					<linearGradient id="${gf}" x1="14%" y1="10%" x2="86%" y2="90%">
						<stop offset="0%" stop-color="#ddd6fe" />
						<stop offset="45%" stop-color="#a78bfa" />
						<stop offset="100%" stop-color="#5b21b6" />
					</linearGradient>
					<radialGradient id="${gh}" cx="34%" cy="28%" r="58%">
						<stop offset="0%" stop-color="rgba(255,255,255,0.38)" />
						<stop offset="55%" stop-color="rgba(255,255,255,0)" />
					</radialGradient>
				</defs>
				<circle cx="32" cy="32" r="25.5" fill="url(#${gf})" stroke="#7c3aed" stroke-width="7" />
				<circle cx="32" cy="32" r="25.5" fill="url(#${gh})" />
				<polygon fill="#ede9fe" points="32,15 47,32 32,49 17,32" />
			</svg>
		</div>`;
}

function svgLegacyMedal(uid) {
	const id = svgDomId(uid);
	const gf = `cr-lf-${id}`;
	const gh = `cr-lh-${id}`;
	return `<div class="challenge-reward-coin-wrap" aria-hidden="true">
			<svg class="challenge-reward-coin-svg" viewBox="0 0 64 64" width="52" height="52" aria-hidden="true" focusable="false">
				<defs>
					<linearGradient id="${gf}" x1="14%" y1="10%" x2="86%" y2="90%">
						<stop offset="0%" stop-color="#6366f1" />
						<stop offset="50%" stop-color="#4f46e5" />
						<stop offset="100%" stop-color="#1e1b4b" />
					</linearGradient>
					<radialGradient id="${gh}" cx="34%" cy="28%" r="58%">
						<stop offset="0%" stop-color="rgba(255,255,255,0.35)" />
						<stop offset="55%" stop-color="rgba(255,255,255,0)" />
					</radialGradient>
				</defs>
				<circle cx="32" cy="32" r="25.5" fill="url(#${gf})" stroke="#818cf8" stroke-width="7" />
				<circle cx="32" cy="32" r="25.5" fill="url(#${gh})" />
				<g fill="rgba(255,255,255,0.92)" transform="translate(18 14) scale(1.15)">
					<path d="M8 5h8v1.2c0 2.3-1.6 4.2-3.8 4.7l-.2.1V14h6v2H6v-2h6v-2l-.2-.1C9.6 11.4 8 9.5 8 7.2V5zm2 1v1.2c0 1.5 1 2.7 2.5 3l.5.1.5-.1c1.5-.3 2.5-1.5 2.5-3V6h-6zm-5 .5V8c0 .8.3 1.5.8 2.1l-.8.6V7.5zm15 0h2V11l-.8-.6c.5-.6.8-1.3.8-2.1V7.5zM10 19h4v2h-4v-2z" />
				</g>
			</svg>
		</div>`;
}

function rewardCoinSvg(variant, uid) {
	if (variant === 'gold') return svgPlacementMedal('gold', '1', uid);
	if (variant === 'silver') return svgPlacementMedal('silver', '2', uid);
	if (variant === 'bronze') return svgPlacementMedal('bronze', '3', uid);
	if (variant === 'participation') return svgParticipationMedal(uid);
	if (variant === 'custom') return svgCustomMedal(uid);
	return svgLegacyMedal(uid);
}

function rewardCardHtml(opts) {
	const { variant, title, bodyHtml, coinUid } = opts;
	const coin = rewardCoinSvg(variant, coinUid);

	return `<article class="challenge-reward-card">
			${coin}
			<div class="challenge-reward-card-body">
				<h4 class="challenge-reward-card-title">${title}</h4>
				<div class="challenge-reward-card-text user-text">${bodyHtml}</div>
			</div>
		</article>`;
}

/**
 * Rich rewards strip: placements use metallic coins; participation / custom use accent glyphs.
 * Legacy configs with only `reward` show one trophy card until organizers migrate.
 * @param {object} cfg challenge_config
 */
export function renderRewardsSection(cfg) {
	const structured = challengeConfigHasStructuredRewardFields(cfg);
	const legacyOnly =
		!structured &&
		cfg &&
		typeof cfg === 'object' &&
		cfg.reward != null &&
		String(cfg.reward).trim();

	if (!structured && !legacyOnly) return '';

	const cards = [];
	let coinSeq = 0;
	const nextCoinUid = () => `cr-${++coinSeq}-${Date.now().toString(36)}`;

	if (structured) {
		const r1 = trimReward(cfg, 'reward_first');
		const r2 = trimReward(cfg, 'reward_second');
		const r3 = trimReward(cfg, 'reward_third');
		const rp = trimReward(cfg, 'reward_participation');
		const rc = trimReward(cfg, 'reward_custom');

		if (r1) {
			cards.push(
				rewardCardHtml({
					variant: 'gold',
					title: '1st place',
					bodyHtml: `<p>${esc(r1)}</p>`,
					coinUid: nextCoinUid()
				})
			);
		}
		if (r2) {
			cards.push(
				rewardCardHtml({
					variant: 'silver',
					title: '2nd place',
					bodyHtml: `<p>${esc(r2)}</p>`,
					coinUid: nextCoinUid()
				})
			);
		}
		if (r3) {
			cards.push(
				rewardCardHtml({
					variant: 'bronze',
					title: '3rd place',
					bodyHtml: `<p>${esc(r3)}</p>`,
					coinUid: nextCoinUid()
				})
			);
		}
		if (rp) {
			cards.push(
				rewardCardHtml({
					variant: 'participation',
					title: 'Participation',
					bodyHtml: `<p>${esc(rp)}</p>`,
					coinUid: nextCoinUid()
				})
			);
		}
		if (rc) {
			cards.push(
				rewardCardHtml({
					variant: 'custom',
					title: 'Custom',
					bodyHtml: `<p>${esc(rc)}</p>`,
					coinUid: nextCoinUid()
				})
			);
		}

		if (!cards.length) return '';
	} else if (legacyOnly) {
		cards.push(
			rewardCardHtml({
				variant: 'legacy',
				title: 'Reward',
				bodyHtml: `<p>${esc(String(cfg.reward).trim())}</p>`,
				coinUid: nextCoinUid()
			})
		);
	}

	return `<section class="challenge-pane-section challenge-pane-rewards-section">
			<h3 class="challenge-pane-section-label">Rewards</h3>
			<div class="challenge-rewards-stack">${cards.join('')}</div>
		</section>`;
}

/**
 * @param {{ details?: unknown }} cfg
 */
export function renderDetailsAndReward(cfg) {
	let html = '';
	if (cfg.details) {
		html += `<section class="challenge-pane-section"><h3 class="challenge-pane-section-label">Details</h3><div class="challenge-pane-details user-text">${esc(String(cfg.details))}</div></section>`;
	}
	html += renderRewardsSection(cfg);
	return html;
}
