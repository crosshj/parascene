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

	const upstashHeader = req.get("Upstash-Signature");
	const lowercaseHeader = req.get("upstash-signature");
	const signature = upstashHeader || lowercaseHeader;
	if (!signature) {
		logCreationError("QStash verification failed: No signature header", {
			has_upstash_header: !!upstashHeader,
			has_lowercase_header: !!lowercaseHeader,
		});
		return false;
	}

	const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

	logCreation("Verifying QStash signature", {
		path: req.originalUrl,
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
			path: req.originalUrl,
		});
		return false;
	}
}
