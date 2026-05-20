/**
 * Declarative QStash schedules (source of truth).
 * Apply with: node infra/qstash/sync.cjs
 *
 * destinationPath is appended to getQStashCallbackBaseUrl() (api.parascene.com in prod).
 * Upstash-Schedule-Id is stable — re-run sync to update cron/body in place.
 */

/** @typedef {{ id: string, label: string, destinationPath: string, cron: string, body?: object, method?: string }} QStashScheduleDef */

/** @type {QStashScheduleDef[]} */
const QSTASH_SCHEDULES = [
	{
		id: "parascene-notifications-cron",
		label: "Email digest / lifecycle cron",
		destinationPath: "/api/worker/notifications",
		cron: "0 * * * *",
		body: {},
		method: "POST"
	},
	{
		id: "parascene-visit-pulse-flush",
		label: "Visit pulse flush at US East EOD → yesterday US East partition in DB",
		destinationPath: "/api/worker/jobs",
		cron: "10 5 * * *",
		body: { job_type: "visit_pulse_flush", args: {} },
		method: "POST"
	}
];

module.exports = { QSTASH_SCHEDULES };
