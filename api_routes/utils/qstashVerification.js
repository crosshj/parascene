import { Receiver } from "@upstash/qstash";

let receiverInstance = null;

function logCreation(...args) {
	console.log("[Creation]", ...args);
}

function logCreationError(...args) {
	console.error("[Creation]", ...args);
}

function getReceiver() {
	if (!receiverInstance) {
		const currentSigningKey = process.env.UPSTASH_QSTASH_CURRENT_SIGNING_KEY;
		const nextSigningKey = process.env.UPSTASH_QSTASH_NEXT_SIGNING_KEY;

		if (!currentSigningKey && !nextSigningKey) {
			logCreationError("QStash receiver: No signing keys configured");
			return null;
		}

		logCreation("Initializing QStash receiver", {
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
		logCreationError("QStash verification failed: No receiver instance", {
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
		logCreationError("QStash verification failed: No signature header", {
			has_upstash_header: !!upstashHeader,
			has_lowercase_header: !!lowercaseHeader,
		});
		return false;
	}

	// Use raw body when set (e.g. cron route mounted with express.raw()); otherwise Upstash verification fails for empty body (signed as "" but we'd pass "{}").
	const body =
		req.rawBodyForVerify !== undefined
			? req.rawBodyForVerify
			: typeof req.body === "string"
				? req.body
				: req.body != null
					? JSON.stringify(req.body)
					: "";
	const path = req.originalUrl || req.url || "/api/worker/create";

	logCreation("Verifying QStash signature", {
		path,
		has_body: !!body,
		body_length: body?.length || 0,
		signature_length: signature?.length || 0,
	});

	try {
		await receiver.verify({
			body,
			signature,
		});
		logCreation("QStash signature verified successfully");
		return true;
	} catch (err) {
		logCreationError("QStash signature verification failed", {
			error: err.message,
			error_type: err.constructor.name,
			path,
		});
		return false;
	}
}
