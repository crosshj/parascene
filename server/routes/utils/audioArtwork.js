import crypto from "node:crypto";

function escapeXml(value) {
	return String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function shortLabel(filename) {
	const label = String(filename || "Audio")
		.replace(/\.[^.]+$/, "")
		.replace(/[_-]+/g, " ")
		.trim() || "Audio";
	return label.length > 28 ? `${label.slice(0, 27).trim()}…` : label;
}

/** Return a deterministic, browser-safe artwork fallback as SVG. */
export function audioArtworkFallback(filename) {
	const name = String(filename || "Audio");
	const digest = crypto.createHash("sha256").update(name).digest();
	const hueA = digest[0] % 360;
	const hueB = (hueA + 55 + digest[1] % 80) % 360;
	const label = escapeXml(shortLabel(name));
	const bars = Array.from({ length: 24 }, (_, index) => {
		const height = 20 + (digest[(index + 2) % digest.length] % 64);
		const x = 44 + index * 22;
		const y = 256 - height / 2;
		return `<rect x="${x}" y="${y.toFixed(1)}" width="10" height="${height}" rx="5" />`;
	}).join("");
	return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hueA} 62% 30%)"/><stop offset="1" stop-color="hsl(${hueB} 68% 18%)"/></linearGradient></defs>
<rect width="640" height="640" fill="url(#g)"/><circle cx="520" cy="105" r="190" fill="rgba(255,255,255,.08)"/>
<g fill="rgba(255,255,255,.82)">${bars}</g><text x="44" y="560" fill="white" font-family="system-ui,sans-serif" font-size="34" font-weight="700">${label}</text>
</svg>`);
}
