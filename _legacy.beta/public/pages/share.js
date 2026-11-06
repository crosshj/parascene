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

/** Origin for create/try redirects: use www when on sh subdomain so Create submits to www. */
function getCreateOrigin() {
	const hostname = typeof window.location?.hostname === "string" ? window.location.hostname : "";
	if (hostname.startsWith("sh.")) {
		return window.location.protocol + "//www." + hostname.slice(3);
	}
	return window.location.origin;
}

/** Build full URL for create/try redirect (www when on sh). */
function buildCreateUrl(path, queryString) {
	const origin = getCreateOrigin();
	const pathStr = path.startsWith("/") ? path : "/" + path;
	return queryString ? `${origin}${pathStr}?${queryString}` : `${origin}${pathStr}`;
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
				const tryQuery = promptStr ? "prompt=" + encodeURIComponent(promptStr) : "";
				window.location.replace(buildCreateUrl("/try", tryQuery));
				return;
			}
			const action = (form.getAttribute("action") || "/create").trim();
			const query = new URLSearchParams(formData).toString();
			window.location.href = buildCreateUrl(action, query);
		})
		.catch(() => {
			const action = (form.getAttribute("action") || "/create").trim();
			const query = new URLSearchParams(new FormData(form)).toString();
			window.location.href = buildCreateUrl(action, query);
		});
}

function preloadShareImageUrl(url) {
	return new Promise((resolve) => {
		const src = typeof url === "string" ? url.trim() : "";
		if (!src) {
			resolve({ ok: false, url: src });
			return;
		}
		const img = new Image();
		img.decoding = "async";
		img.onload = () => resolve({ ok: true, url: src });
		img.onerror = () => resolve({ ok: false, url: src });
		img.src = src;
	});
}

function waitForShareImgElementReady(img) {
	if (!(img instanceof HTMLImageElement)) return Promise.resolve(false);
	if (img.complete && img.naturalWidth > 0) return Promise.resolve(true);
	return new Promise((resolve) => {
		const done = (ok) => {
			img.removeEventListener("load", onLoad);
			img.removeEventListener("error", onError);
			resolve(ok);
		};
		const onLoad = () => done(img.naturalWidth > 0);
		const onError = () => done(false);
		img.addEventListener("load", onLoad, { once: true });
		img.addEventListener("error", onError, { once: true });
	});
}

function parseShareGroupCarouselSlides(wrap) {
	const b64 = wrap.getAttribute("data-share-group-carousel-b64") || "";
	if (!b64) return [];
	try {
		const parsed = JSON.parse(atob(b64));
		return Array.isArray(parsed)
			? parsed
				.map((slide) => ({
					url: typeof slide?.url === "string" ? slide.url.trim() : "",
					title: typeof slide?.title === "string" ? slide.title.trim() : "Grouped creation image"
				}))
				.filter((slide) => slide.url)
			: [];
	} catch {
		return [];
	}
}

function initShareGroupCarousel() {
	const wrap = document.querySelector(".share-hero-media-wrap--group[data-share-group-carousel-b64]");
	if (!(wrap instanceof HTMLElement)) return;

	const slides = parseShareGroupCarouselSlides(wrap);
	if (slides.length <= 1) return;

	const coverImg = wrap.querySelector("[data-share-hero-cover]");
	const prevBtn = wrap.querySelector("[data-share-group-prev]");
	const nextBtn = wrap.querySelector("[data-share-group-next]");
	if (!(coverImg instanceof HTMLImageElement)) return;

	const stackImages = [];
	let activeIndex = 0;
	let carouselReady = false;

	const setActiveIndex = (index) => {
		if (stackImages.length === 0) return;
		activeIndex = ((index % stackImages.length) + stackImages.length) % stackImages.length;
		for (let i = 0; i < stackImages.length; i += 1) {
			stackImages[i].classList.toggle("is-active", i === activeIndex);
		}
	};

	const step = (direction) => {
		if (!carouselReady) return;
		setActiveIndex(activeIndex + (direction >= 0 ? 1 : -1));
	};

	void (async () => {
		// Cover uses SSR /api/share/.../image; carousel slides are source URLs only (no duplicate).
		const coverReady = await waitForShareImgElementReady(coverImg);

		const remainingUrls = coverReady
			? slides.slice(1).map((slide) => slide.url).filter(Boolean)
			: slides.map((slide) => slide.url).filter(Boolean);
		const preloadResults =
			remainingUrls.length > 0
				? await Promise.all(remainingUrls.map((url) => preloadShareImageUrl(url)))
				: [];
		const anySourceReady = preloadResults.some((result) => result.ok);
		if (!coverReady && !anySourceReady) return;

		let initialIndex = 0;
		if (!coverReady) {
			const firstOk = preloadResults.findIndex((result) => result.ok);
			if (firstOk < 0) return;
			initialIndex = firstOk;
			coverImg.style.display = "none";
		}

		const stack = document.createElement("div");
		stack.className = "share-group-hero-stack";

		if (coverReady) {
			coverImg.classList.remove("share-image");
			coverImg.classList.add("share-group-hero-image");
			stack.appendChild(coverImg);
			stackImages.push(coverImg);
		}

		const stackStartIndex = coverReady ? 1 : 0;
		for (let i = stackStartIndex; i < slides.length; i += 1) {
			const slide = slides[i];
			const img = document.createElement("img");
			img.className = "share-group-hero-image";
			img.alt = slide.title || "Grouped creation image";
			img.decoding = "async";
			img.loading = "eager";
			img.src = slide.url;
			stackImages.push(img);
			stack.appendChild(img);
		}

		if (stackImages.length === 0) return;

		wrap.appendChild(stack);
		setActiveIndex(initialIndex);

		const readyResults = await Promise.all(
			stackImages.map((img) => waitForShareImgElementReady(img))
		);
		if (!readyResults.some(Boolean)) return;

		carouselReady = true;
		wrap.classList.add("share-carousel-active");

		if (prevBtn instanceof HTMLButtonElement) {
			prevBtn.hidden = false;
			prevBtn.addEventListener("click", (e) => {
				e.preventDefault();
				step(-1);
			});
		}
		if (nextBtn instanceof HTMLButtonElement) {
			nextBtn.hidden = false;
			nextBtn.addEventListener("click", (e) => {
				e.preventDefault();
				step(1);
			});
		}
	})();
}

(function init() {
	initShareGroupCarousel();

	const form = document.querySelector("form.share-generate-form");
	if (form) form.addEventListener("submit", handleShareCreateSubmit);

	const promptInput = document.querySelector("form.share-generate-form input[name=\"prompt\"]");
	if (promptInput && SHARE_PROMPTS.length > 0) {
		promptInput.value = SHARE_PROMPTS[Math.floor(Math.random() * SHARE_PROMPTS.length)];
	}

	const shuffleBtn = document.querySelector("[data-share-shuffle]");
	if (shuffleBtn && promptInput && SHARE_PROMPTS.length > 0) {
		shuffleBtn.addEventListener("click", () => {
			promptInput.value = SHARE_PROMPTS[Math.floor(Math.random() * SHARE_PROMPTS.length)];
			promptInput.focus();
		});
	}

	const clearLink = document.querySelector("[data-share-clear]");
	if (clearLink && promptInput) {
		clearLink.addEventListener("click", (e) => {
			e.preventDefault();
			promptInput.value = "";
			promptInput.focus();
		});
	}

	const shareVideoWrap = document.querySelector(".share-hero-video-wrap");
	const shareVideoEl = shareVideoWrap?.querySelector?.("[data-share-hero-video]") || null;
	const shareVideoPlayBtn = shareVideoWrap?.querySelector?.("[data-share-video-play]") || null;
	if (shareVideoEl && shareVideoPlayBtn) {
		let shareVideoOverlayConsumed = false;

		function applyShareVideoFirstPlay() {
			if (shareVideoOverlayConsumed) return;
			shareVideoOverlayConsumed = true;
			shareVideoPlayBtn.hidden = true;
			shareVideoEl.controls = true;
			shareVideoEl.setAttribute("controls", "");
			shareVideoEl.muted = false;
			shareVideoEl.removeAttribute("muted");
			void shareVideoEl.play().catch(() => {});
		}

		shareVideoPlayBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			applyShareVideoFirstPlay();
		});
	}
})();
