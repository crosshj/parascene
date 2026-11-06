import { resolveInvoiceSubscriptionId } from "../api_routes/utils/stripeInvoice.js";

describe("resolveInvoiceSubscriptionId", () => {
	it("reads legacy invoice.subscription string", () => {
		expect(resolveInvoiceSubscriptionId({ subscription: "sub_legacy" })).toBe("sub_legacy");
	});

	it("reads legacy expanded invoice.subscription object", () => {
		expect(resolveInvoiceSubscriptionId({ subscription: { id: "sub_obj" } })).toBe("sub_obj");
	});

	it("reads parent.subscription_details.subscription (Stripe API 2026+)", () => {
		expect(
			resolveInvoiceSubscriptionId({
				subscription: null,
				parent: {
					type: "subscription_details",
					subscription_details: { subscription: "sub_1UIHI2DHBvxoc5wCWt6KmF49" }
				}
			})
		).toBe("sub_1UIHI2DHBvxoc5wCWt6KmF49");
	});

	it("falls back to line-item subscription_item_details", () => {
		expect(
			resolveInvoiceSubscriptionId({
				subscription: null,
				parent: null,
				lines: {
					data: [
						{
							parent: {
								type: "subscription_item_details",
								subscription_item_details: {
									subscription: "sub_from_line",
									subscription_item: "si_x"
								}
							}
						}
					]
				}
			})
		).toBe("sub_from_line");
	});

	it("returns null when no subscription can be found", () => {
		expect(resolveInvoiceSubscriptionId({})).toBeNull();
		expect(resolveInvoiceSubscriptionId(null)).toBeNull();
	});
});
