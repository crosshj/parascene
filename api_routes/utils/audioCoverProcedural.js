import sharp from "sharp";

export const AUDIO_COVER_SIZE = 1024;
export const AUDIO_COVER_LAYOUTS = ["bloom"];
export const BLOOM_VIEW = 100;
export const BLOOM_PAD = 40;
export const BLOOM_FULL = BLOOM_VIEW + BLOOM_PAD * 2;
export const BLOOM_RENDER_SIZE = 512;

export const AUDIO_COVER_PALETTE = {
	bg: "#0f0d1a",
	green: "#05c76f",
	purple: "#7c3aed",
	amber: "#f59e0b",
	cyan: "#22d3ee",
	rose: "#f43f5e",
	blue: "#3b82f6",
	ink: "#ede9fe",
};

export const BLOOM_COLOR_MIN = 2;
export const BLOOM_COLOR_MAX = 5;

export const AUDIO_COVER_ACCENTS = [
	AUDIO_COVER_PALETTE.green,
	AUDIO_COVER_PALETTE.purple,
	AUDIO_COVER_PALETTE.amber,
	AUDIO_COVER_PALETTE.cyan,
	AUDIO_COVER_PALETTE.rose,
	AUDIO_COVER_PALETTE.blue,
];

const ACCENTS = AUDIO_COVER_ACCENTS;

export function hashAudioCoverSeed(value) {
	const s = String(value ?? "");
	let h = 2166136261;
	for (let i = 0; i < s.length; i += 1) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

export function createAudioCoverRng(seed) {
	let a = hashAudioCoverSeed(seed);
	return function next() {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function resolveAudioCoverKind(kindOrMethod) {
	const raw = String(kindOrMethod || "").trim().toLowerCase();
	if (raw === "speech" || raw.includes("speech") || raw.includes("tts") || raw.includes("voice")) {
		return "speech";
	}
	return "music";
}

export function pickAudioCoverLayout() {
	return "bloom";
}

export function seedAudioCover({ creationId, userId, title, prompt, extra } = {}) {
	return [userId ?? "", creationId ?? "", title ?? "", prompt ?? "", extra ?? ""].join(":");
}

export function monogramFromTitle(title) {
	const s = String(title || "").trim();
	if (!s) return "";
	const letter = s.match(/[A-Za-z]/);
	return letter ? letter[0].toUpperCase() : "";
}

function shuffleCopy(list, rng) {
	const next = list.slice();
	for (let i = next.length - 1; i > 0; i -= 1) {
		const j = Math.floor(rng() * (i + 1));
		[next[i], next[j]] = [next[j], next[i]];
	}
	return next;
}

/** How many accents this cover gets. 2–5 are equally likely. */
export function pickBloomColorCount(rng) {
	return BLOOM_COLOR_MIN + Math.floor(rng() * (BLOOM_COLOR_MAX - BLOOM_COLOR_MIN + 1));
}

export function pickBloomPalette(rng) {
	const count = pickBloomColorCount(rng);
	return { colors: pickContrastingColors(ACCENTS, count, rng) };
}

export function pickBloomColors(rng) {
	return pickBloomPalette(rng).colors;
}

export function pickGlassTint(rng, bloomColors = []) {
	const used = new Set(bloomColors);
	const leftover = ACCENTS.filter((hex) => !used.has(hex));
	const pool = leftover.length ? leftover : ACCENTS;
	return pool[Math.floor(rng() * pool.length)];
}

export function pickBloomGravity(rng) {
	const mode = rng() < 0.5 ? "cluster" : "fill";
	if (mode === "fill") {
		return { mode, cx: 50, cy: 50, spread: 46 };
	}
	const anchors = [
		[18, 18], [82, 18], [18, 82], [82, 82],
		[50, 16], [50, 84], [16, 50], [84, 50],
	];
	const [ax, ay] = anchors[Math.floor(rng() * anchors.length)];
	return {
		mode,
		cx: ax + (rng() - 0.5) * 10,
		cy: ay + (rng() - 0.5) * 10,
		spread: 16 + rng() * 12,
	};
}

export function audioCoverColorName(hex) {
	return Object.keys(AUDIO_COVER_PALETTE).find((key) => AUDIO_COVER_PALETTE[key] === hex) || hex;
}

function hexToRgb(hex) {
	const h = hex.replace("#", "");
	return {
		r: parseInt(h.slice(0, 2), 16),
		g: parseInt(h.slice(2, 4), 16),
		b: parseInt(h.slice(4, 6), 16),
	};
}

function srgbToLinear(channel) {
	const c = channel / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function hexToLab(hex) {
	const { r, g, b } = hexToRgb(hex);
	const rl = srgbToLinear(r);
	const gl = srgbToLinear(g);
	const bl = srgbToLinear(b);
	const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
	const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
	const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
	const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
	const fx = f(x / 0.95047);
	const fy = f(y);
	const fz = f(z / 1.08883);
	return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function colorDeltaE(a, b) {
	const la = hexToLab(a);
	const lb = hexToLab(b);
	return Math.hypot(la.L - lb.L, la.a - lb.a, la.b - lb.b);
}

export function minBloomContrast(colors) {
	let min = Infinity;
	for (let i = 0; i < colors.length; i += 1) {
		for (let j = i + 1; j < colors.length; j += 1) {
			min = Math.min(min, colorDeltaE(colors[i], colors[j]));
		}
	}
	return min === Infinity ? 0 : min;
}

export const MIN_BLOOM_DELTA_E = 68;

function combinations(list, k) {
	const out = [];
	const walk = (start, acc) => {
		if (acc.length === k) {
			out.push(acc);
			return;
		}
		for (let i = start; i < list.length; i += 1) walk(i + 1, [...acc, list[i]]);
	};
	walk(0, []);
	return out;
}

export function pickContrastingColors(pool, count, rng) {
	const n = Math.max(1, Math.min(count, pool.length));
	if (n === 1) return pool.slice(0, 1);
	const scored = combinations(pool, n).map((colors) => ({
		colors,
		minD: minBloomContrast(colors),
	}));
	const good = scored.filter((item) => item.minD >= MIN_BLOOM_DELTA_E);
	const ranked = (good.length ? good : scored).slice().sort((a, b) => b.minD - a.minD);
	const poolN = good.length ? ranked.length : Math.max(1, Math.ceil(ranked.length * 0.3));
	const pick = ranked[Math.floor(rng() * poolN)];
	return shuffleCopy(pick.colors, rng);
}

function mix(hex, toward, amount) {
	const a = hexToRgb(hex);
	const b = hexToRgb(toward);
	const t = Math.max(0, Math.min(1, amount));
	const to = (n) => Math.round(n).toString(16).padStart(2, "0");
	return `#${to(a.r + (b.r - a.r) * t)}${to(a.g + (b.g - a.g) * t)}${to(a.b + (b.b - a.b) * t)}`;
}

function withAlpha(hex, alpha) {
	const { r, g, b } = hexToRgb(hex);
	return `rgba(${r},${g},${b},${alpha})`;
}

function layoutBloom(colors, rng, gravity) {
	const g = gravity ?? pickBloomGravity(rng);
	const count = Math.max(2, colors.length);
	const orbs = [];
	const defs = [
		`<filter id="bloomSoft" x="-90%" y="-90%" width="280%" height="280%">
			<feGaussianBlur stdDeviation="10" />
		</filter>`,
	];
	for (let i = 0; i < count; i += 1) {
		const color = colors[i % colors.length];
		const tint = colors.length === 1 && i > 0 ? mix(color, AUDIO_COVER_PALETTE.ink, 0.16) : color;
		let cx;
		let cy;
		let r;
		if (g.mode === "cluster") {
			const ang = rng() * Math.PI * 2;
			const dist = (rng() ** 0.7) * g.spread;
			cx = g.cx + Math.cos(ang) * dist;
			cy = g.cy + Math.sin(ang) * dist;
			r = 42 + rng() * 30;
		} else {
			cx = 8 + rng() * 84;
			cy = 8 + rng() * 84;
			r = 56 + rng() * 36;
		}
		defs.push(`<radialGradient id="bloom${i}" cx="50%" cy="50%" r="50%">
			<stop offset="0%" stop-color="${withAlpha(tint, 0.95)}" />
			<stop offset="18%" stop-color="${withAlpha(tint, 0.5)}" />
			<stop offset="100%" stop-color="${withAlpha(tint, 0)}" />
		</radialGradient>`);
		orbs.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="url(#bloom${i})" />`);
	}
	return {
		defs: defs.join(""),
		body: `<g filter="url(#bloomSoft)">${orbs.join("")}</g>`,
	};
}

export function buildProceduralAudioCoverSvg({
	seed,
	kind = "music",
	layout,
} = {}) {
	const resolvedKind = resolveAudioCoverKind(kind);
	const resolvedLayout = AUDIO_COVER_LAYOUTS.includes(layout) ? layout : pickAudioCoverLayout();
	const rng = createAudioCoverRng(`${seed}:${resolvedLayout}:${resolvedKind}`);
	const palette = pickBloomPalette(rng);
	const colors = palette.colors;
	const gravity = pickBloomGravity(rng);
	const piece = layoutBloom(colors, rng, gravity);

	return {
		seed,
		layout: resolvedLayout,
		kind: resolvedKind,
		colorCount: colors.length,
		colors,
		gravity: gravity.mode,
		svg: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(BLOOM_RENDER_SIZE * BLOOM_FULL / BLOOM_VIEW)}" height="${Math.round(BLOOM_RENDER_SIZE * BLOOM_FULL / BLOOM_VIEW)}" viewBox="-${BLOOM_PAD} -${BLOOM_PAD} ${BLOOM_FULL} ${BLOOM_FULL}">
	<defs>${piece.defs}</defs>
	<rect x="-${BLOOM_PAD}" y="-${BLOOM_PAD}" width="${BLOOM_FULL}" height="${BLOOM_FULL}" fill="${AUDIO_COVER_PALETTE.bg}" />
	${piece.body}
</svg>`,
	};
}

export const GLASS_SHAPES = [
	"circle",
	"ellipse",
	"triangle",
	"square",
	"rectangle",
	"diamond",
	"pentagon",
	"hexagon",
];

function regularPolygon(cx, cy, radius, sides, rotation) {
	const verts = [];
	for (let i = 0; i < sides; i += 1) {
		const a = rotation + (i * Math.PI * 2) / sides - Math.PI / 2;
		verts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
	}
	return verts;
}

function rectangleVerts(cx, cy, halfW, halfH, rotation) {
	const c = Math.cos(rotation);
	const s = Math.sin(rotation);
	return [
		[-halfW, -halfH],
		[halfW, -halfH],
		[halfW, halfH],
		[-halfW, halfH],
	].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

function glassShapeGeometry(facet, cx, cy) {
	const { shape, radius, rotation } = facet;
	if (shape === "circle") return { kind: "circle", radius };
	if (shape === "ellipse") {
		return { kind: "ellipse", rx: radius * 1.18, ry: radius * 0.7, rotation };
	}
	if (shape === "rectangle") {
		return { kind: "polygon", verts: rectangleVerts(cx, cy, radius * 1.08, radius * 0.62, rotation) };
	}
	const sides = shape === "triangle" ? 3
		: shape === "square" || shape === "diamond" ? 4
			: shape === "pentagon" ? 5
				: 6;
	const r = shape === "square" ? radius * 0.92 : radius;
	return { kind: "polygon", verts: regularPolygon(cx, cy, r, sides, rotation) };
}

function pointInPolygon(px, py, verts) {
	let inside = false;
	for (let i = 0, j = verts.length - 1; i < verts.length; j = i, i += 1) {
		const [xi, yi] = verts[i];
		const [xj, yj] = verts[j];
		if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

function rotateLocal(px, py, cx, cy, rotation) {
	const dx = px - cx;
	const dy = py - cy;
	const c = Math.cos(-rotation);
	const s = Math.sin(-rotation);
	return [dx * c - dy * s, dx * s + dy * c];
}

function pointInGlass(px, py, geometry, cx, cy) {
	if (geometry.kind === "circle") {
		return Math.hypot(px - cx, py - cy) <= geometry.radius;
	}
	if (geometry.kind === "ellipse") {
		const [lx, ly] = rotateLocal(px, py, cx, cy, geometry.rotation);
		return (lx * lx) / (geometry.rx * geometry.rx) + (ly * ly) / (geometry.ry * geometry.ry) <= 1;
	}
	return pointInPolygon(px, py, geometry.verts);
}

function distToSegment(px, py, ax, ay, bx, by) {
	const dx = bx - ax;
	const dy = by - ay;
	const len2 = dx * dx + dy * dy || 1;
	const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToPolygonEdge(px, py, verts) {
	let min = Infinity;
	for (let i = 0; i < verts.length; i += 1) {
		const [ax, ay] = verts[i];
		const [bx, by] = verts[(i + 1) % verts.length];
		min = Math.min(min, distToSegment(px, py, ax, ay, bx, by));
	}
	return min;
}

function distToGlassEdge(px, py, geometry, cx, cy) {
	if (geometry.kind === "circle") {
		return geometry.radius - Math.hypot(px - cx, py - cy);
	}
	if (geometry.kind === "ellipse") {
		const [lx, ly] = rotateLocal(px, py, cx, cy, geometry.rotation);
		const n = Math.hypot(lx / geometry.rx, ly / geometry.ry);
		return Math.abs(1 - n) * Math.min(geometry.rx, geometry.ry);
	}
	return distToPolygonEdge(px, py, geometry.verts);
}

function sampleBilinear(data, w, h, x, y) {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = x - x0;
	const fy = y - y0;
	const pixel = (ix, iy) => {
		const cx = ix < 0 ? 0 : ix >= w ? w - 1 : ix;
		const cy = iy < 0 ? 0 : iy >= h ? h - 1 : iy;
		const i = (cy * w + cx) * 4;
		return [data[i], data[i + 1], data[i + 2]];
	};
	const c00 = pixel(x0, y0);
	const c10 = pixel(x0 + 1, y0);
	const c01 = pixel(x0, y0 + 1);
	const c11 = pixel(x0 + 1, y0 + 1);
	const mixc = (a, b, t) => a + (b - a) * t;
	return [
		mixc(mixc(c00[0], c10[0], fx), mixc(c01[0], c11[0], fx), fy),
		mixc(mixc(c00[1], c10[1], fx), mixc(c01[1], c11[1], fx), fy),
		mixc(mixc(c00[2], c10[2], fx), mixc(c01[2], c11[2], fx), fy),
	];
}

export const DETAIL_CHANCE = 0.65;
export const DETAIL_KINDS = [
	"glitter",
	"confetti",
	"sines",
	"fringe",
	"filaments",
	"rings",
	"fracture",
];

export function pickCoverDetail(rng) {
	if (rng() >= DETAIL_CHANCE) return null;
	return DETAIL_KINDS[Math.floor(rng() * DETAIL_KINDS.length)];
}

function leftoverAccents(bloomColors = []) {
	const used = new Set(bloomColors);
	const leftover = ACCENTS.filter((hex) => !used.has(hex));
	return leftover.length ? leftover : ACCENTS;
}

function detailSvgShell(size, body) {
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">
	${body}
</svg>`;
}

function buildGlitterSvg(rng, size, colors) {
	const extras = leftoverAccents(colors);
	const cx = rng() * size;
	const cy = rng() * size;
	const radius = size * (0.11 + rng() * 0.09);
	const count = 42 + Math.floor(rng() * 36);
	const dots = [];
	for (let i = 0; i < count; i += 1) {
		const a = rng() * Math.PI * 2;
		const d = (rng() ** 0.55) * radius;
		const x = cx + Math.cos(a) * d;
		const y = cy + Math.sin(a) * d;
		const fill = rng() < 0.62 ? AUDIO_COVER_PALETTE.ink : extras[Math.floor(rng() * extras.length)];
		const op = (0.38 + rng() * 0.32).toFixed(2);
		dots.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="1" height="1" fill="${fill}" opacity="${op}" />`);
	}
	return detailSvgShell(size, dots.join(""));
}

function buildConfettiSvg(rng, size, colors) {
	const extras = leftoverAccents(colors);
	const palette = extras.concat(AUDIO_COVER_PALETTE.ink);
	const cx = rng() * size;
	const cy = rng() * size;
	const spread = size * (0.08 + rng() * 0.06);
	const count = 11 + Math.floor(rng() * 8);
	const bits = [];
	for (let i = 0; i < count; i += 1) {
		const x = cx + (rng() - 0.5) * spread * 2;
		const y = cy + (rng() - 0.5) * spread * 2;
		const w = 3 + rng() * 4;
		const h = 1.4 + rng() * 2.2;
		const rot = (rng() * 360).toFixed(1);
		const fill = palette[Math.floor(rng() * palette.length)];
		const op = (0.4 + rng() * 0.18).toFixed(2);
		bits.push(`<rect x="${(x - w / 2).toFixed(1)}" y="${(y - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" opacity="${op}" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})" />`);
	}
	return detailSvgShell(size, bits.join(""));
}

function buildSinesSvg(rng, size) {
	const n = 3 + Math.floor(rng() * 3);
	const amp = 9 + rng() * 12;
	const wave = 90 + rng() * 70;
	const gap = 13 + rng() * 9;
	const rot = rng() * 180;
	const startY = -((n - 1) * gap) / 2;
	const paths = [];
	for (let i = 0; i < n; i += 1) {
		const y0 = startY + i * gap;
		const pts = [];
		for (let x = -size * 0.62; x <= size * 0.62; x += 3) {
			const y = y0 + Math.sin((x / wave) * Math.PI * 2) * amp;
			pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
		}
		paths.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="rgba(237,233,254,0.3)" stroke-width="1" stroke-linejoin="round" />`);
	}
	return detailSvgShell(size, `<g transform="translate(${(size / 2).toFixed(1)} ${(size / 2).toFixed(1)}) rotate(${rot.toFixed(1)})">${paths.join("")}</g>`);
}

function buildFilamentsSvg(rng, size) {
	const n = 1 + Math.floor(rng() * 2);
	const paths = [];
	for (let i = 0; i < n; i += 1) {
		const x1 = rng() * size;
		const y1 = rng() * size;
		const x2 = rng() * size;
		const y2 = rng() * size;
		const c1x = rng() * size;
		const c1y = rng() * size;
		const c2x = rng() * size;
		const c2y = rng() * size;
		paths.push(`<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="rgba(237,233,254,0.3)" stroke-width="1" />`);
	}
	return detailSvgShell(size, paths.join(""));
}

function buildRingsSvg(rng, size) {
	const cx = rng() * size;
	const cy = rng() * size;
	const n = 3 + Math.floor(rng() * 2);
	const r0 = size * (0.07 + rng() * 0.1);
	const step = 16 + rng() * 12;
	const rings = [];
	for (let i = 0; i < n; i += 1) {
		rings.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r0 + i * step).toFixed(1)}" fill="none" stroke="rgba(237,233,254,0.22)" stroke-width="1" />`);
	}
	return detailSvgShell(size, rings.join(""));
}

function buildFractureSvg(rng, size) {
	const fromLeft = rng() < 0.5;
	let x = fromLeft ? 0 : size;
	let y = size * (0.18 + rng() * 0.64);
	const tx = fromLeft ? size : 0;
	const ty = size * (0.18 + rng() * 0.64);
	const steps = 8 + Math.floor(rng() * 5);
	const pts = [`${x.toFixed(1)},${y.toFixed(1)}`];
	for (let i = 1; i <= steps; i += 1) {
		const t = i / steps;
		x = x + (tx - x) * (1 / (steps - i + 1)) + (rng() - 0.5) * size * 0.06;
		y = y + (ty - y) * (1 / (steps - i + 1)) + (rng() - 0.5) * size * 0.08;
		pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
	}
	return detailSvgShell(size, `<polyline points="${pts.join(" ")}" fill="none" stroke="rgba(237,233,254,0.34)" stroke-width="1" stroke-linejoin="miter" />`);
}

async function applyChromaticFringe(png, geometry, cx, cy, size) {
	const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	const out = Buffer.from(data);
	const w = info.width;
	const h = info.height;
	for (let y = 0; y < h; y += 1) {
		for (let x = 0; x < w; x += 1) {
			const px = x + 0.5;
			const py = y + 0.5;
			if (!pointInGlass(px, py, geometry, cx, cy)) continue;
			if (distToGlassEdge(px, py, geometry, cx, cy) > 1.35) continue;
			const r = sampleBilinear(data, w, h, x + 2, y);
			const b = sampleBilinear(data, w, h, x - 2, y);
			const i = (y * w + x) * 4;
			out[i] = r[0];
			out[i + 2] = b[2];
		}
	}
	return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

export async function applyCoverDetail(png, { kind, rng, size, colors = [], geometry, facet }) {
	if (!kind) return png;
	if (kind === "fringe" && geometry && facet) {
		return applyChromaticFringe(png, geometry, facet.cx, facet.cy, size);
	}
	const svg = kind === "glitter" ? buildGlitterSvg(rng, size, colors)
		: kind === "confetti" ? buildConfettiSvg(rng, size, colors)
			: kind === "sines" ? buildSinesSvg(rng, size)
				: kind === "filaments" ? buildFilamentsSvg(rng, size)
					: kind === "rings" ? buildRingsSvg(rng, size)
						: kind === "fracture" ? buildFractureSvg(rng, size)
							: null;
	if (!svg) return png;
	const overlay = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
	return sharp(png).composite([{ input: overlay, blend: "over" }]).png().toBuffer();
}

export function pickGlassFacet(rng, size) {
	const shape = GLASS_SHAPES[Math.floor(rng() * GLASS_SHAPES.length)];
	const wobble = (rng() - 0.5) * 0.22;
	let rotation = 0;
	if (shape === "triangle" || shape === "pentagon" || shape === "hexagon" || shape === "ellipse") {
		rotation = rng() * Math.PI * 2;
	} else if (shape === "diamond") {
		rotation = Math.PI / 4 + wobble;
	} else if (shape === "square" || shape === "rectangle") {
		rotation = wobble;
	}
	const angle = rng() * Math.PI * 2;
	const offsetAmt = size * (rng() ** 0.8) * 0.44;
	return {
		shape,
		rotation,
		cx: size / 2 + Math.cos(angle) * offsetAmt,
		cy: size / 2 + Math.sin(angle) * offsetAmt,
		radius: size * (0.56 + rng() * 0.24),
		magnify: 1.16 + rng() * 0.1,
		chroma: 5 + rng() * 5,
	};
}

function tintSample(value, tintValue, amount) {
	return value * (1 - amount + amount * (tintValue / 255));
}

export async function applyGlassFacet(bloomPng, { seed, size, kind, layout, bloomColors = [] }) {
	const rng = createAudioCoverRng(`${seed}:${layout}:${kind}:glass`);
	const facet = pickGlassFacet(rng, size);
	const tintHex = pickGlassTint(rng, bloomColors);
	const tint = hexToRgb(tintHex);
	const tintAmt = 0.16 + rng() * 0.08;
	const cx = facet.cx;
	const cy = facet.cy;
	const geometry = glassShapeGeometry(facet, cx, cy);
	const { data, info } = await sharp(bloomPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	const out = Buffer.from(data);
	const w = info.width;
	const h = info.height;
	const edgeFalloff = size * 0.045;
	const bend = 10 + facet.chroma * 0.4;

	for (let y = 0; y < h; y += 1) {
		for (let x = 0; x < w; x += 1) {
			const px = x + 0.5;
			const py = y + 0.5;
			if (!pointInGlass(px, py, geometry, cx, cy)) continue;
			const dx = px - cx;
			const dy = py - cy;
			const sx = cx + dx / facet.magnify;
			const sy = cy + dy / facet.magnify;
			const edge = distToGlassEdge(px, py, geometry, cx, cy);
			const near = Math.max(0, 1 - edge / edgeFalloff);
			const nlen = Math.hypot(dx, dy) || 1;
			const ox = (-dy / nlen) * bend * near;
			const oy = (dx / nlen) * bend * near;
			const chroma = facet.chroma * (0.45 + near * 0.55);
			const r = sampleBilinear(data, w, h, sx + ox + chroma * 0.45, sy + oy);
			const g = sampleBilinear(data, w, h, sx + ox, sy + oy);
			const b = sampleBilinear(data, w, h, sx + ox - chroma * 0.45, sy + oy);
			const i = (y * w + x) * 4;
			out[i] = tintSample(r[0], tint.r, tintAmt);
			out[i + 1] = tintSample(g[1], tint.g, tintAmt);
			out[i + 2] = tintSample(b[2], tint.b, tintAmt);
		}
	}

	const buffer = await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
	return {
		buffer,
		shape: facet.shape,
		tint: tintHex,
		geometry,
		facet,
	};
}

export async function buildProceduralAudioCoverBuffer(opts = {}) {
	const { svg, layout, kind, colorCount, colors, gravity, seed } = buildProceduralAudioCoverSvg(opts);
	const size = AUDIO_COVER_SIZE;
	const render = BLOOM_RENDER_SIZE;
	const fullSize = Math.round(render * BLOOM_FULL / BLOOM_VIEW);
	const inset = Math.round((fullSize - render) / 2);
	const bloomSmall = await sharp(Buffer.from(svg))
		.resize(fullSize, fullSize)
		.blur(Math.max(1, Math.round(16 * render / size)))
		.extract({ left: inset, top: inset, width: render, height: render })
		.png()
		.toBuffer();
	const bloom = await sharp(bloomSmall).resize(size, size).png().toBuffer();
	const resolvedSeed = seed ?? opts.seed ?? "";
	const glass = await applyGlassFacet(bloom, {
		seed: resolvedSeed,
		size,
		kind,
		layout,
		bloomColors: colors,
	});
	const detailRng = createAudioCoverRng(`${resolvedSeed}:${layout}:${kind}:detail`);
	const detailKind = pickCoverDetail(detailRng);
	const buffer = await applyCoverDetail(glass.buffer, {
		kind: detailKind,
		rng: detailRng,
		size,
		colors,
		geometry: glass.geometry,
		facet: glass.facet,
	});
	return {
		buffer,
		width: size,
		height: size,
		layout,
		kind,
		colorCount,
		colors,
		gravity,
		glassShape: glass.shape,
		glassTint: glass.tint,
		detail: detailKind,
	};
}
