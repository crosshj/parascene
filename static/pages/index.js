// Landing page behavior for index.html

const LANDING_PROMPTS = [
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

	// Feminine / human (implied, not explicit)
	"Natural beauty, intimate portrait",
	"Fantasy heroine with flowing hair",
	"Ethereal figure in moonlight",
	"Editorial-style fashion portrait",

	// Feminine / creature / mythic
	"Elven heroine in an enchanted forest",
	"Celestial goddess-like figure",
	"Bioluminescent alien being",
	"Mermaid emerging from the sea",
	"Fae princess with glowing eyes",
];

function setCtaNoteText(text) {
	const el = document.querySelector(".cta-note");
	if (el) el.textContent = text;
}

function getPolicyHints() {
	const tz = typeof Intl !== "undefined" && Intl.DateTimeFormat?.().resolvedOptions?.().timeZone ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
	const screenHint = typeof window.screen !== "undefined" ? window.screen.width + "x" + window.screen.height : "";
	return { tz, screen: screenHint };
}

/** Call once on first meaningful action (e.g. first Create click) to initialize anon identity. */
function markPolicySeen() {
	const { tz, screen } = getPolicyHints();
	fetch("/api/policy/seen", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify({ tz, screen })
	}).catch(() => { });
}

function updatePolicyCta() {
	const { tz, screen } = getPolicyHints();
	const params = new URLSearchParams();
	if (tz) params.set("tz", tz);
	if (screen) params.set("screen", screen);
	const qs = params.toString();
	fetch("/api/policy" + (qs ? "?" + qs : ""), {
		method: "GET",
		credentials: "include"
	})
		.then((res) => (res.ok ? res.json() : Promise.reject(new Error("policy error"))))
		.then((data) => {
			if (data && typeof data.seen === "boolean") {
				setCtaNoteText(data.seen ? "No credit card required — start creating now." : "No payment required — start creating now.");
			} else {
				setCtaNoteText("No credit card needed — start creating now.");
			}
		})
		.catch(() => setCtaNoteText("No payment needed — start creating now."));
}

// Smooth scroll + fade-in animations
document.addEventListener('DOMContentLoaded', () => {
	updatePolicyCta();

	// Fill hero prompt input with a random example on load
	const promptInput = document.querySelector(".landing-generate-form input[name=\"prompt\"]");
	if (promptInput && LANDING_PROMPTS.length > 0) {
		promptInput.value = LANDING_PROMPTS[Math.floor(Math.random() * LANDING_PROMPTS.length)];
	}

	// Handle smooth scrolling for anchor links
	document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
		anchor.addEventListener('click', function (e) {
			const href = this.getAttribute('href');
			if (href === '#' || href === '#features') {
				e.preventDefault();
				const targetId = href === '#' ? null : href.substring(1);
				const targetElement = targetId ? document.getElementById(targetId) : null;

				if (targetElement) {
					// Scroll to align section with top of page (header will be at top)
					const targetPosition = targetElement.offsetTop;

					window.scrollTo({
						top: targetPosition,
						behavior: 'smooth'
					});
				}
			}
		});
	});

	// Scroll-triggered fade-in animations
	const fadeSections = document.querySelectorAll('.fade-in-section');

	// Create Intersection Observer for sections
	const sectionObserverOptions = {
		root: null,
		rootMargin: '0px 0px -100px 0px', // Trigger when section is 100px from bottom of viewport
		threshold: 0.1
	};

	const sectionObserver = new IntersectionObserver((entries) => {
		entries.forEach((entry) => {
			if (entry.isIntersecting) {
				entry.target.classList.add('fade-in-visible');

				// Trigger staggered animations for child items
				const items = entry.target.querySelectorAll('.fade-in-item');
				items.forEach((item, index) => {
					setTimeout(() => {
						item.classList.add('fade-in-visible');
					}, index * 100); // 100ms delay between each item
				});

				// Unobserve after animation to improve performance
				sectionObserver.unobserve(entry.target);
			}
		});
	}, sectionObserverOptions);

	// Observe all fade-in sections
	fadeSections.forEach((section) => {
		sectionObserver.observe(section);
	});

	// Header fade-in on scroll
	const header = document.querySelector('header');
	if (header) {
		const handleScroll = () => {
			const scrollY = window.scrollY || window.pageYOffset;
			if (scrollY > 50) {
				header.classList.add('scrolled');
			} else {
				header.classList.remove('scrolled');
			}
		};

		// Check initial scroll position
		handleScroll();

		// Listen for scroll events
		window.addEventListener('scroll', handleScroll, { passive: true });
	}
});

