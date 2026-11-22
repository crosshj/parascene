/** One-time credit packs. The client sends a pack id. Credits and price stay here. */
export const CREDIT_TOPUP_PACKS = {
	"100": { id: "100", credits: 100, usd: 3, priceEnv: "STRIPE_PRICE_ID_TOPUP_100" },
	"300": { id: "300", credits: 300, usd: 7, priceEnv: "STRIPE_PRICE_ID_TOPUP_300" },
	"700": { id: "700", credits: 700, usd: 15, priceEnv: "STRIPE_PRICE_ID_TOPUP_700" }
};

export function getCreditTopupPack(packId) {
	return CREDIT_TOPUP_PACKS[String(packId || "").trim()] || null;
}

export function getCreditTopupPriceId(pack) {
	if (!pack?.priceEnv) return "";
	return String(process.env[pack.priceEnv] || "").trim();
}
