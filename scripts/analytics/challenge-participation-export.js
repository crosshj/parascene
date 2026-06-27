#!/usr/bin/env node
/**
 * Export in-depth challenge participation data for offline / LLM analysis.
 *
 * Reads #challenges channel chat messages (challenge_config + challenge_submission),
 * merges configs per challenge, ranks submissions by vote reactions, and enriches
 * with user profiles and creation metadata. Submission activity timelines use
 * message timestamps; votes record who voted but not when (not stored in DB).
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/analytics/challenge-participation-export.js
 *   node scripts/analytics/challenge-participation-export.js --out .output/challenge-participation/custom.json
 *   node scripts/analytics/challenge-participation-export.js --challenge-id abc123
 *   node scripts/analytics/challenge-participation-export.js --format md
 *
 * Default output: .output/challenge-participation/challenge-participation-<stamp>.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { REPO_ROOT, loadEnv } from '../repo-root.cjs';
import { findChallengesChannelThreadId } from '../../api_routes/utils/challengeSubmitShared.js';
import { extractChallengeEvents } from '../../src/chat/challenges/model/extractEvents.js';
import { summarizeLatestChallengeConfigs } from '../../src/chat/challenges/model/organizerSummaries.js';
import {
	mergeFullChallengeConfigForChallenge,
	pickChallengeConfigTimestamp,
	challengeRewardPrefillsForOrganizerForm
} from '../../src/chat/challenges/challengeAdmin.js';
import { deriveChallengePhase } from '../../src/chat/challenges/model/phases.js';
import {
	buildReactionsByMessageId
} from '../../src/chat/challenges/model/participantSlice.js';
import {
	CHALLENGE_SCORE_REACTION_KEYS,
	challengeReactionKeyToScore,
	totalVoteCountFromChallengeReactions,
	parseIso
} from '../../src/chat/challenges/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv();

const PAGE_SIZE = 500;
const BATCH_SIZE = 100;
const OUTPUT_DIR = path.join(REPO_ROOT, '.output', 'challenge-participation');

const PHASE_LABELS = {
	empty: 'No challenge configured',
	pre_submit: 'Not yet open for submissions',
	submitting: 'Submissions open',
	submit_and_vote: 'Submissions and voting both open',
	voting: 'Voting open',
	between: 'Between submission and voting',
	finalizing: 'Voting closed, results pending',
	results: 'Results published',
	unknown: 'Unknown phase'
};

function printUsage() {
	console.log(
		[
			'Export challenge participation data for LLM / offline analysis.',
			'',
			'Usage:',
			'  node scripts/analytics/challenge-participation-export.js [options]',
			'',
			'Options:',
			'  --out <path>           Write output to file (default: .output/challenge-participation/...)',
			'  --format <json|md>     Output format (default: json)',
			'  --challenge-id <id>  Export a single challenge only',
			'  --help                 Show this help'
		].join('\n')
	);
}

function parseArgs(argv) {
	const opts = {
		out: '',
		format: 'json',
		challengeId: '',
		help: false
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') {
			opts.help = true;
			continue;
		}
		if (arg === '--out') {
			opts.out = path.resolve(REPO_ROOT, argv[i + 1] ?? '');
			i += 1;
			continue;
		}
		if (arg === '--format') {
			opts.format = String(argv[i + 1] ?? 'json').trim().toLowerCase();
			i += 1;
			continue;
		}
		if (arg === '--challenge-id') {
			opts.challengeId = String(argv[i + 1] ?? '').trim();
			i += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	if (opts.format !== 'json' && opts.format !== 'md') {
		throw new Error('--format must be json or md');
	}
	return opts;
}

function defaultOutputPath(format, challengeId = '') {
	const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
	const ext = format === 'md' ? 'md' : 'json';
	const slug = challengeId ? `-${challengeId.replace(/[^a-zA-Z0-9_-]+/g, '-')}` : '';
	return path.join(OUTPUT_DIR, `challenge-participation-${stamp}${slug}.${ext}`);
}

function resolveOutputPath(opts) {
	if (opts.out) return path.resolve(REPO_ROOT, opts.out);
	if (process.env.OUT) return path.resolve(REPO_ROOT, process.env.OUT);
	return defaultOutputPath(opts.format, opts.challengeId);
}

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var ${name}`);
	return value;
}

function parseMeta(raw) {
	if (!raw) return null;
	if (typeof raw === 'object') return raw;
	if (typeof raw === 'string' && raw) {
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	}
	return null;
}

function mediaTypeFromMeta(meta) {
	const mt = meta && typeof meta.media_type === 'string' ? meta.media_type.trim().toLowerCase() : 'image';
	const hasVideo =
		meta &&
		typeof meta.video === 'object' &&
		typeof meta.video.file_path === 'string' &&
		meta.video.file_path.trim();
	return mt === 'video' && hasVideo ? 'video' : 'image';
}

function hoursBetween(startIso, endIso) {
	const a = parseIso(startIso);
	const b = parseIso(endIso);
	if (a == null || b == null || b <= a) return null;
	return Math.round(((b - a) / (60 * 60 * 1000)) * 10) / 10;
}

function pickSchedule(cfg) {
	return {
		submission_start_at: pickChallengeConfigTimestamp(cfg, 'submission_start_at') || null,
		submission_end_at: pickChallengeConfigTimestamp(cfg, 'submission_end_at') || null,
		voting_start_at: pickChallengeConfigTimestamp(cfg, 'voting_start_at') || null,
		voting_end_at: pickChallengeConfigTimestamp(cfg, 'voting_end_at') || null,
		results_published_at:
			typeof cfg?.results_published_at === 'string'
				? cfg.results_published_at.trim() || null
				: typeof cfg?.resultsPublishedAt === 'string'
					? cfg.resultsPublishedAt.trim() || null
					: cfg?.results_published === true || cfg?.results_published === 1
						? 'published_flag_set'
						: null
	};
}

function scheduleDurations(schedule) {
	return {
		submission_window_hours: hoursBetween(schedule.submission_start_at, schedule.submission_end_at),
		voting_window_hours: hoursBetween(schedule.voting_start_at, schedule.voting_end_at),
		overall_hours: hoursBetween(schedule.submission_start_at, schedule.voting_end_at)
	};
}

function submissionsForChallenge(submissions, challengeId) {
	const cid = String(challengeId || '').trim();
	if (!cid) return [];
	return submissions.filter((s) => {
		const id =
			s.payload && s.payload.challenge_id != null ? String(s.payload.challenge_id).trim() : '';
		return id === cid;
	});
}

function configHistoryForChallenge(configEntries, challengeId) {
	const cid = String(challengeId || '').trim();
	return (configEntries || [])
		.filter((row) => {
			const id =
				row?.payload?.challenge_id != null ? String(row.payload.challenge_id).trim() : '';
			return id === cid;
		})
		.map((row) => ({
			message_id: row.msg?.id != null ? Number(row.msg.id) : null,
			created_at: row.msg?.created_at != null ? String(row.msg.created_at) : null,
			sender_id: row.msg?.sender_id != null ? Number(row.msg.sender_id) : null,
			fields_set: Object.keys(row.payload || {}).filter((k) => k !== 'kind')
		}));
}

function countStoredReactionEntries(raw) {
	if (Array.isArray(raw)) {
		return raw.filter((entry) => Number.isFinite(Number(entry)) && Number(entry) > 0).length;
	}
	if (typeof raw === 'number' && Number.isFinite(raw)) {
		return Math.max(0, Math.floor(raw));
	}
	return 0;
}

function weightedScoreFromStoredReactions(reactions) {
	if (!reactions || typeof reactions !== 'object') return 0;
	let sum = 0;
	for (const key of CHALLENGE_SCORE_REACTION_KEYS) {
		const w = challengeReactionKeyToScore(key);
		if (w == null) continue;
		sum += countStoredReactionEntries(reactions[key]) * w;
	}
	return sum;
}

function extractVotesFromReactions(reactions) {
	const votes = [];
	if (!reactions || typeof reactions !== 'object') return votes;
	for (const key of CHALLENGE_SCORE_REACTION_KEYS) {
		const raw = reactions[key];
		const score = challengeReactionKeyToScore(key);
		if (score == null || !Array.isArray(raw)) continue;
		for (const entry of raw) {
			const userId = Number(entry);
			if (!Number.isFinite(userId) || userId <= 0) continue;
			votes.push({ user_id: userId, reaction: key, score });
		}
	}
	return votes;
}

function rankSubmissionsForExport(submissionsForChallenge, reactionMap) {
	const enriched = submissionsForChallenge.map(({ msg, payload }) => {
		const mid = msg?.id != null ? Number(msg.id) : null;
		const reactions =
			mid != null && reactionMap instanceof Map
				? reactionMap.get(mid)
				: msg?.reactions && typeof msg.reactions === 'object'
					? msg.reactions
					: {};
		const score = weightedScoreFromStoredReactions(reactions);
		const createdImageId =
			payload?.created_image_id != null ? Number(payload.created_image_id) : NaN;
		const senderId = msg?.sender_id != null ? Number(msg.sender_id) : null;
		return {
			msg,
			payload,
			messageId: mid,
			score,
			creationId: Number.isFinite(createdImageId) && createdImageId > 0 ? createdImageId : null,
			senderId,
			reactions: reactions || {}
		};
	});
	return enriched.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		const ta = parseIso(a.msg?.created_at) ?? 0;
		const tb = parseIso(b.msg?.created_at) ?? 0;
		return ta - tb;
	});
}

function toUtcDayKey(iso) {
	const t = parseIso(iso);
	if (t == null) return null;
	return new Date(t).toISOString().slice(0, 10);
}

function toUtcHourKey(iso) {
	const t = parseIso(iso);
	if (t == null) return null;
	return new Date(t).toISOString().slice(0, 13);
}

function bucketEventsByPeriod(events, granularity) {
	const map = new Map();
	for (const ev of events) {
		const key = granularity === 'hour' ? toUtcHourKey(ev.at) : toUtcDayKey(ev.at);
		if (!key) continue;
		map.set(key, (map.get(key) || 0) + 1);
	}
	return [...map.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([period, count]) => ({ period, count }));
}

function topActivityBuckets(buckets, limit = 5) {
	return [...buckets].sort((a, b) => b.count - a.count || a.period.localeCompare(b.period)).slice(0, limit);
}

function concentrationInWindow(events, windowStartMs, windowEndMs) {
	if (windowStartMs == null || windowEndMs == null || windowEndMs <= windowStartMs) return null;
	const span = windowEndMs - windowStartMs;
	const quarter = span * 0.25;
	let firstQuarter = 0;
	let lastQuarter = 0;
	for (const ev of events) {
		const t = parseIso(ev.at);
		if (t == null) continue;
		if (t <= windowStartMs + quarter) firstQuarter += 1;
		if (t >= windowEndMs - quarter) lastQuarter += 1;
	}
	const total = events.length || 1;
	return {
		first_quarter_pct: Math.round((firstQuarter / total) * 1000) / 1000,
		last_quarter_pct: Math.round((lastQuarter / total) * 1000) / 1000
	};
}

function buildActivityTimeline(events, schedule, kind) {
	const timed = events.filter((ev) => ev.at);
	const byDay = bucketEventsByPeriod(timed, 'day');
	const byHour = bucketEventsByPeriod(timed, 'hour');
	const times = timed.map((ev) => parseIso(ev.at)).filter((t) => t != null).sort((a, b) => a - b);
	const gaps = [];
	for (let i = 1; i < times.length; i += 1) {
		gaps.push((times[i] - times[i - 1]) / (60 * 60 * 1000));
	}

	const windowStartKey =
		kind === 'votes' ? 'voting_start_at' : 'submission_start_at';
	const windowEndKey = kind === 'votes' ? 'voting_end_at' : 'submission_end_at';
	const windowStart = parseIso(schedule[windowStartKey]);
	const windowEnd = parseIso(schedule[windowEndKey]);

	return {
		kind,
		event_count_with_timestamp: timed.length,
		events_missing_timestamp: events.length - timed.length,
		first_at: times.length ? new Date(times[0]).toISOString() : null,
		last_at: times.length ? new Date(times[times.length - 1]).toISOString() : null,
		by_day_utc: byDay,
		by_hour_utc: byHour,
		busiest_days: topActivityBuckets(byDay, 5),
		busiest_hours: topActivityBuckets(byHour, 8),
		days_with_zero_activity: byDay.filter((row) => row.count === 0).map((row) => row.period),
		median_gap_hours_between_events: median(gaps),
		concentration_in_window: concentrationInWindow(timed, windowStart, windowEnd)
	};
}

function buildChallengeActivity(submissionRows, schedule, voteSummary) {
	const submissionEvents = submissionRows
		.filter((row) => row.submitted_at)
		.map((row) => ({
			at: row.submitted_at,
			message_id: row.message_id,
			submitter_user_id: row.submitter.user_id
		}));

	return {
		submissions: buildActivityTimeline(submissionEvents, schedule, 'submissions'),
		votes: {
			...voteSummary,
			note: 'Vote timestamps are not stored in the database — only who voted and on which entry.'
		}
	};
}

function submissionTimingLabel(submittedAt, schedule) {
	const t = parseIso(submittedAt);
	if (t == null) return 'unknown';
	const subStart = parseIso(schedule.submission_start_at);
	const subEnd = parseIso(schedule.submission_end_at);
	if (subStart != null && t < subStart) return 'before_submission_open';
	if (subEnd != null && t > subEnd) {
		const voteEnd = parseIso(schedule.voting_end_at);
		if (voteEnd != null && t <= voteEnd) return 'during_voting_only';
		if (voteEnd != null && t > voteEnd) return 'after_challenge_closed';
		return 'after_submission_closed';
	}
	if (subStart != null && subEnd != null) {
		const span = subEnd - subStart;
		const elapsed = t - subStart;
		if (span > 0) {
			const ratio = elapsed / span;
			if (ratio <= 0.25) return 'early_submission';
			if (ratio >= 0.75) return 'late_submission';
		}
	}
	return 'during_submission_window';
}

function median(nums) {
	const arr = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
	if (!arr.length) return null;
	const mid = Math.floor(arr.length / 2);
	return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

async function fetchAllThreadMessages(client, threadId) {
	const rows = [];
	let offset = 0;
	while (true) {
		const { data, error } = await client
			.from('prsn_chat_messages')
			.select('id, body, created_at, sender_id, reactions')
			.eq('thread_id', threadId)
			.order('created_at', { ascending: true })
			.order('id', { ascending: true })
			.range(offset, offset + PAGE_SIZE - 1);
		if (error) throw error;
		if (!data?.length) break;
		rows.push(...data);
		if (data.length < PAGE_SIZE) break;
		offset += data.length;
	}
	return rows;
}

async function fetchUserProfiles(client, userIds) {
	const map = new Map();
	const ids = [...new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))];
	for (let i = 0; i < ids.length; i += BATCH_SIZE) {
		const chunk = ids.slice(i, i + BATCH_SIZE);
		const { data, error } = await client
			.from('prsn_user_profiles')
			.select('user_id, user_name, display_name')
			.in('user_id', chunk);
		if (error) throw error;
		for (const row of data || []) {
			const uid = Number(row.user_id);
			if (!Number.isFinite(uid)) continue;
			map.set(uid, {
				user_id: uid,
				user_name: typeof row.user_name === 'string' ? row.user_name.trim() || null : null,
				display_name: typeof row.display_name === 'string' ? row.display_name.trim() || null : null
			});
		}
	}
	return map;
}

async function fetchCreations(client, creationIds) {
	const map = new Map();
	const ids = [...new Set(creationIds.filter((id) => Number.isFinite(id) && id > 0))];
	for (let i = 0; i < ids.length; i += BATCH_SIZE) {
		const chunk = ids.slice(i, i + BATCH_SIZE);
		const { data, error } = await client
			.from('prsn_created_images')
			.select('id, user_id, title, description, meta, published, created_at')
			.in('id', chunk);
		if (error) throw error;
		for (const row of data || []) {
			const id = Number(row.id);
			if (!Number.isFinite(id)) continue;
			const meta = parseMeta(row.meta);
			map.set(id, {
				id,
				user_id: row.user_id != null ? Number(row.user_id) : null,
				title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : 'Untitled',
				description:
					typeof row.description === 'string' && row.description.trim()
						? row.description.trim()
						: null,
				media_type: mediaTypeFromMeta(meta),
				published: row.published === true || row.published === 1,
				created_at: row.created_at != null ? String(row.created_at) : null
			});
		}
	}
	return map;
}

function userRef(profileMap, userId) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) return { user_id: null, user_name: null, display_name: null };
	const p = profileMap.get(uid);
	return {
		user_id: uid,
		user_name: p?.user_name ?? null,
		display_name: p?.display_name ?? null
	};
}

function buildParticipantRollup(submissions, votesBySubmission, profileMap) {
	/** @type {Map<number, { user_id: number, submissions: number, votes_cast: number, votes_received: number, roles: Set<string> }>} */
	const rollup = new Map();

	const touch = (userId) => {
		const uid = Number(userId);
		if (!Number.isFinite(uid) || uid <= 0) return null;
		if (!rollup.has(uid)) {
			rollup.set(uid, {
				user_id: uid,
				submissions: 0,
				votes_cast: 0,
				votes_received: 0,
				roles: new Set()
			});
		}
		return rollup.get(uid);
	};

	for (const sub of submissions) {
		const row = touch(sub.submitter.user_id);
		if (!row) continue;
		row.submissions += 1;
		row.roles.add('submitter');
		row.votes_received += sub.vote_count;
		for (const vote of sub.votes) {
			const voter = touch(vote.voter.user_id);
			if (!voter) continue;
			voter.votes_cast += 1;
			voter.roles.add('voter');
		}
	}

	return Array.from(rollup.values())
		.map((row) => {
			const profile = userRef(profileMap, row.user_id);
			return {
				...profile,
				submissions: row.submissions,
				votes_cast: row.votes_cast,
				votes_received: row.votes_received,
				roles: [...row.roles].sort()
			};
		})
		.sort((a, b) => {
			if (b.submissions !== a.submissions) return b.submissions - a.submissions;
			if (b.votes_cast !== a.votes_cast) return b.votes_cast - a.votes_cast;
			return (a.user_name || '').localeCompare(b.user_name || '');
		});
}

function buildChallengeRecord({
	summary,
	configEntries,
	submissions,
	messages,
	profileMap,
	creationMap,
	nowMs,
	channelMemberCount
}) {
	const challengeId = String(summary.challenge_id || '').trim();
	const merged = mergeFullChallengeConfigForChallenge(configEntries, challengeId);
	const schedule = pickSchedule(merged);
	const history = configHistoryForChallenge(configEntries, challengeId);
	const firstConfigAt = history.length ? history[0].created_at : null;
	const lastConfigAt = history.length ? history[history.length - 1].created_at : null;
	const phase = deriveChallengePhase(merged, nowMs);

	const forChallenge = submissionsForChallenge(submissions, challengeId);
	const reactionMap = buildReactionsByMessageId(messages);
	const ranked = rankSubmissionsForExport(forChallenge, reactionMap);

	const allVotes = [];
	const submissionRows = ranked.map((row, index) => {
		const votes = extractVotesFromReactions(row.reactions).map((vote) => ({
			voter: userRef(profileMap, vote.user_id),
			reaction: vote.reaction,
			score: vote.score
		}));
		allVotes.push(...votes);
		const creationId = row.creationId;
		const creation = creationId != null ? creationMap.get(creationId) : null;
		const submittedAt = row.msg?.created_at != null ? String(row.msg.created_at) : null;
		return {
			rank: index + 1,
			message_id: row.messageId,
			submitted_at: submittedAt,
			submission_timing: submissionTimingLabel(submittedAt, schedule),
			submitter: userRef(profileMap, row.senderId),
			creation: creation
				? {
						id: creation.id,
						title: creation.title,
						media_type: creation.media_type,
						published: creation.published,
						created_at: creation.created_at
					}
				: creationId != null
					? { id: creationId, title: null, media_type: null, published: null, created_at: null }
					: null,
			note: typeof row.payload?.note === 'string' ? row.payload.note.trim() || null : null,
			score: row.score,
			vote_count: totalVoteCountFromChallengeReactions(row.reactions),
			votes
		};
	});

	const uniqueSubmitters = new Set(
		submissionRows.map((s) => s.submitter.user_id).filter((id) => Number.isFinite(id))
	);
	const uniqueVoters = new Set(allVotes.map((v) => v.voter.user_id).filter((id) => Number.isFinite(id)));
	const submittersWithVotes = submissionRows.filter((s) => s.vote_count > 0).length;
	const scores = submissionRows.map((s) => s.score);

	const rewards = challengeRewardPrefillsForOrganizerForm(merged);
	const activity = buildChallengeActivity(submissionRows, schedule, {
		total_votes: allVotes.length,
		unique_voters: uniqueVoters.size
	});

	return {
		challenge_id: challengeId,
		title:
			typeof merged.title === 'string' && merged.title.trim()
				? merged.title.trim()
				: `Challenge ${challengeId}`,
		details: typeof merged.details === 'string' && merged.details.trim() ? merged.details.trim() : null,
		current_phase: phase,
		current_phase_label: PHASE_LABELS[phase] || phase,
		schedule: {
			...schedule,
			first_config_at: firstConfigAt,
			last_config_update_at: lastConfigAt
		},
		schedule_durations_hours: scheduleDurations(schedule),
		rewards,
		results_creation_url:
			typeof merged.results_creation_url === 'string' ? merged.results_creation_url.trim() || null : null,
		participation: {
			submission_count: submissionRows.length,
			unique_submitters: uniqueSubmitters.size,
			total_votes: allVotes.length,
			unique_voters: uniqueVoters.size,
			channel_member_count: channelMemberCount,
			submitter_participation_rate:
				channelMemberCount > 0
					? Math.round((uniqueSubmitters.size / channelMemberCount) * 1000) / 1000
					: null,
			voter_participation_rate:
				channelMemberCount > 0 ? Math.round((uniqueVoters.size / channelMemberCount) * 1000) / 1000 : null,
			submitters_who_received_votes: submittersWithVotes,
			avg_votes_per_entry:
				submissionRows.length > 0
					? Math.round((allVotes.length / submissionRows.length) * 100) / 100
					: null,
			median_score: median(scores),
			top_score: scores.length ? Math.max(...scores) : null
		},
		submissions: submissionRows,
		participants: buildParticipantRollup(submissionRows, null, profileMap),
		activity,
		config_history: history
	};
}

function sortChallenges(challenges) {
	return [...challenges].sort((a, b) => {
		const aStart = parseIso(a.schedule?.submission_start_at) ?? parseIso(a.schedule?.first_config_at) ?? 0;
		const bStart = parseIso(b.schedule?.submission_start_at) ?? parseIso(b.schedule?.first_config_at) ?? 0;
		return bStart - aStart;
	});
}

function renderMarkdown(exportDoc) {
	const lines = [];
	lines.push('# Challenge participation export');
	lines.push('');
	lines.push(`Exported at: ${exportDoc.export_meta.exported_at}`);
	lines.push(`Challenges channel thread: ${exportDoc.channel.thread_id}`);
	lines.push(`Channel members: ${exportDoc.channel.member_count}`);
	lines.push(`Messages scanned: ${exportDoc.export_meta.messages_scanned}`);
	lines.push(`Challenges: ${exportDoc.challenges.length}`);
	lines.push('');
	lines.push('---');
	lines.push('');

	for (const ch of exportDoc.challenges) {
		lines.push(`## ${ch.title}`);
		lines.push('');
		lines.push(`- Challenge ID: \`${ch.challenge_id}\``);
		lines.push(`- Current phase: ${ch.current_phase_label} (\`${ch.current_phase}\`)`);
		lines.push(
			`- Schedule: submissions ${ch.schedule.submission_start_at || '?'} → ${ch.schedule.submission_end_at || '?'}; voting ${ch.schedule.voting_start_at || '?'} → ${ch.schedule.voting_end_at || '?'}`
		);
		if (ch.schedule.results_published_at) {
			lines.push(`- Results published: ${ch.schedule.results_published_at}`);
		}
		lines.push(
			`- Config first set: ${ch.schedule.first_config_at || '?'}; last updated: ${ch.schedule.last_config_update_at || '?'}`
		);
		const d = ch.schedule_durations_hours;
		lines.push(
			`- Durations (hours): submission window ${d.submission_window_hours ?? '?'}, voting window ${d.voting_window_hours ?? '?'}, overall ${d.overall_hours ?? '?'}`
		);
		if (ch.details) {
			lines.push('');
			lines.push('### Details');
			lines.push('');
			lines.push(ch.details);
		}
		lines.push('');
		lines.push('### Participation');
		lines.push('');
		const p = ch.participation;
		lines.push(
			`- ${p.submission_count} submissions from ${p.unique_submitters} users; ${p.total_votes} votes from ${p.unique_voters} voters`
		);
		if (p.channel_member_count != null) {
			lines.push(
				`- Channel participation: ${Math.round((p.submitter_participation_rate || 0) * 100)}% submitted, ${Math.round((p.voter_participation_rate || 0) * 100)}% voted`
			);
		}
		lines.push(
			`- Score stats: median ${p.median_score ?? 0}, top ${p.top_score ?? 0}, avg votes/entry ${p.avg_votes_per_entry ?? 0}`
		);
		if (ch.activity) {
			lines.push('');
			lines.push('### Activity — submissions');
			lines.push('');
			const subAct = ch.activity.submissions;
			lines.push(
				`- ${subAct.event_count_with_timestamp} timed events; first ${subAct.first_at || '?'}, last ${subAct.last_at || '?'}`
			);
			if (subAct.busiest_days?.length) {
				lines.push(
					`- Busiest days: ${subAct.busiest_days.map((row) => `${row.period} (${row.count})`).join(', ')}`
				);
			}
			if (subAct.concentration_in_window) {
				const c = subAct.concentration_in_window;
				lines.push(
					`- Window concentration: ${Math.round(c.first_quarter_pct * 100)}% in first quarter, ${Math.round(c.last_quarter_pct * 100)}% in last quarter`
				);
			}
			lines.push('');
			lines.push('### Votes');
			lines.push('');
			const voteAct = ch.activity.votes;
			lines.push(`- ${voteAct.total_votes} total votes from ${voteAct.unique_voters} voters`);
			if (voteAct.note) lines.push(`- Note: ${voteAct.note}`);
		}
		lines.push('');
		lines.push('### Submissions (ranked)');
		lines.push('');
		for (const sub of ch.submissions) {
			const who = sub.submitter.user_name
				? `@${sub.submitter.user_name}`
				: sub.submitter.display_name || `user ${sub.submitter.user_id}`;
			const creationTitle = sub.creation?.title || '(unknown creation)';
			lines.push(
				`${sub.rank}. **${creationTitle}** by ${who} — score ${sub.score}, ${sub.vote_count} votes, submitted ${sub.submitted_at} (${sub.submission_timing})`
			);
			if (sub.note) lines.push(`   Note: ${sub.note}`);
		}
		lines.push('');
		lines.push('### Participants');
		lines.push('');
		for (const part of ch.participants) {
			const who = part.user_name
				? `@${part.user_name}`
				: part.display_name || `user ${part.user_id}`;
			lines.push(
				`- ${who}: ${part.submissions} submission(s), ${part.votes_cast} votes cast, ${part.votes_received} votes received [${part.roles.join(', ')}]`
			);
		}
		if (ch.config_history.length > 1) {
			lines.push('');
			lines.push('### Config updates');
			lines.push('');
			for (const row of ch.config_history) {
				lines.push(
					`- ${row.created_at}: message ${row.message_id}, fields: ${row.fields_set.join(', ')}`
				);
			}
		}
		lines.push('');
		lines.push('---');
		lines.push('');
	}

	return `${lines.join('\n')}\n`;
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printUsage();
		return;
	}

	const client = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
	const threadId = await findChallengesChannelThreadId(client);
	if (!threadId) {
		throw new Error('No #challenges channel thread found');
	}

	const [{ count: memberCount, error: memberErr }, messages] = await Promise.all([
		client
			.from('prsn_chat_members')
			.select('user_id', { count: 'exact', head: true })
			.eq('thread_id', threadId),
		fetchAllThreadMessages(client, threadId)
	]);
	if (memberErr) throw memberErr;

	const { configs, submissions } = extractChallengeEvents(messages);
	const summaries = summarizeLatestChallengeConfigs(configs).filter((row) => {
		if (!opts.challengeId) return true;
		return String(row.challenge_id || '').trim() === opts.challengeId;
	});

	if (opts.challengeId && !summaries.length) {
		throw new Error(`No challenge found with id: ${opts.challengeId}`);
	}

	const nowMs = Date.now();
	const reactionMap = buildReactionsByMessageId(messages);

	const userIds = new Set();
	const creationIds = new Set();
	for (const summary of summaries) {
		const cid = String(summary.challenge_id || '').trim();
		const ranked = rankSubmissionsForExport(
			submissionsForChallenge(submissions, cid),
			reactionMap
		);
		for (const row of ranked) {
			if (row.senderId != null) userIds.add(Number(row.senderId));
			if (row.creationId != null) creationIds.add(row.creationId);
			for (const vote of extractVotesFromReactions(row.reactions)) {
				userIds.add(vote.user_id);
			}
		}
		for (const row of configHistoryForChallenge(configs, cid)) {
			if (row.sender_id != null) userIds.add(row.sender_id);
		}
	}

	const [profileMap, creationMap] = await Promise.all([
		fetchUserProfiles(client, [...userIds]),
		fetchCreations(client, [...creationIds])
	]);

	const challenges = sortChallenges(
		summaries.map((summary) =>
			buildChallengeRecord({
				summary,
				configEntries: configs,
				submissions,
				messages,
				profileMap,
				creationMap,
				nowMs,
				channelMemberCount: memberCount ?? null
			})
		)
	);

	const exportDoc = {
		export_meta: {
			exported_at: new Date().toISOString(),
			script: 'scripts/analytics/challenge-participation-export.js',
			format: opts.format,
			messages_scanned: messages.length,
			config_message_count: configs.length,
			submission_message_count: submissions.length,
			challenge_count: challenges.length
		},
		channel: {
			thread_id: threadId,
			slug: 'challenges',
			member_count: memberCount ?? null
		},
		challenges
	};

	const output = opts.format === 'md' ? renderMarkdown(exportDoc) : `${JSON.stringify(exportDoc, null, 2)}\n`;
	const outPath = resolveOutputPath(opts);

	await fs.mkdir(path.dirname(outPath), { recursive: true });
	await fs.writeFile(outPath, output, 'utf8');
	console.log(`wrote ${outPath}`);
}

main().catch((err) => {
	console.error(err?.message || err);
	process.exit(1);
});
