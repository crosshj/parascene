import { createVisitPulseQueries } from "../../db/visitPulse.js";
import { startWelcomeMailSchedule } from "../account/welcomeMail.js";
import { runVisitPulseFlush, startVisitPulseFlushSchedule } from "../feed/visitPulseFlush.js";

/**
 * Periodic clocks. QStash is the live driver and posts to the worker routes.
 * Pass mode "timer" to run the in-process schedules instead.
 */
export function startProcessSchedules({ mode = "qstash", client } = {}) {
	if (mode === "timer") {
		const stopPulse = startVisitPulseFlushSchedule({
			run: (args) => runVisitPulseFlush({ args, queries: createVisitPulseQueries(client) })
		});
		const stopMail = startWelcomeMailSchedule({ client });
		return () => {
			stopPulse?.();
			stopMail?.();
		};
	}
	return () => {};
}
