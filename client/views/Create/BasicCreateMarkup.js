const BASIC_STYLE_PAIRS = [
	['none', 'None', 'default', 'Default'],
	['isometricVoxel', 'Isometric Voxel', 'cinematic', 'Cinematic'],
	['realistic-anime', 'Realistic Anime', 'artistic-portrait', 'Artistic Portrait'],
	['striking', 'Striking', '2-5d-anime', '2.5D Anime'],
	['anime-v2', 'Anime v2', 'hyperreal', 'Hyperreal'],
	['vibrant', 'Vibrant', 'epic-origami', 'Epic Origami'],
	['3d-game-v2', '3D Game v2', 'color-painting', 'Color Painting'],
	['mecha', 'Mecha', 'cgi-character', 'CGI Character'],
	['epic', 'Epic', 'dark-fantasy', 'Dark Fantasy'],
	['modern-comic', 'Modern Comic', 'abstract-curves', 'Abstract Curves'],
	['bon-voyage', 'Bon Voyage', 'cubist-v2', 'Cubist v2'],
	['detailed-gouache', 'Detailed Gouache', 'neo-impressionist', 'Neo Impressionist'],
	['pop-art', 'Pop Art', 'anime', 'Anime'],
	['candy-v2', 'Candy v2', 'photo', 'Photo'],
	['bw-portrait', 'B&W Portrait', 'color-portrait', 'Color Portrait'],
	['oil-painting', 'Oil Painting', 'cosmic', 'Cosmic'],
	['sinister', 'Sinister', 'candy', 'Candy'],
	['cubist', 'Cubist', '3d-game', '3D Game'],
	['fantasy', 'Fantasy', 'gouache', 'Gouache'],
	['matte', 'Matte', 'charcoal', 'Charcoal'],
	['horror', 'Horror', 'surreal', 'Surreal'],
	['steampunk', 'Steampunk', 'cyberpunk', 'Cyberpunk'],
	['synthwave', 'Synthwave', 'heavenly', 'Heavenly'],
];

function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function styleThumbSrc(key) {
	return key === 'none' ? '/assets/style-thumbs/none.webp' : `/assets/style-thumbs/${key}.webp`;
}

function styleCard(key, label, colorIndex) {
	return `<div class="create-style-card" role="listitem" data-key="${escapeHtml(key)}" data-color-index="${colorIndex}"><img class="create-style-card-thumb" src="${escapeHtml(styleThumbSrc(key))}" width="140" height="160" loading="lazy" decoding="async" alt=""><span class="create-style-card-label">${escapeHtml(label)}</span></div>`;
}

function basicStyleColumnsHtml() {
	let colorIndex = 0;
	return BASIC_STYLE_PAIRS.map(([aKey, aLabel, bKey, bLabel]) => {
		const a = styleCard(aKey, aLabel, colorIndex % 9);
		colorIndex += 1;
		const b = styleCard(bKey, bLabel, colorIndex % 9);
		colorIndex += 1;
		return `<div class="create-style-column">${a}${b}</div>`;
	}).join('');
}

function basicStyleDotsHtml() {
	return BASIC_STYLE_PAIRS.map((_, i) =>
		`<span class="create-style-dot${i === 0 ? ' is-active' : ''}"></span>`
	).join('');
}

export function basicCreateMarkup() {
	return `
		<div class="create-content">
			<app-tabs active="text-to-image">
				<tab label="Text-To-Image" data-id="text-to-image" default>
					<h1 class="create-title">What do you want to create?</h1>
					<div class="create-prompt-wrap">
						<textarea class="create-prompt-input prompt-editor" placeholder="Describe your creation..." rows="3" data-autogrow="true"></textarea>
						<a href="#" class="create-prompt-clear" tabindex="-1" aria-label="Clear field" data-prompt-clear>clear</a>
					</div>
					<button type="button" class="create-btn-generate btn-primary" disabled>Create</button>
					<div class="create-style-divider">
						<span class="create-style-divider-text">Choose a style</span>
					</div>
					<div class="create-style-section">
						<div class="create-style-cards" role="list">
							${basicStyleColumnsHtml()}
						</div>
						<div class="create-style-dots" aria-hidden="true">
							${basicStyleDotsHtml()}
						</div>
					</div>
				</tab>
				<tab label="Image Edit" data-id="image-edit">
					<h1 class="create-title">What do you want to change?</h1>
					<div class="create-image-edit-wrap">
						<div class="create-image-edit-box">
							<div class="create-image-edit-area" role="button" tabindex="0" data-choose-image aria-label="Choose image">
								<span class="create-image-edit-placeholder">Choose image</span>
							</div>
						</div>
						<a href="#" class="create-change-image-link" id="create-change-image-link">change image</a>
					</div>
					<div class="create-prompt-wrap">
						<textarea class="create-prompt-input prompt-editor" placeholder="Describe your changes..." rows="3" data-autogrow="true"></textarea>
						<a href="#" class="create-prompt-clear" tabindex="-1" aria-label="Clear field" data-prompt-clear>clear</a>
					</div>
					<button type="button" class="create-btn-generate btn-primary" disabled>Edit</button>
				</tab>
			</app-tabs>
		</div>
		<footer class="create-page-footer">
			<nav class="create-page-footer-nav" aria-label="More create options">
				<a href="/create" class="create-page-footer-link create-switch-to-advanced" id="create-switch-to-advanced">Advanced Mode</a>
				<span class="create-page-footer-sep" aria-hidden="true">·</span>
				<a href="/party" class="create-page-footer-link create-page-footer-link--secondary">Party Mode</a>
				<span class="create-page-footer-sep" aria-hidden="true">·</span>
				<button type="button" class="create-page-footer-link create-page-footer-link--secondary" data-import-media>Import Media</button>
			</nav>
		</footer>
	`;
}

