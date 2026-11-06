#!/usr/bin/env node
/**
 * Rebuild shared feed beta catalog snapshot in Redis (same job as QStash schedule).
 *
 *   node scripts/analytics/feed-beta-catalog-rebuild.js
 */
import 'dotenv/config';
import { openDb } from '../../db/index.js';
import { runFeedBetaCatalogRebuild } from '../../api_routes/feedBeta/catalogRebuild.js';

async function main() {
	const { queries } = await openDb();
	const out = await runFeedBetaCatalogRebuild({ queries });
	console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
	console.error('[feed-beta-catalog-rebuild]', err?.message || err);
	process.exit(1);
});
