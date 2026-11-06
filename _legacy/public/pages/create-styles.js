/**
 * Create page style presets (client): key and label only for the style picker.
 * Modifiers live server-side in api_routes/utils/createStyles.js.
 * Keys match data-key on .create-style-card in create.html.
 * Do not use entries after "///NOTE: DO NOT USE AFTER THIS POINT" from the plan.
 */
export const CREATE_STYLES = {
	none: { title: 'None' },
	default: { title: 'Default' },
	isometricVoxel: { title: "Isometric Voxel" },
	cinematic: { title: 'Cinematic' },
	'realistic-anime': { title: 'Realistic Anime' },
	'artistic-portrait': { title: 'Artistic Portrait' },
	striking: { title: 'Striking' },
	'2-5d-anime': { title: '2.5D Anime' },
	'anime-v2': { title: 'Anime v2' },
	hyperreal: { title: 'Hyperreal' },
	vibrant: { title: 'Vibrant' },
	'epic-origami': { title: 'Epic Origami' },
	'3d-game-v2': { title: '3D Game v2' },
	'color-painting': { title: 'Color Painting' },
	mecha: { title: 'Mecha' },
	'cgi-character': { title: 'CGI Character' },
	epic: { title: 'Epic' },
	'dark-fantasy': { title: 'Dark Fantasy' },
	'modern-comic': { title: 'Modern Comic' },
	'abstract-curves': { title: 'Abstract Curves' },
	'bon-voyage': { title: 'Bon Voyage' },
	'cubist-v2': { title: 'Cubist v2' },
	'detailed-gouache': { title: 'Detailed Gouache' },
	'neo-impressionist': { title: 'Neo Impressionist' },
	'pop-art': { title: 'Pop Art' },
	anime: { title: 'Anime' },
	'candy-v2': { title: 'Candy v2' },
	photo: { title: 'Photo' },
	'bw-portrait': { title: 'B&W Portrait' },
	'color-portrait': { title: 'Color Portrait' },
	'oil-painting': { title: 'Oil Painting' },
	cosmic: { title: 'Cosmic' },
	sinister: { title: 'Sinister' },
	candy: { title: 'Candy' },
	cubist: { title: 'Cubist' },
	'3d-game': { title: '3D Game' },
	fantasy: { title: 'Fantasy' },
	gouache: { title: 'Gouache' },
	matte: { title: 'Matte' },
	charcoal: { title: 'Charcoal' },
	horror: { title: 'Horror' },
	surreal: { title: 'Surreal' },
	steampunk: { title: 'Steampunk' },
	cyberpunk: { title: 'Cyberpunk' },
	synthwave: { title: 'Synthwave' },
	heavenly: { title: 'Heavenly' },
};

/** Display order of style keys (for carousel / iteration). */
export const CREATE_STYLE_KEYS = Object.keys(CREATE_STYLES);

/** Base path for style thumbnail images (140×160 or 280×320). No trailing slash. */
export const STYLE_THUMB_BASE = '/assets/style-thumbs';

/**
 * Canonical CREATE_STYLES object key for a slug (case-insensitive). On Linux, asset filenames follow
 * these keys (e.g. isometricVoxel.webp); callers often pass lowercase (isometricvoxel).
 * @param {string} raw
 * @returns {string} Matching key if found, else trimmed raw
 */
export function resolveCreateStyleKey(raw) {
	const k = String(raw ?? '').trim();
	if (!k) return '';
	if (Object.prototype.hasOwnProperty.call(CREATE_STYLES, k)) return k;
	const lower = k.toLowerCase();
	for (const objKey of Object.keys(CREATE_STYLES)) {
		if (objKey.toLowerCase() === lower) return objKey;
	}
	return k;
}

/**
 * Get thumbnail URL for a style key. Returns empty string if the style has no thumbnail (e.g. 'none').
 * Use with loading="lazy" (or eager + fetchpriority="high" for first few cards) and decoding="async".
 * @param {string} key - data-key of the style
 * @returns {string} URL to thumbnail image, or '' if none
 */
export function getStyleThumbUrl(key) {
	if (!key || key === 'none') return '';
	const resolved = resolveCreateStyleKey(key);
	const style = CREATE_STYLES[resolved];
	const file = style?.imageFile;
	if (!file) {
		const filenameKey = style ? resolved : key;
		return `${STYLE_THUMB_BASE}/${filenameKey}.webp`;
	}
	return `${STYLE_THUMB_BASE}/${file}`;
}
