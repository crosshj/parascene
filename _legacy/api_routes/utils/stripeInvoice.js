/**
 * Resolve the Stripe subscription id from an Invoice object.
 *
 * Older API versions expose `invoice.subscription` (string or expanded object).
 * API 2026-01-28.clover+ moves it to `invoice.parent.subscription_details.subscription`
 * (and line-item `parent.subscription_item_details.subscription`).
 *
 * @param {object | null | undefined} invoice
 * @returns {string | null}
 */
export function resolveInvoiceSubscriptionId(invoice) {
	if (!invoice || typeof invoice !== "object") return null;

	const top = invoice.subscription;
	if (typeof top === "string" && top.trim()) return top.trim();
	if (top && typeof top === "object" && typeof top.id === "string" && top.id.trim()) {
		return top.id.trim();
	}

	const fromParent = invoice.parent?.subscription_details?.subscription;
	if (typeof fromParent === "string" && fromParent.trim()) return fromParent.trim();
	if (fromParent && typeof fromParent === "object" && typeof fromParent.id === "string" && fromParent.id.trim()) {
		return fromParent.id.trim();
	}

	const lines = Array.isArray(invoice.lines?.data) ? invoice.lines.data : [];
	for (const line of lines) {
		const legacyLine = line?.subscription;
		if (typeof legacyLine === "string" && legacyLine.trim()) return legacyLine.trim();
		if (legacyLine && typeof legacyLine === "object" && typeof legacyLine.id === "string" && legacyLine.id.trim()) {
			return legacyLine.id.trim();
		}
		const fromLineParent =
			line?.parent?.subscription_item_details?.subscription ||
			line?.parent?.subscription_details?.subscription;
		if (typeof fromLineParent === "string" && fromLineParent.trim()) return fromLineParent.trim();
		if (
			fromLineParent &&
			typeof fromLineParent === "object" &&
			typeof fromLineParent.id === "string" &&
			fromLineParent.id.trim()
		) {
			return fromLineParent.id.trim();
		}
	}

	return null;
}
