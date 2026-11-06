/**
 * Unit-level behavior for the invoice-id claim list on user meta
 * (mirrors claimGrantedStripeInvoice / releaseGrantedStripeInvoice).
 */
function claimInvoiceIds(meta, invoiceId, max = 48) {
	const iid = typeof invoiceId === "string" ? invoiceId.trim() : "";
	if (!iid) return { granted: false, meta };
	const next = typeof meta === "object" && meta !== null ? { ...meta } : {};
	const list = Array.isArray(next.grantedStripeInvoiceIds)
		? next.grantedStripeInvoiceIds.map(String)
		: [];
	if (list.includes(iid)) return { granted: false, meta: next };
	next.grantedStripeInvoiceIds = [...list, iid].slice(-max);
	return { granted: true, meta: next };
}

function releaseInvoiceIds(meta, invoiceId) {
	const iid = typeof invoiceId === "string" ? invoiceId.trim() : "";
	if (!iid) return meta;
	const next = typeof meta === "object" && meta !== null ? { ...meta } : {};
	const list = Array.isArray(next.grantedStripeInvoiceIds)
		? next.grantedStripeInvoiceIds.map(String).filter((id) => id !== iid)
		: [];
	if (list.length) next.grantedStripeInvoiceIds = list;
	else delete next.grantedStripeInvoiceIds;
	return next;
}

describe("grantedStripeInvoiceIds meta claim/release", () => {
	it("claims a new invoice id once", () => {
		const first = claimInvoiceIds({}, "in_1");
		expect(first.granted).toBe(true);
		expect(first.meta.grantedStripeInvoiceIds).toEqual(["in_1"]);

		const second = claimInvoiceIds(first.meta, "in_1");
		expect(second.granted).toBe(false);
		expect(second.meta.grantedStripeInvoiceIds).toEqual(["in_1"]);
	});

	it("releases a claimed invoice so it can be retried", () => {
		const claimed = claimInvoiceIds({}, "in_retry");
		const released = releaseInvoiceIds(claimed.meta, "in_retry");
		expect(released.grantedStripeInvoiceIds).toBeUndefined();
		const again = claimInvoiceIds(released, "in_retry");
		expect(again.granted).toBe(true);
	});

	it("keeps a rolling window of invoice ids", () => {
		let meta = {};
		for (let i = 1; i <= 50; i += 1) {
			meta = claimInvoiceIds(meta, `in_${i}`, 48).meta;
		}
		expect(meta.grantedStripeInvoiceIds).toHaveLength(48);
		expect(meta.grantedStripeInvoiceIds[0]).toBe("in_3");
		expect(meta.grantedStripeInvoiceIds.at(-1)).toBe("in_50");
	});
});
