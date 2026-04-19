/**
 * Optional server-rendered HTML for chat canvas bodies (GET …/canvases `body_html`).
 * Markdown on the server + sanitize — no `marked` in the browser.
 *
 * To turn off without changing the client: set `CANVAS_SERVER_RENDERED_BODY_HTML` to `false`
 * (responses omit `body_html`; UI keeps using `processUserText(body)`).
 */
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

/** Flip to `false` to stop emitting `body_html` from the canvases API. */
export const CANVAS_SERVER_RENDERED_BODY_HTML = true;

const markedOpts = {
	gfm: true,
	breaks: false,
	headerIds: true,
	mangle: false
};

/**
 * @param {string} [body]
 * @returns {string} Safe HTML, or empty string when disabled / empty input.
 */
export function canvasBodyMarkdownToSafeHtml(body) {
	if (!CANVAS_SERVER_RENDERED_BODY_HTML) return "";
	const raw = String(body ?? "").trim();
	if (!raw) return "";
	const dirty = marked.parse(raw, markedOpts);
	return DOMPurify.sanitize(dirty, {
		USE_PROFILES: { html: true },
		ADD_TAGS: ["input"],
		ADD_ATTR: ["checked", "disabled", "type", "class", "id", "start"]
	});
}
