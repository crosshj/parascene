/**
 * Local gallery of procedural audio covers.
 * Run from repo root: node scripts/preview-audio-covers.js
 * Output is gitignored: _preview/audio-covers/
 */

import { mkdir, readdir, unlink, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
	AUDIO_COVER_LAYOUTS,
	audioCoverColorName,
	buildProceduralAudioCoverBuffer,
} from "../api_routes/utils/audioCoverProcedural.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "_preview", "audio-covers");

const SEEDS = [
	"1:101:aurora",
	"1:202:night bus",
	"3:303:glass",
	"8:404:ember",
	"12:505:harbor",
	"19:606:violet static",
	"27:707:low tide",
	"41:808:signal",
];

const TITLED = [
	{ seed: "9:900:North", title: "North Star", kind: "music", layout: "bloom" },
	{ seed: "9:901:Echo", title: "Echo", kind: "speech", layout: "bloom" },
	{ seed: "9:902:Kite", title: "Kite Song", kind: "music", layout: "bloom" },
	{ seed: "9:903:Voice", title: "Voice Note", kind: "speech", layout: "bloom" },
];

function caption(t) {
	return `${t.layout} · ${t.kind} · ${t.gravity} · ${t.glassShape} · ${audioCoverColorName(t.glassTint)} tint · ${t.detail || "plain"} · ${t.colorCount} color${t.colorCount === 1 ? "" : "s"}`;
}

function slug(parts) {
	return parts
		.map((p) => String(p).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
		.filter(Boolean)
		.join("__");
}

const tiles = [];

await mkdir(OUT_DIR, { recursive: true });
for (const name of await readdir(OUT_DIR)) {
	if (name.endsWith(".png") || name === "index.html") {
		await unlink(join(OUT_DIR, name));
	}
}

for (const layout of AUDIO_COVER_LAYOUTS) {
	for (const kind of ["music", "speech"]) {
		for (const seed of SEEDS) {
			const built = await buildProceduralAudioCoverBuffer({ seed, kind, layout, title: seed.split(":").pop() });
			const name = `${slug([layout, kind, seed])}.png`;
			await writeFile(join(OUT_DIR, name), built.buffer);
			tiles.push({
				file: name,
				layout,
				kind,
				seed,
				title: "",
				colorCount: built.colorCount,
				glassShape: built.glassShape,
				glassTint: built.glassTint,
				gravity: built.gravity,
				detail: built.detail,
			});
		}
	}
}

for (const sample of TITLED) {
	const built = await buildProceduralAudioCoverBuffer(sample);
	const name = `${slug(["titled", sample.layout, sample.kind, sample.title])}.png`;
	await writeFile(join(OUT_DIR, name), built.buffer);
	tiles.push({
		file: name,
		layout: sample.layout,
		kind: sample.kind,
		seed: sample.seed,
		title: sample.title,
		colorCount: built.colorCount,
		glassShape: built.glassShape,
		glassTint: built.glassTint,
		gravity: built.gravity,
		detail: built.detail,
	});
}

const html = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<title>Audio cover preview</title>
	<style>
		:root { color-scheme: dark; }
		body { margin: 0; padding: 24px; font-family: Inter, Segoe UI, sans-serif; background: #0f0d1a; color: #ede9fe; }
		h1 { font-size: 20px; font-weight: 650; margin: 0 0 8px; }
		p { color: #b3b7c3; margin: 0 0 20px; }
		section { margin-bottom: 28px; }
		h2 { font-size: 14px; font-weight: 600; margin: 0 0 12px; color: #c4b5fd; text-transform: lowercase; }
		.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
		.hero-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; margin-bottom: 28px; }
		figure { margin: 0; background: #1a1628; border: 1px solid #3d3552; border-radius: 10px; overflow: hidden; }
		img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
		figcaption { padding: 8px 10px 10px; font-size: 11px; line-height: 1.4; color: #b3b7c3; }
	</style>
</head>
<body>
	<h1>Audio cover preview</h1>
	<p>${tiles.length} tiles · card (~200px) and hero samples · regenerate with <code>node scripts/preview-audio-covers.js</code></p>
	<section>
		<h2>hero samples</h2>
		<div class="hero-grid">
			${tiles.filter((t) => t.title).map((t) => `
				<figure>
					<img src="${t.file}?${Date.now()}" alt="${t.layout} ${t.kind}" />
					<figcaption>${caption(t)} · ${t.title || t.seed}</figcaption>
				</figure>
			`).join("")}
		</div>
	</section>
	${AUDIO_COVER_LAYOUTS.map((layout) => `
		<section>
			<h2>${layout}</h2>
			<div class="grid">
				${tiles.filter((t) => t.layout === layout && !t.title).map((t) => `
					<figure>
						<img src="${t.file}?${Date.now()}" alt="${t.layout} ${t.kind}" />
						<figcaption>${caption(t)}<br>${t.seed}</figcaption>
					</figure>
				`).join("")}
			</div>
		</section>
	`).join("")}
</body>
</html>
`;

await writeFile(join(OUT_DIR, "index.html"), html);
console.log(`Wrote ${tiles.length} covers + index.html to ${OUT_DIR}`);
