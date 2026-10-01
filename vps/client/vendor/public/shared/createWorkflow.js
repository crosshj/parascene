/**
 * Native create/mutate workflow — mount into the SPA overlay (no iframe).
 */

import {
	clearCreateWorkflowHost,
	setCreateWorkflowHost,
} from './createWorkflowHost.js';

const CREATE_EDITOR_COOKIE_RE = /(?:^|;\s*)create_editor=simple(?:;|$)/i;

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

function getAssetQuery() {
	const v =
		typeof document !== 'undefined'
			? document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || ''
			: '';
	return v ? `?v=${encodeURIComponent(v)}` : '';
}

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

export function readCreateEditorMode() {
	try {
		return CREATE_EDITOR_COOKIE_RE.test(String(document.cookie || '')) ? 'basic' : 'advanced';
	} catch {
		return 'advanced';
	}
}

/**
 * @param {string} href
 * @returns {{ mode: 'create' | 'mutate', editor?: 'basic' | 'advanced', creationId?: number, href: string } | null}
 */
export function parseCreateWorkflowHref(href) {
	const raw = String(href || '').trim();
	if (!raw) return null;
	let url;
	try {
		url = new URL(raw, window.location.origin);
	} catch {
		return null;
	}
	const path = url.pathname.replace(/\/+$/, '') || '/';
	const mutate = path.match(/^\/creations\/(\d+)\/(edit|mutate)$/);
	if (mutate) {
		const creationId = Number(mutate[1]);
		if (!Number.isFinite(creationId) || creationId <= 0) return null;
		return {
			mode: 'mutate',
			creationId,
			href: url.pathname + url.search + url.hash,
		};
	}
	if (path === '/create') {
		return {
			mode: 'create',
			editor: readCreateEditorMode(),
			href: url.pathname + url.search + url.hash,
		};
	}
	return null;
}

function ensureStylesheet(href) {
	if (typeof document === 'undefined') return;
	const abs = String(href || '').trim();
	if (!abs) return;
	if (document.querySelector(`link[data-create-workflow-css="${abs}"]`)) return;
	const existing = [...document.querySelectorAll('link[rel="stylesheet"]')].some((el) => {
		const hrefAttr = el.getAttribute('href') || '';
		return hrefAttr.split('?')[0] === abs.split('?')[0];
	});
	if (existing) {
		return;
	}
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = abs;
	link.dataset.createWorkflowCss = abs;
	document.head.appendChild(link);
}

function ensureCreateWorkflowStyles(mode) {
	const qs = getAssetQuery();
	ensureStylesheet(`/pages/creations.css${qs}`);
	if (mode === 'mutate') {
		ensureStylesheet(`/pages/creation-edit.css${qs}`);
	}
}

function resetRootClasses(root) {
	if (!(root instanceof HTMLElement)) return;
	root.classList.remove(
		'create-workflow-root',
		'create-page',
		'create-page-advanced',
		'creation-edit-page'
	);
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   href?: string,
 *   onNavigate?: Function,
 *   onDismiss?: Function,
 *   onShellOut?: Function,
 *   onClose?: Function,
 *   onShellSync?: Function,
 * }} [opts]
 * @returns {Promise<() => void>}
 */
export async function mountCreateWorkflow(root, opts = {}) {
	if (!(root instanceof HTMLElement)) return () => {};
	const href = typeof opts.href === 'string' && opts.href.trim()
		? opts.href.trim()
		: window.location.pathname + window.location.search + window.location.hash;
	const parsed = parseCreateWorkflowHref(href);
	if (!parsed) return () => {};

	const qs = getAssetQuery();
	setCreateWorkflowHost({
		root,
		onNavigate: typeof opts.onNavigate === 'function' ? opts.onNavigate : null,
		onDismiss: typeof opts.onDismiss === 'function' ? opts.onDismiss : null,
		onShellOut: typeof opts.onShellOut === 'function' ? opts.onShellOut : null,
		onClose: typeof opts.onClose === 'function' ? opts.onClose : null,
		onShellSync: typeof opts.onShellSync === 'function' ? opts.onShellSync : null,
	});

	ensureCreateWorkflowStyles(parsed.mode);
	resetRootClasses(root);
	root.classList.add('create-workflow-root');
	if (parsed.mode === 'mutate') {
		root.classList.add('creation-edit-page', 'create-page');
	} else if (parsed.editor === 'basic') {
		root.classList.add('create-page');
	} else {
		root.classList.add('create-page-advanced');
	}

	let unmountView = () => {};
	if (parsed.mode === 'mutate') {
		const mod = await import(`/pages/creation-edit.js${qs}`);
		unmountView = await mod.mountMutateWorkflow(root);
	} else if (parsed.editor === 'basic') {
		const mod = await import(`/pages/entry/entry-create.js${qs}`);
		unmountView = await mod.mountBasicCreateWorkflow(root, { markup: basicCreateMarkup() });
	} else {
		await import(`/components/elements/tabs.js${qs}`);
		await import(`/components/routes/create.js${qs}`);
		root.innerHTML = '<app-route-create></app-route-create>';
		await customElements.whenDefined('app-route-create');
		unmountView = () => {
			root.innerHTML = '';
		};
	}

	return () => {
		try {
			unmountView?.();
		} catch {
			// ignore
		}
		clearCreateWorkflowHost();
		resetRootClasses(root);
		root.innerHTML = '';
	};
}
