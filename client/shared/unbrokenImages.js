const CONCEALED = 'is-media-unavailable';
const installed = new WeakSet();

function imageElement(doc, node) {
	const ImageElement = doc.defaultView?.HTMLImageElement;
	return ImageElement && node instanceof ImageElement ? node : null;
}

function conceal(img) {
	if (img.classList.contains(CONCEALED)) return;
	img.classList.add(CONCEALED);
	img.setAttribute('aria-hidden', 'true');
	if (img.alt) {
		img.dataset.mediaAlt = img.alt;
		img.alt = '';
	}
}

function restore(img) {
	if (!img.classList.contains(CONCEALED)) return;
	img.classList.remove(CONCEALED);
	img.removeAttribute('aria-hidden');
	if (img.dataset.mediaAlt) {
		img.alt = img.dataset.mediaAlt;
		delete img.dataset.mediaAlt;
	}
}

/**
 * Hide the browser's broken-image icon for every img that fails to load.
 * A replacement src is allowed to try again; the icon stays hidden until that
 * load succeeds.
 * @param {Document} [doc]
 */
export function installUnbrokenImages(doc = document) {
	if (!doc || installed.has(doc)) return;
	installed.add(doc);
	doc.addEventListener('error', (event) => {
		const img = imageElement(doc, event.target);
		if (!img) return;
		conceal(img);
	}, true);
	doc.addEventListener('load', (event) => {
		const img = imageElement(doc, event.target);
		if (img && img.naturalWidth > 0) restore(img);
	}, true);
}
