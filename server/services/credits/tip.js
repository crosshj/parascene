const DAY_MS = 24 * 60 * 60 * 1000;

function fail(status, error, extra) {
	return { status, body: extra ? { error, ...extra } : { error } };
}

function balances(transferResult) {
	const fromBalance = typeof transferResult?.fromBalance === "number"
		? transferResult.fromBalance
		: typeof transferResult?.from_balance === "number"
			? transferResult.from_balance
			: null;
	const toBalance = typeof transferResult?.toBalance === "number"
		? transferResult.toBalance
		: typeof transferResult?.to_balance === "number"
			? transferResult.to_balance
			: null;
	return { fromBalance, toBalance };
}

export async function performCreditTip({
	sender,
	toUserId: rawToUserId,
	amount: rawAmount,
	createdImageId: rawCreatedImageId,
	message: rawMessage,
	findUser,
	findCreation,
	policyValue,
	transfer,
	recordTip,
	notify,
	now = Date.now
}) {
	const fromUserId = Number(sender?.id);
	const toUserId = Number(rawToUserId);
	const amount = Math.round(Number(rawAmount) * 10) / 10;
	const createdImageId = rawCreatedImageId != null ? Number(rawCreatedImageId) : null;
	const message = typeof rawMessage === "string" ? rawMessage.trim() : "";

	if (!Number.isFinite(toUserId) || toUserId <= 0) return fail(400, "Invalid recipient user id");
	if (!Number.isFinite(amount) || amount <= 0) return fail(400, "Invalid amount");
	if (toUserId === fromUserId) return fail(400, "Cannot tip yourself");
	if (message && message.length > 500) return fail(400, "Message is too long");

	if (createdImageId !== null) {
		if (!Number.isFinite(createdImageId) || createdImageId <= 0) return fail(400, "Invalid creation id");
		const creation = await findCreation(createdImageId);
		if (!creation) return fail(404, "Creation not found");
	}

	const hasUpgradedPlan = sender?.meta?.plan === "founder"
		|| (sender?.meta?.stripeSubscriptionId != null && String(sender.meta.stripeSubscriptionId).trim() !== "");
	if (!hasUpgradedPlan) {
		const rawPolicy = await policyValue();
		const minDaysRaw = rawPolicy != null ? String(rawPolicy).trim() : "";
		const minDays = Math.max(0, parseInt(minDaysRaw, 10) || 60);
		let daysPresent = 0;
		if (sender?.created_at) {
			const createdMs = new Date(sender.created_at).getTime();
			if (Number.isFinite(createdMs)) daysPresent = (now() - createdMs) / DAY_MS;
		}
		if (minDays > 0 && daysPresent < minDays) {
			const daysRemaining = Math.max(0, Math.ceil(minDays - daysPresent));
			const daysWord = daysRemaining === 1 ? "day" : "days";
			const errorText = `You have ${daysRemaining} more ${daysWord} before you can tip. You can upgrade your account to tip now — see the pricing page.`;
			return fail(403, errorText, {
				errorHtml: errorText.replace("pricing page", '<a href="/pricing" class="tip-error-pricing-link">pricing</a> page')
			});
		}
	}

	const recipient = await findUser(toUserId);
	if (!recipient) return fail(404, "Recipient not found");

	let transferResult;
	try {
		transferResult = await transfer(fromUserId, toUserId, amount);
	} catch (error) {
		const detail = String(error?.message || "");
		const code = error?.code || "";
		if (code === "INSUFFICIENT_CREDITS" || detail.toLowerCase().includes("insufficient")) {
			return fail(400, "Insufficient credits");
		}
		if (detail.toLowerCase().includes("tip yourself")) return fail(400, "Cannot tip yourself");
		return fail(500, "Internal server error");
	}

	try {
		await recordTip(
			fromUserId,
			toUserId,
			createdImageId,
			amount,
			message || null,
			createdImageId != null ? "creation" : "admin",
			null
		);
	} catch {
		// The transfer already succeeded.
	}

	try {
		const title = "You received a tip";
		const notifMessage = `Someone tipped you ${amount.toFixed(1)} credits.`;
		const link = createdImageId != null ? `/creations/${encodeURIComponent(String(createdImageId))}` : "/";
		const target = createdImageId != null ? { creation_id: createdImageId } : {};
		const meta = { amount, ...(message ? { tip_note: message } : {}) };
		await notify(toUserId, null, title, notifMessage, link, sender.id, "tip", target, meta);
	} catch {
		// The transfer already succeeded.
	}

	return { status: 200, body: { success: true, ...balances(transferResult) } };
}
