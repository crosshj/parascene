import test from "node:test";
import assert from "node:assert/strict";
import { startProcessSchedules } from "../server/services/schedule/processSchedules.js";

test("process schedules stay idle unless mode is timer", () => {
	const idle = startProcessSchedules({ client: {} });
	assert.equal(typeof idle, "function");
	idle();

	const stop = startProcessSchedules({ mode: "timer", client: {} });
	assert.equal(typeof stop, "function");
	stop();
});
