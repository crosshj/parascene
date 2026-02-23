// Share page: create-prompt form — same flow as index (landing). On submit, check policy:
// if never seen → /try?prompt=... (free generation); else → /create?prompt=...
// Do not set policy/seen on load, so first-time visitors get the free try.
// Pre-fill prompt with a random example (same list as index).

const SHARE_PROMPTS = [
	"Serene mountain at golden sunset",
	"Fluid abstract color waves",
	"Cozy rain-soaked café",
	"Luminous underwater coral reef",
	"Retro-futurist city skyline",
	"Whimsical forest creatures",
	"Minimal geometric composition",
	"Dreamlike cloudscape",
	"Neon street at midnight",
	"Stylized voxel game world",
	"Epic fantasy landscape",
	"Cyberpunk megacity",
	"Realistic human portrait",
	"Modern abstract digital art",
	"Surreal sci-fi environment",
	"Ultra-realistic natural landscape",
	"Natural beauty, intimate portrait",
	"Fantasy heroine with flowing hair",
	"Ethereal figure in moonlight",
	"Editorial-style fashion portrait",
	"Elven heroine in an enchanted forest",
	"Celestial goddess-like figure",
	"Bioluminescent alien being",
	"Mermaid emerging from the sea",
	"Fae princess with glowing eyes"
];

function getPolicyHints() {
	const tz =
		typeof Intl !== "undefined" && Intl.DateTimeFormat?.().resolvedOptions?.().timeZone
			? Intl.DateTimeFormat().resolvedOptions().timeZone
			: "";
	const screenHint =
		typeof window.screen !== "undefined" ? `${window.screen.width}x${window.screen.height}` : "";
	return { tz, screen: screenHint };
}

/** On Create submit: if policy says never seen, go to /try?prompt=...; else go to /create?prompt=... (same as index). */
function handleShareCreateSubmit(e) {
	const form = e.target?.closest?.("form.share-generate-form");
	if (!form) return;
	e.preventDefault();
	const { tz, screen } = getPolicyHints();
	const params = new URLSearchParams();
	if (tz) params.set("tz", tz);
	if (screen) params.set("screen", screen);
	const formData = new FormData(form);
	for (const [k, v] of formData.entries()) {
		if (v != null && String(v).trim() !== "") params.set(k, v);
	}
	const qs = params.toString();
	fetch("/api/policy" + (qs ? "?" + qs : ""), { method: "GET", credentials: "include" })
		.then((res) => (res.ok ? res.json() : Promise.reject(new Error("policy error"))))
		.then((data) => {
			const prompt = formData.get("prompt");
			const promptStr = prompt != null ? String(prompt).trim() : "";
			if (data && data.seen === false) {
				const tryUrl = promptStr ? "/try?prompt=" + encodeURIComponent(promptStr) : "/try";
				window.location.replace(tryUrl);
				return;
			}
			const action = (form.getAttribute("action") || "/create").trim();
			const query = new URLSearchParams(formData).toString();
			window.location.href = query ? `${action}?${query}` : action;
		})
		.catch(() => {
			const action = (form.getAttribute("action") || "/create").trim();
			const query = new URLSearchParams(new FormData(form)).toString();
			window.location.href = query ? `${action}?${query}` : action;
		});
}

(function init() {
	const form = document.querySelector("form.share-generate-form");
	if (form) form.addEventListener("submit", handleShareCreateSubmit);

	const promptInput = document.querySelector("form.share-generate-form input[name=\"prompt\"]");
	if (promptInput && SHARE_PROMPTS.length > 0) {
		promptInput.value = SHARE_PROMPTS[Math.floor(Math.random() * SHARE_PROMPTS.length)];
	}
})();
