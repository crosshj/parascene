import { Receiver } from "@upstash/qstash";

let receiverInstance = null;

function logQStash(...args) {
	console.log("[QStash]", ...args);
}

function logQStashError(...args) {
	console.error("[QStash]", ...args);
}

function getReceiver() {
	if (!receiverInstance) {
		const currentSigningKey = process.env.UPSTASH_QSTASH_CURRENT_SIGNING_KEY;
		const nextSigningKey = process.env.UPSTASH_QSTASH_NEXT_SIGNING_KEY;

		if (!currentSigningKey && !nextSigningKey) {
			logQStashError("QStash receiver: No signing keys configured");
			return null;
		}

		logQStash("Initializing QStash receiver", {
			has_current_key: !!currentSigningKey,
			has_next_key: !!nextSigningKey
		});

		const receiverConfig = {};
		if (currentSigningKey) {
			receiverConfig.currentSigningKey = currentSigningKey;
		}
		if (nextSigningKey) {
			receiverConfig.nextSigningKey = nextSigningKey;
		}

		receiverInstance = new Receiver(receiverConfig);
	}
	return receiverInstance;
}
export async function verifyQStashRequest(req) {
	const receiver = getReceiver();
	if (!receiver) {
		// Most common cause: signing keys not configured in the environment
		logQStashError("QStash verification failed: No receiver instance", {
			has_current_key_env: !!process.env.UPSTASH_QSTASH_CURRENT_SIGNING_KEY,
			has_next_key_env: !!process.env.UPSTASH_QSTASH_NEXT_SIGNING_KEY,
		});
		return false;
	}

	// Support both Express req objects (with .get()) and Vercel native req objects (with headers object)
	const headers = req.headers || {};
	const upstashHeader = req.get ? req.get("Upstash-Signature") : headers["Upstash-Signature"];
	const lowercaseHeader = req.get ? req.get("upstash-signature") : headers["upstash-signature"];
	const signature = upstashHeader || lowercaseHeader;
	if (!signature) {
		logQStashError("QStash verification failed: No signature header", {
			has_upstash_header: !!upstashHeader,
			has_lowercase_header: !!lowercaseHeader,
		});
		return false;
	}

	// QStash signs the raw request body. Vercel/serverless often parses an empty POST as {}.
	// Schedules configured with body: {} send the literal "{}" — try both when parsed body is empty.
	const bodyCandidates = getBodyCandidatesForVerify(req);
	const path = req.originalUrl || req.url || "/api/worker/create";

	logQStash("Verifying QStash signature", {
		path,
		body_candidates: bodyCandidates.length,
		body_lengths: bodyCandidates.map((b) => b?.length || 0),
		signature_length: signature?.length || 0,
	});

	for (const body of bodyCandidates) {
		try {
			await receiver.verify({
				body,
				signature,
			});
			logQStash("QStash signature verified successfully", { body_length: body?.length || 0 });
			return true;
		} catch (err) {
			logQStash("QStash signature attempt failed", {
				body_length: body?.length || 0,
				error: err.message,
			});
		}
	}

	logQStashError("QStash signature verification failed", { path, body_candidates: bodyCandidates.length });
	return false;
}

/** @returns {string[]} Raw body string(s) to try for signature verification (newest schedules omit body → ""). */
function getBodyCandidatesForVerify(req) {
	if (req.rawBodyForVerify !== undefined) {
		return [req.rawBodyForVerify];
	}
	if (typeof req.body === "string") {
		return [req.body];
	}
	if (req.body == null) {
		return [""];
	}
	if (typeof req.body === "object") {
		const keys = Object.keys(req.body);
		if (keys.length === 0) {
			return ["", "{}"];
		}
		return [JSON.stringify(req.body)];
	}
	return [String(req.body)];
}
