// most of these icons are from lucide.dev, but also consider heroicons.com and tablericons.com

// SVG strings for icons (public/icons). Use across the site (DRY).
// Each icon is (className?) => string. Wrap full SVG with withAttributes to add optional class.

const html = String.raw;

/** Returns (className?) => string that injects class into the <svg> tag when provided. */
function withAttributes(svgString) {
	return (className = '') => {
		if (!className) return svgString.replace('<svg', `<svg data-from="svg-strings"`);
		return svgString.replace('<svg', `<svg class="${className}" data-from="svg-strings"`);
	}
}

// ICONS

export const homeIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path class="home-house"
			d="M 3 9 L 12 2 L 21 9 L 21 20 C 21 21.105 20.105 22 19 22 L 15 22 L 15 12 L 9 12 L 9 22 L 5 22 C 3.895 22 3 21.105 3 20 Z">
		</path>
	</svg>
`);

export const helpIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<circle cx="12" cy="12" r="10"></circle>
		<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
		<line x1="12" y1="17" x2="12.01" y2="17"></line>
	</svg>
`);

/** Info circle (lucide info). */
export const infoIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<circle cx="12" cy="12" r="10"></circle>
		<path d="M12 16v-4"></path>
		<path d="M12 8h.01"></path>
	</svg>
`);

/** User / profile (stroke, matches header avatar glyph). */
export const userProfileIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
		<circle cx="12" cy="7" r="4"></circle>
	</svg>
`);

/** Outlined single-person icon (lucide user). */
export const personOutlined = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
		<circle cx="12" cy="7" r="4"></circle>
	</svg>
`);

/** Outlined multi-person icon (lucide users-round). */
export const peopleOutlined = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M18 21a8 8 0 0 0-16 0"></path>
		<circle cx="10" cy="8" r="5"></circle>
		<path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"></path>
	</svg>
`);

/** Sign out / log out (stroke). */
export const logOutIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
		<polyline points="16 17 21 12 16 7"></polyline>
		<line x1="21" y1="12" x2="9" y2="12"></line>
	</svg>
`);

export const closeIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<line x1="18" y1="6" x2="6" y2="18"></line>
		<line x1="6" y1="6" x2="18" y2="18"></line>
	</svg>
`);

export const xIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<path
			d="M21.742 21.75l-7.563-11.179 7.056-8.321h-2.456l-5.691 6.714-4.54-6.714H2.359l7.29 10.776L2.25 21.75h2.456l6.035-7.118 4.818 7.118h6.191-.008zM7.739 3.818L18.81 20.182h-2.447L5.29 3.818h2.447z">
		</path>
	</svg>
`);

/** Chat / DM send (filled paper-plane). */
export const sendIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<path fill="currentColor" d="M6.6 10.02 14 11.4a.6.6 0 0 1 0 1.18L6.6 14l-2.94 5.87a1.48 1.48 0 0 0 1.99 1.98l17.03-8.52a1.48 1.48 0 0 0 0-2.64L5.65 2.16a1.48 1.48 0 0 0-1.99 1.98l2.94 5.88Z"></path>
	</svg>
`);

/** Section “add” control (e.g. chat sidebar headers). Stroke plus, 24×24 viewBox. */
export const plusIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<line x1="12" y1="5" x2="12" y2="19"></line>
		<line x1="5" y1="12" x2="19" y2="12"></line>
	</svg>
`);

export const facebookIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H7v3h3v7h3v-7h3l1-3h-4v-2c0-.6.4-1 1-1z"></path>
	</svg>
`);

export const redditIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path
			d="M 19.43 13.883 C 19.43 17.399 14.992 20.874 11.032 20.874 C 7.072 20.874 2.616 17.399 2.616 13.883 C 2.616 10.367 7.174 6.765 11.134 6.765 C 15.094 6.765 19.43 10.367 19.43 13.883 Z M 8.48 12.726 C 7.836 12.726 7.314 13.248 7.314 13.892 C 7.314 14.536 7.836 15.058 8.48 15.058 C 9.124 15.058 9.646 14.536 9.646 13.892 C 9.646 13.248 9.124 12.726 8.48 12.726 Z M 13.726 12.726 C 13.082 12.726 12.56 13.248 12.56 13.892 C 12.56 14.536 13.082 15.058 13.726 15.058 C 14.37 15.058 14.892 14.536 14.892 13.892 C 14.892 13.248 14.37 12.726 13.726 12.726 Z"
			fill="currentColor" stroke-width="0"></path>
		<path d="M 13.22 7.066 L 15.303 3.674 L 17.994 4.685" style=""></path>
		<circle cx="19.981" cy="5.426" r="3" fill="currentColor" stroke="none" style=""
			transform="matrix(0.74681, 0, 0, 0.744378, 4.472072, 1.201748)"></circle>
		<path
			d="M 20.222 14.267 C 20.222 15.664 18.473 16.016 18.473 16.016 L 18.473 12.518 C 18.473 12.518 20.222 12.46 20.222 14.267 Z">
		</path>
		<path
			d="M 1.827 14.31 C 1.827 15.707 3.576 16.059 3.576 16.059 L 3.576 12.561 C 3.576 12.561 1.827 12.503 1.827 14.31 Z">
		</path>
	</svg>
`);

export const linkedinIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M6.5 9.5H3.8V21h2.7V9.5zM5.2 3C4.2 3 3.4 3.8 3.4 4.8s.8 1.8 1.8 1.8S7 5.8 7 4.8 6.2 3 5.2 3zM20.6 21h-2.7v-5.9c0-1.4 0-3.2-2-3.2s-2.3 1.5-2.3 3.1V21H10.9V9.5h2.6v1.6h.04c.36-.7 1.24-1.5 2.56-1.5 2.74 0 3.25 1.8 3.25 4.2V21z">
		</path>
	</svg>
`);

export const instagramIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077">
		</path>
	</svg>
`);

export const tiktokIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z">
		</path>
	</svg>
`);

export const youtubeIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z">
		</path>
	</svg>
`);

export const spotifyIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z">
		</path>
	</svg>
`);

export const soundcloudIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.27-2.154c0-.057-.045-.1-.09-.1m-.899.828c-.06 0-.091.037-.104.094L0 14.479l.165 1.308c0 .055.045.094.09.094s.089-.045.104-.104l.21-1.319-.21-1.334c0-.061-.044-.09-.09-.09m1.83-1.229c-.061 0-.12.045-.12.104l-.21 2.563.225 2.458c0 .06.045.12.119.12.061 0 .105-.061.121-.12l.254-2.474-.254-2.548c-.016-.06-.061-.12-.121-.12m.945-.089c-.075 0-.135.06-.15.135l-.193 2.64.21 2.544c.016.077.075.138.149.138.075 0 .135-.061.15-.15l.24-2.532-.24-2.623c0-.075-.06-.135-.135-.135l-.031-.017zm1.155.36c-.005-.09-.075-.149-.159-.149-.09 0-.158.06-.164.149l-.217 2.43.2 2.563c0 .09.075.157.159.157.074 0 .148-.068.148-.158l.227-2.563-.227-2.444.033.015zm.809-1.709c-.101 0-.18.09-.18.181l-.21 3.957.187 2.563c0 .09.08.164.18.164.094 0 .174-.09.18-.18l.209-2.563-.209-3.972c-.008-.104-.088-.18-.18-.18m.959-.914c-.105 0-.195.09-.203.194l-.18 4.872.165 2.548c0 .12.09.209.195.209.104 0 .194-.089.21-.209l.193-2.548-.192-4.856c-.016-.12-.105-.21-.21-.21m.989-.449c-.121 0-.211.089-.225.209l-.165 5.275.165 2.52c.014.119.104.225.225.225.119 0 .225-.105.225-.225l.195-2.52-.196-5.275c0-.12-.105-.225-.225-.225m1.245.045c0-.135-.105-.24-.24-.24-.119 0-.24.105-.24.24l-.149 5.441.149 2.503c.016.135.121.24.256.24s.24-.105.24-.24l.164-2.503-.164-5.456-.016.015zm.749-.134c-.135 0-.255.119-.255.254l-.15 5.322.15 2.473c0 .15.12.255.255.255s.255-.12.255-.27l.15-2.474-.165-5.307c0-.148-.12-.27-.271-.27m1.005.166c-.164 0-.284.135-.284.285l-.103 5.143.135 2.474c0 .149.119.277.284.277.149 0 .271-.12.284-.285l.121-2.443-.135-5.112c-.012-.164-.135-.285-.285-.285m1.184-.945c-.045-.029-.105-.044-.165-.044s-.119.015-.165.044c-.09.054-.149.15-.149.255v.061l-.104 6.048.115 2.449v.008c.008.06.03.135.074.18.058.061.142.104.234.104.08 0 .158-.044.209-.09.058-.06.091-.135.091-.225l.015-.24.117-2.203-.135-6.086c0-.104-.061-.193-.135-.239l-.002-.022zm1.006-.547c-.045-.045-.09-.061-.15-.061-.074 0-.149.016-.209.061-.075.061-.119.15-.119.24v.029l-.137 6.609.076 1.215.061 1.185c0 .164.148.314.328.314.181 0 .33-.15.33-.329l.15-2.414-.15-6.637c0-.12-.074-.221-.165-.277m8.934 3.777c-.405 0-.795.086-1.139.232-.24-2.654-2.46-4.736-5.188-4.736-.659 0-1.305.135-1.889.359-.225.09-.27.18-.285.359v9.368c.016.18.15.33.33.345h8.185C22.681 17.218 24 15.914 24 14.28s-1.319-2.952-2.938-2.952">
		</path>
	</svg>
`);

export const sunoIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path d="M16.5 0C20.642 0 24 5.373 24 12h-9c0 6.627-3.358 12-7.5 12C3.358 24 0 18.627 0 12h9c0-6.627 3.358-12 7.5-12Z"></path>
	</svg>
`);

export const nightcafeIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M6 5.57 L7.66 5.57 L8.09 6.31 L8.15 7.72 L10.31 6.31 L11.66 6.31 L11.97 6.8 L12.15 7.78 L11.66 9.82 L10.43 13.51 L9.82 14.18 L9.94 15.54 L10.8 16.34 L12.95 16.15 L12.83 13.88 L13.57 12.03 L15.29 9.08 L16.95 7.42 L19.6 6 L21.57 6.31 L22 7.11 L21.57 9.2 L20.34 10.43 L18.98 10.12 L18.37 9.2 L18.37 8.46 L17.88 8.4 L15.66 11.11 L14.12 14.49 L14.18 16.03 L16.03 14.8 L16.58 14.8 L16.58 15.54 L14.74 16.65 L14.8 17.14 L15.72 17.57 L17.38 17.14 L18.8 15.6 L19.54 15.6 L19.85 16.46 L18.74 17.69 L17.08 18.43 L15.11 18.43 L13.69 17.2 L10.8 17.38 L9.08 16.28 L8.65 15.35 L8.65 13.57 L10.92 8.28 L10.74 7.78 L9.88 8.09 L7.78 10 L3.48 17.08 L2.43 17.38 L2 16.77 L2.12 16.03 L4.95 11.66 L6.49 7.78 L6.25 6.86 L4.65 7.48 L3.48 8.4 L3.05 8.4 L2.43 7.54 L6 5.63Z">
		</path>
	</svg>
`);

/** Google Photos pinwheel (official brand colors). */
export const googlePhotosIcon = withAttributes(html`
	<svg viewBox="0 0 48 48" aria-hidden="true">
		<path fill="#FBBC04" d="M43.611 20.083H30.111v13.5h13.5V20.083z"></path>
		<path fill="#4285F4" d="M20.083 4.5H6.583v13.5h13.5V4.5z"></path>
		<path fill="#34A853" d="M4.5 27.917v13.5h13.5v-13.5H4.5z"></path>
		<path fill="#EA4335" d="M27.917 43.611V30.111h13.5v13.5h-13.5z"></path>
	</svg>
`);

export const smsIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>
	</svg>
`);

export const notesIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M4 2.5m0 2.25a2.25 2.25 0 0 1 2.25 -2.25h11.5a2.25 2.25 0 0 1 2.25 2.25v14.5a2.25 2.25 0 0 1 -2.25 2.25h-11.5a2.25 2.25 0 0 1 -2.25 -2.25z"></path>
		<path d="M8.25 7l7.5 0"></path>
		<path d="M8.25 11.5l7.5 0"></path>
		<path d="M8.25 16l5 0"></path>
	</svg>
`);

export const megaphoneIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"></path>
		<path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"></path>
		<path d="M8 6v8"></path>
	</svg>
`);

export const emailIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M4 6h16v12H4z"></path>
		<path d="M4 7l8 6 8-6"></path>
	</svg>
`);

export const shareIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M10 3.158V7.51c-5.428.223-8.27 3.75-8.875 11.199-.04.487-.07.975-.09 1.464l-.014.395c-.014.473.578.684.88.32.302-.368.61-.73.925-1.086l.244-.273c1.79-1.967 3-2.677 4.93-2.917a18.011 18.011 0 012-.112v4.346a1 1 0 001.646.763l9.805-8.297 1.55-1.31-1.55-1.31-9.805-8.297A1 1 0 0010 3.158Zm2 6.27v.002-4.116l7.904 6.688L12 18.689v-4.212l-2.023.024c-1.935.022-3.587.17-5.197 1.024a9 9 0 00-1.348.893c.355-1.947.916-3.39 1.63-4.425 1.062-1.541 2.607-2.385 5.02-2.485L12 9.428Z">
		</path>
	</svg>
`);

export const linkIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1"></path>
		<path d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1"></path>
	</svg>
`);

/** Alternate chain link (Heroicons-style path); e.g. chat creation embed open button. */
export const linkIcon2 = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path
			d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>
	</svg>
`);

/** Picture / image frame (same glyph as My Creations in chat sidebar strip). */
export const pictureIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<rect x="3" y="5" width="18" height="14" rx="2"></rect>
		<circle cx="8" cy="10" r="2"></circle>
		<path d="M21 17l-5-5L5 19"></path>
	</svg>
`);

/** Clock at 3 o'clock — lucide clock-3 (e.g. challenge “ends in” pill). */
export const clock3Icon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<circle cx="12" cy="12" r="10"></circle>
		<path d="M12 6v6h4"></path>
	</svg>
`);

/** 2×2 grid — “View” CTA on challenge feed card (heroicons-style). */
export const viewGridIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path
			d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z">
		</path>
	</svg>
`);

/** Overlapping rectangles — copy tag / duplicate (e.g. prompt library). */
export const copyIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
		<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
	</svg>
`);

/** Pushpin — channel message pin (lucide pin). */
export const pinIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M12 17v5"></path>
		<path
			d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z">
		</path>
	</svg>
`);

/** Stroke back arrow matching Inter `<-` ligature (shaft + V head). Not chevron-left. */
export const arrowBackIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M19 12H5"></path>
		<path d="M11 6 5 12l6 6"></path>
	</svg>
`);

/** Curved reply arrow — hover reply actions (chat + comments). */
export const replyTurnIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
		<path fill="currentColor"
			d="M2.3 7.3a1 1 0 0 0 0 1.4l5 5a1 1 0 0 0 1.4-1.4L5.42 9H11a7 7 0 0 1 7 7v4a1 1 0 1 0 2 0v-4a9 9 0 0 0-9-9H5.41l3.3-3.3a1 1 0 0 0-1.42-1.4l-5 5Z">
		</path>
	</svg>
`);

/** Trash — delete row / message. */
export const trashIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M3 6h18"></path>
		<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
		<line x1="10" y1="11" x2="10" y2="17"></line>
		<line x1="14" y1="11" x2="14" y2="17"></line>
	</svg>
`);

/** Pencil — open or edit. */
export const pencilIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<g transform="translate(-1.8 -1.8) scale(1.15)">
			<path d="M4 20h4l10.5-10.5a2.828 2.828 0 1 0-4-4L4 16v4"></path>
			<path d="M13.5 6.5l4 4"></path>
		</g>
	</svg>
`);

/** Open eye — view / show (e.g. prompt library row). */
export const eyeIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path>
		<circle cx="12" cy="12" r="3"></circle>
	</svg>
`);

/** Shield icon (e.g. for content policy / moderated state). */
export const shieldIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
	</svg>
`);

/** Eye with slash through the pupil (e.g. content hidden / not visible / moderated). Balanced proportions, not pinched vertically. */
export const eyeHiddenIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
	
		<path d="M 1.166 11.968 C 8.351 3.687 15.535 3.687 22.721 11.968 C 15.535 20.252 8.351 20.252 1.166 11.968 Z">
		</path>
		<circle cx="12.027" cy="12.053" r="5.632"></circle>
		<line x1="6.986" y1="7.246" x2="16.571" y2="16.832"></line>
	
	</svg>
`);

export const qrCodeIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<rect x="3" y="3" width="7" height="7" rx="1" />
		<rect x="14" y="3" width="3" height="3" rx="0.5" />
		<rect x="14" y="9" width="3" height="3" rx="0.5" />
		<rect x="3" y="14" width="3" height="3" rx="0.5" />
		<rect x="9" y="14" width="3" height="3" rx="0.5" />
		<rect x="14" y="14" width="7" height="7" rx="1" />
	</svg>
`);

export const searchIcon = withAttributes(html`
<svg fill="currentColor" viewBox="0 0 24 24">
	<path
		d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z">
	</path>
</svg>
`);

export const starIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path d="M12 3.25l2.36 4.78 5.28.77-3.82 3.72.9 5.26L12 15.97 7.28 17.78l.9-5.26-3.82-3.72 5.28-.77L12 3.25z">
		</path>
	</svg>
`);

/** Trophy — Challenges pseudo strip (stroke). */
export const trophyIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M8 21h8"></path>
		<path d="M12 17v4"></path>
		<path d="M7 4h10v5a5 5 0 0 1-10 0V4z"></path>
		<path d="M7 8H5a2 2 0 0 1-2-2V5h4"></path>
		<path d="M17 8h2a2 2 0 0 0 2-2V5h-4"></path>
	</svg>
`);

/** Lucide thumbs-up stroke — voting / scores. Matches stroke weight of {@link pictureIcon}, {@link personOutlined}, {@link trophyIcon} (not {@link thumbsUpReactionIcon}). */
export const thumbsUpStrokeIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M7 10v12"></path>
		<path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"></path>
	</svg>
`);

/** Single filled sparkle (e.g. Mutate action). */
export const sparkleIcon = withAttributes(html`
	<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
		<path
			d="M480-80q0-83-31.5-156T363-363q-54-54-127-85.5T80-480q83 0 156-31.5T363-597q54-54 85.5-127T480-880q0 83 31.5 156T597-597q54 54 127 85.5T880-480q-83 0-156 31.5T597-363q-54 54-85.5 127T480-80Z">
		</path>
	</svg>
`);

/** Recycle / recreate (lucide recycle). */
export const recycleIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5"></path>
		<path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12"></path>
		<path d="m14 16-3 3 3 3"></path>
		<path d="M8.293 13.596 7.196 9.5 3.1 10.88"></path>
		<path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843"></path>
		<path d="m13.378 9.633 4.096 1.376"></path>
	</svg>
`);

/** Musical notes — audio clip library / input field. */
export const audioClipMusicIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M9 18V5l12-2v13"></path>
		<circle cx="6" cy="18" r="3"></circle>
		<circle cx="18" cy="16" r="3"></circle>
	</svg>
`);

export const notifyIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
		<path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
	</svg>
`);

export const creditIcon = withAttributes(html`

	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
	
		<circle cx="12" cy="12" r="9"></circle>
	
		<path
			d="M 9.301 16.612 L 9.301 7.758 L 12.641 7.758 C 13.231 7.758 13.678 7.786 13.988 7.841 C 14.424 7.915 14.788 8.053 15.08 8.257 C 15.376 8.459 15.614 8.745 15.791 9.112 C 15.97 9.477 16.06 9.881 16.06 10.318 C 16.06 11.071 15.821 11.709 15.34 12.231 C 14.862 12.753 13.996 13.013 12.744 13.013 L 10.474 13.013 L 10.474 16.612 L 9.301 16.612 Z M 10.474 11.967 L 12.762 11.967 C 13.518 11.967 14.057 11.826 14.375 11.544 C 14.694 11.264 14.853 10.866 14.853 10.354 C 14.853 9.985 14.759 9.667 14.572 9.403 C 14.385 9.141 14.138 8.967 13.832 8.881 C 13.634 8.829 13.271 8.803 12.739 8.803 L 10.474 8.803 L 10.474 11.967 Z"
			fill="currentColor" stroke-linejoin="miter" stroke-width="1"></path>
	</svg>
`);

/** Globe icon (e.g. empty feed, published badge). */
export const globeIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<circle cx="12" cy="12" r="10"></circle>
		<line x1="2" y1="12" x2="22" y2="12"></line>
		<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
	</svg>
`);

/** Open book icon (e.g. prompt library nav). */
export const promptLibraryIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"></path>
	</svg>
`);

/** User avatar icon: square, light grey bg, darker grey head + shoulders. Circle shape from CSS (e.g. border-radius: 50%). */
export const userAvatarIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect class="user-avatar-icon-bg" width="24" height="24" rx="0" />
		<circle class="user-avatar-icon-figure" cx="12" cy="8" r="3.5" />
		<ellipse class="user-avatar-icon-figure" cx="12" cy="20.5" rx="6.5" ry="8" />
	</svg>
`);

/** Outlined smiley (e.g. “Add reaction” button). Use with muted color/background for Discord-style trigger. */
export const smileIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<circle cx="12" cy="12" r="10" />
		<path d="M8 14s1.5 2 4 2 4-2 4-2" />
		<line x1="9" y1="9" x2="9.01" y2="9" />
		<line x1="15" y1="9" x2="15.01" y2="9" />
	</svg>
`);

// --- Reaction emojis (Twemoji-style; paste SVG content or use img src with codepoint URLs) ---
// Codepoints: thumbsUp 1f44d, thumbsDown 1f44e, heart 2764, joy 1f602, grin 1f604,
// openMouth 1f62e, sad 1f622, angry 1f620, clap 1f44f, hundred 1f4af, fire 1f525,
// thinking 1f914, eyes 1f440, rocket 1f680, pray 1f64f

export const thumbsUpReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<path fill="#FFDB5E"
			d="M34.956 17.916c0-.503-.12-.975-.321-1.404-1.341-4.326-7.619-4.01-16.549-4.221-1.493-.035-.639-1.798-.115-5.668.341-2.517-1.282-6.382-4.01-6.382-4.498 0-.171 3.548-4.148 12.322-2.125 4.688-6.875 2.062-6.875 6.771v10.719c0 1.833.18 3.595 2.758 3.885C8.195 34.219 7.633 36 11.238 36h18.044c1.838 0 3.333-1.496 3.333-3.334 0-.762-.267-1.456-.698-2.018 1.02-.571 1.72-1.649 1.72-2.899 0-.76-.266-1.454-.696-2.015 1.023-.57 1.725-1.649 1.725-2.901 0-.909-.368-1.733-.961-2.336.757-.611 1.251-1.535 1.251-2.581z" />
		<path fill="#EE9547"
			d="M23.02 21.249h8.604c1.17 0 2.268-.626 2.866-1.633.246-.415.109-.952-.307-1.199-.415-.247-.952-.108-1.199.307-.283.479-.806.775-1.361.775h-8.81c-.873 0-1.583-.71-1.583-1.583s.71-1.583 1.583-1.583H28.7c.483 0 .875-.392.875-.875s-.392-.875-.875-.875h-5.888c-1.838 0-3.333 1.495-3.333 3.333 0 1.025.475 1.932 1.205 2.544-.615.605-.998 1.445-.998 2.373 0 1.028.478 1.938 1.212 2.549-.611.604-.99 1.441-.99 2.367 0 1.12.559 2.108 1.409 2.713-.524.589-.852 1.356-.852 2.204 0 1.838 1.495 3.333 3.333 3.333h5.484c1.17 0 2.269-.625 2.867-1.632.247-.415.11-.952-.305-1.199-.416-.245-.953-.11-1.199.305-.285.479-.808.776-1.363.776h-5.484c-.873 0-1.583-.71-1.583-1.583s.71-1.583 1.583-1.583h6.506c1.17 0 2.27-.626 2.867-1.633.247-.416.11-.953-.305-1.199-.419-.251-.954-.11-1.199.305-.289.487-.799.777-1.363.777h-7.063c-.873 0-1.583-.711-1.583-1.584s.71-1.583 1.583-1.583h8.091c1.17 0 2.269-.625 2.867-1.632.247-.415.11-.952-.305-1.199-.417-.246-.953-.11-1.199.305-.289.486-.799.776-1.363.776H23.02c-.873 0-1.583-.71-1.583-1.583s.709-1.584 1.583-1.584z" />
	</svg>
`);

export const thumbsDownReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<path fill="#FFDB5E"
			d="M34.956 18.084c0 .503-.12.975-.321 1.404-1.341 4.326-7.619 4.01-16.549 4.221-1.493.035-.639 1.798-.115 5.668.341 2.517-1.282 6.382-4.01 6.382-4.498 0-.171-3.548-4.148-12.322-2.125-4.688-6.875-2.062-6.875-6.771V5.948c0-1.833.18-3.595 2.758-3.885C8.195 1.781 7.633 0 11.238 0h18.044c1.838 0 3.333 1.496 3.333 3.334 0 .762-.267 1.456-.698 2.018 1.02.571 1.72 1.649 1.72 2.899 0 .76-.266 1.454-.696 2.015 1.023.57 1.725 1.649 1.725 2.901 0 .909-.368 1.733-.961 2.336.757.611 1.251 1.535 1.251 2.581z" />
		<path fill="#EE9547"
			d="M23.02 14.751h8.604c1.17 0 2.268.626 2.866 1.633.246.415.109.952-.307 1.199-.415.247-.952.108-1.199-.307-.283-.479-.806-.775-1.361-.775h-8.81c-.873 0-1.583.71-1.583 1.583s.71 1.583 1.583 1.583H28.7c.483 0 .875.392.875.875s-.392.875-.875.875h-5.888c-1.838 0-3.333-1.495-3.333-3.333 0-1.025.475-1.932 1.205-2.544-.615-.605-.998-1.445-.998-2.373 0-1.028.478-1.938 1.212-2.549-.611-.604-.99-1.441-.99-2.367 0-1.12.559-2.108 1.409-2.713-.524-.589-.852-1.356-.852-2.204 0-1.838 1.495-3.333 3.333-3.333h5.484c1.17 0 2.269.625 2.867 1.632.247.415.11.952-.305 1.199-.416.245-.953.11-1.199-.305-.285-.479-.808-.776-1.363-.776h-5.484c-.873 0-1.583.71-1.583 1.583s.71 1.583 1.583 1.583h6.506c1.17 0 2.27.626 2.867 1.633.247.416.11.953-.305 1.199-.419.251-.954.11-1.199-.305-.289-.487-.799-.777-1.363-.777h-7.063c-.873 0-1.583.711-1.583 1.584s.71 1.583 1.583 1.583h8.091c1.17 0 2.269.625 2.867 1.632.247.415.11.952-.305 1.199-.417.246-.953.11-1.199-.305-.289-.486-.799-.776-1.363-.776H23.02c-.873 0-1.583.71-1.583 1.583s.709 1.584 1.583 1.584z" />
	</svg>
`);

export const heartReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<path fill="#DD2E44"
			d="M35.885 11.833c0-5.45-4.418-9.868-9.867-9.868-3.308 0-6.227 1.633-8.018 4.129-1.791-2.496-4.71-4.129-8.017-4.129-5.45 0-9.868 4.417-9.868 9.868 0 .772.098 1.52.266 2.241C1.751 22.587 11.216 31.568 18 34.034c6.783-2.466 16.249-11.447 17.617-19.959.17-.721.268-1.469.268-2.242z" />
	</svg>
`);

export const joyReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<path fill="#FFCC4D"
			d="M36 18c0 9.941-8.059 18-18 18-9.94 0-18-8.059-18-18C0 8.06 8.06 0 18 0c9.941 0 18 8.06 18 18" />
		<path fill="#664500"
			d="M28.457 17.797c-.06-.135-1.499-3.297-4.457-3.297-2.957 0-4.397 3.162-4.457 3.297-.092.207-.032.449.145.591.175.142.426.147.61.014.012-.009 1.262-.902 3.702-.902 2.426 0 3.674.881 3.702.901.088.066.194.099.298.099.11 0 .221-.037.312-.109.177-.142.238-.386.145-.594zm-12 0c-.06-.135-1.499-3.297-4.457-3.297-2.957 0-4.397 3.162-4.457 3.297-.092.207-.032.449.144.591.176.142.427.147.61.014.013-.009 1.262-.902 3.703-.902 2.426 0 3.674.881 3.702.901.088.066.194.099.298.099.11 0 .221-.037.312-.109.178-.142.237-.386.145-.594zM31 16c-.396 0-.772-.238-.929-.629-1.778-4.445-6.223-5.381-6.268-5.391-.541-.108-.893-.635-.784-1.177.108-.542.635-.891 1.177-.784.226.045 5.556 1.168 7.732 6.608.205.513-.045 1.095-.558 1.3-.12.05-.246.073-.37.073zM5 16c-.124 0-.249-.023-.371-.072-.513-.205-.762-.787-.557-1.3 2.176-5.44 7.506-6.563 7.732-6.608.543-.106 1.068.243 1.177.784.108.54-.242 1.066-.781 1.176-.185.038-4.506.98-6.271 5.391-.157.391-.533.629-.929.629zm13 6c-3.623 0-6.027-.422-9-1-.679-.131-2 0-2 2 0 4 4.595 9 11 9 6.404 0 11-5 11-9 0-2-1.321-2.132-2-2-2.973.578-5.377 1-9 1z" />
		<path fill="#FFF" d="M9 23s3 1 9 1 9-1 9-1-2 4-9 4-9-4-9-4z" />
		<path fill="#5DADEC"
			d="M10.847 28.229c-.68 2.677-3.4 4.295-6.077 3.615-2.676-.679-4.295-3.399-3.616-6.076.679-2.677 6.337-8.708 7.307-8.462.97.247 3.065 8.247 2.386 10.923zm14.286 0c.68 2.677 3.4 4.295 6.077 3.615 2.677-.679 4.296-3.399 3.616-6.076-.68-2.677-6.338-8.708-7.308-8.462-.968.247-3.064 8.247-2.385 10.923z" />
	</svg>
`);

export const grinReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<path fill="#FFCC4D"
			d="M36 18c0 9.941-8.059 18-18 18-9.94 0-18-8.059-18-18C0 8.06 8.06 0 18 0c9.941 0 18 8.06 18 18" />
		<path fill="#664500"
			d="M28.457 17.797c-.06-.135-1.499-3.297-4.457-3.297-2.957 0-4.397 3.162-4.457 3.297-.092.207-.032.449.145.591.175.142.426.147.61.014.012-.009 1.262-.902 3.702-.902 2.426 0 3.674.881 3.702.901.088.066.194.099.298.099.11 0 .221-.037.312-.109.177-.142.238-.386.145-.594zm-12 0c-.06-.135-1.499-3.297-4.457-3.297-2.957 0-4.397 3.162-4.457 3.297-.092.207-.032.449.144.591.176.142.427.147.61.014.013-.009 1.262-.902 3.703-.902 2.426 0 3.674.881 3.702.901.088.066.194.099.298.099.11 0 .221-.037.312-.109.178-.142.237-.386.145-.594zM18 22c-3.623 0-6.027-.422-9-1-.679-.131-2 0-2 2 0 4 4.595 9 11 9 6.404 0 11-5 11-9 0-2-1.321-2.132-2-2-2.973.578-5.377 1-9 1z" />
		<path fill="#FFF" d="M9 23s3 1 9 1 9-1 9-1-2 4-9 4-9-4-9-4z" /></svg>
`);

export const openMouthReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<path fill="#FFCC4D" d="M36 18c0 9.941-8.059 18-18 18S0 27.941 0 18 8.059 0 18 0s18 8.059 18 18" />
		<ellipse fill="#664500" cx="18" cy="25" rx="4" ry="5" />
		<ellipse fill="#664500" cx="12" cy="13.5" rx="2.5" ry="3.5" />
		<ellipse fill="#664500" cx="24" cy="13.5" rx="2.5" ry="3.5" /></svg>
`);

export const sadReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<path fill="#FFCC4D"
			d="M36 18c0 9.941-8.059 18-18 18-9.94 0-18-8.059-18-18C0 8.06 8.06 0 18 0c9.941 0 18 8.06 18 18" />
		<ellipse fill="#664500" cx="11.5" cy="17" rx="2.5" ry="3.5" />
		<ellipse fill="#664500" cx="24.5" cy="17" rx="2.5" ry="3.5" />
		<path fill="#664500"
			d="M5.999 13.5c-.208 0-.419-.065-.599-.2-.442-.331-.531-.958-.2-1.4 3.262-4.35 7.616-4.4 7.8-4.4.552 0 1 .448 1 1 0 .551-.445.998-.996 1-.155.002-3.568.086-6.204 3.6-.196.262-.497.4-.801.4zm24.002 0c-.305 0-.604-.138-.801-.4-2.641-3.521-6.061-3.599-6.206-3.6-.55-.006-.994-.456-.991-1.005.003-.551.447-.995.997-.995.184 0 4.537.05 7.8 4.4.332.442.242 1.069-.2 1.4-.18.135-.39.2-.599.2zm-6.516 14.879C23.474 28.335 22.34 24 18 24s-5.474 4.335-5.485 4.379c-.053.213.044.431.232.544.188.112.433.086.596-.06C13.352 28.855 14.356 28 18 28c3.59 0 4.617.83 4.656.863.095.09.219.137.344.137.084 0 .169-.021.246-.064.196-.112.294-.339.239-.557z" />
		<path fill="#5DADEC" d="M16 31c0 2.762-2.238 5-5 5s-5-2.238-5-5 4-10 5-10 5 7.238 5 10z" /></svg>
`);

export const angryReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<defs>
			<radialGradient id="angry-face-gradient" cx="50%" cy="50%" r="50%">
				<stop offset="0%" stop-color="#FFCC4D" />
				<stop offset="55%" stop-color="#FFCC4D" />
				<stop offset="100%" stop-color="#DD2E44" />
			</radialGradient>
		</defs>
		<path fill="url(#angry-face-gradient)"
			d="M36 18c0 9.941-8.059 18-18 18-9.94 0-18-8.059-18-18C0 8.06 8.06 0 18 0c9.941 0 18 8.06 18 18" />
		<path fill="#664500"
			d="M25.485 29.879C25.44 29.7 24.317 25.5 18 25.5c-6.318 0-7.44 4.2-7.485 4.379-.055.217.043.442.237.554.195.109.439.079.6-.077.019-.019 1.954-1.856 6.648-1.856s6.63 1.837 6.648 1.855c.096.095.224.145.352.145.084 0 .169-.021.246-.064.196-.112.294-.339.239-.557zm-9.778-12.586C12.452 14.038 7.221 14 7 14c-.552 0-.999.447-.999.998-.001.552.446 1 .998 1.002.029 0 1.925.022 3.983.737-.593.64-.982 1.634-.982 2.763 0 1.934 1.119 3.5 2.5 3.5s2.5-1.566 2.5-3.5c0-.174-.019-.34-.037-.507.013 0 .025.007.037.007.256 0 .512-.098.707-.293.391-.391.391-1.023 0-1.414zM29 14c-.221 0-5.451.038-8.707 3.293-.391.391-.391 1.023 0 1.414.195.195.451.293.707.293.013 0 .024-.007.036-.007-.016.167-.036.333-.036.507 0 1.934 1.119 3.5 2.5 3.5s2.5-1.566 2.5-3.5c0-1.129-.389-2.123-.982-2.763 2.058-.715 3.954-.737 3.984-.737.551-.002.998-.45.997-1.002-.001-.551-.447-.998-.999-.998z" />
	</svg>
`);

export const clapReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<path fill="#EF9645"
			d="M32.302 24.347c-.695-1.01-.307-2.47-.48-4.082-.178-2.63-1.308-5.178-3.5-7.216l-7.466-6.942s-1.471-1.369-2.841.103c-1.368 1.471.104 2.84.104 2.84l3.154 2.934 2.734 2.542s-.685.736-3.711-2.078l-10.22-9.506s-1.473-1.368-2.842.104c-1.368 1.471.103 2.84.103 2.84l9.664 8.989c-.021-.02-.731.692-.744.68L5.917 5.938s-1.472-1.369-2.841.103c-1.369 1.472.103 2.84.103 2.84L13.52 18.5c.012.012-.654.764-.634.783l-8.92-8.298s-1.472-1.369-2.841.103c-1.369 1.472.103 2.841.103 2.841l9.484 8.82c.087.081-.5.908-.391 1.009l-6.834-6.356s-1.472-1.369-2.841.104c-1.369 1.472.103 2.841.103 2.841L11.896 30.71c1.861 1.731 3.772 2.607 6.076 2.928.469.065 1.069.065 1.315.096.777.098 1.459.374 2.372.934 1.175.72 2.938 1.02 3.951-.063l3.454-3.695 3.189-3.412c1.012-1.082.831-2.016.049-3.151z" />
		<path
			d="M1.956 35.026c-.256 0-.512-.098-.707-.293-.391-.391-.391-1.023 0-1.414L4.8 29.77c.391-.391 1.023-.391 1.414 0s.391 1.023 0 1.414l-3.551 3.55c-.195.195-.451.292-.707.292zm6.746.922c-.109 0-.221-.018-.331-.056-.521-.182-.796-.752-.613-1.274l.971-2.773c.182-.521.753-.795 1.274-.614.521.183.796.753.613 1.274l-.971 2.773c-.144.412-.53.67-.943.67zm-7.667-7.667c-.412 0-.798-.257-.943-.667-.184-.521.089-1.092.61-1.276l2.495-.881c.523-.18 1.092.091 1.276.61.184.521-.089 1.092-.61 1.276l-2.495.881c-.111.039-.223.057-.333.057zm29.46-21.767c-.256 0-.512-.098-.707-.293-.391-.391-.391-1.024 0-1.415l3.552-3.55c.391-.39 1.023-.39 1.414 0s.391 1.024 0 1.415l-3.552 3.55c-.195.196-.451.293-.707.293zm-4.164-1.697c-.109 0-.221-.019-.33-.057-.521-.182-.796-.752-.614-1.274l.97-2.773c.183-.521.752-.796 1.274-.614.521.182.796.752.614 1.274l-.97 2.773c-.144.413-.531.671-.944.671zm6.143 5.774c-.412 0-.798-.257-.943-.667-.184-.521.09-1.092.61-1.276l2.494-.881c.522-.185 1.092.09 1.276.61.184.521-.09 1.092-.61 1.276l-2.494.881c-.111.039-.223.057-.333.057z"
			fill="#FA743E" />
		<path fill="#FFDB5E"
			d="M35.39 23.822c-.661-1.032-.224-2.479-.342-4.096-.09-2.634-1.133-5.219-3.255-7.33l-7.228-7.189s-1.424-1.417-2.843.008c-1.417 1.424.008 2.842.008 2.842l3.054 3.039 2.646 2.632s-.71.712-3.639-2.202c-2.931-2.915-9.894-9.845-9.894-9.845s-1.425-1.417-2.843.008c-1.418 1.424.007 2.841.007 2.841l9.356 9.31c-.02-.02-.754.667-.767.654L9.64 4.534s-1.425-1.418-2.843.007c-1.417 1.425.007 2.842.007 2.842l10.011 9.962c.012.012-.68.741-.66.761L7.52 9.513s-1.425-1.417-2.843.008.007 2.843.007 2.843l9.181 9.135c.084.083-.53.891-.425.996l-6.616-6.583s-1.425-1.417-2.843.008.007 2.843.007 2.843l10.79 10.732c1.802 1.793 3.682 2.732 5.974 3.131.467.081 1.067.101 1.311.14.773.124 1.445.423 2.34 1.014 1.15.759 2.902 1.118 3.951.07l3.577-3.576 3.302-3.302c1.049-1.05.9-1.99.157-3.15z" />
	</svg>
`);

export const hundredReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<path fill="#BB1A34"
			d="M1.728 21c-.617 0-.953-.256-1.127-.471-.171-.211-.348-.585-.225-1.165L3.104 6.658l-1.714.097h-.013c-.517 0-.892-.168-1.127-.459-.22-.272-.299-.621-.221-.98.15-.702.883-1.286 1.667-1.329l4.008-.227c.078-.005.15-.008.217-.008.147 0 .536 0 .783.306.252.312.167.709.139.839L3.719 19.454c-.187.884-.919 1.489-1.866 1.542L1.728 21zm10.743-2c-1.439 0-2.635-.539-3.459-1.559-1.163-1.439-1.467-3.651-.878-6.397 1.032-4.812 4.208-8.186 7.902-8.395 1.59-.089 2.906.452 3.793 1.549 1.163 1.439 1.467 3.651.878 6.397-1.032 4.81-4.208 8.184-7.904 8.394-.112.008-.223.011-.332.011zm3.414-13.746l-.137.004c-1.94.111-3.555 2.304-4.32 5.866-.478 2.228-.381 3.899.272 4.707.297.368.717.555 1.249.555l.14-.004c1.94-.109 3.554-2.301 4.318-5.864.478-2.228.382-3.9-.27-4.708-.296-.369-.718-.556-1.252-.556zm11.591 12.107c-1.439 0-2.637-.539-3.462-1.56-1.163-1.439-1.467-3.651-.878-6.397 1.033-4.813 4.209-8.186 7.903-8.394 1.603-.09 2.903.453 3.79 1.549 1.163 1.439 1.467 3.651.878 6.396-1.031 4.809-4.206 8.183-7.902 8.396-.112.008-.221.01-.329.01zm3.411-13.747l-.136.004c-1.941.111-3.556 2.304-4.32 5.865-.478 2.229-.381 3.901.272 4.708.297.368.719.555 1.251.555l.14-.004c1.939-.109 3.554-2.302 4.318-5.864.479-2.227.383-3.899-.27-4.707-.298-.37-.72-.557-1.255-.557zM11 35.001c-.81 0-1.572-.496-1.873-1.299-.388-1.034.136-2.187 1.17-2.575.337-.126 8.399-3.108 20.536-4.12 1.101-.096 2.067.727 2.159 1.827.092 1.101-.727 2.067-1.827 2.159-11.59.966-19.386 3.851-19.464 3.88-.23.086-.468.128-.701.128zM2.001 29c-.804 0-1.563-.488-1.868-1.283-.396-1.031.118-2.188 1.149-2.583.542-.209 13.516-5.126 32.612-6.131 1.113-.069 2.045.789 2.103 1.892.059 1.103-.789 2.045-1.892 2.103-18.423.97-31.261 5.821-31.389 5.87-.235.089-.477.132-.715.132z" />
	</svg>
`);

export const fireReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<path fill="#F4900C"
			d="M35 19c0-2.062-.367-4.039-1.04-5.868-.46 5.389-3.333 8.157-6.335 6.868-2.812-1.208-.917-5.917-.777-8.164.236-3.809-.012-8.169-6.931-11.794 2.875 5.5.333 8.917-2.333 9.125-2.958.231-5.667-2.542-4.667-7.042-3.238 2.386-3.332 6.402-2.333 9 1.042 2.708-.042 4.958-2.583 5.208-2.84.28-4.418-3.041-2.963-8.333C2.52 10.965 1 14.805 1 19c0 9.389 7.611 17 17 17s17-7.611 17-17z" />
		<path fill="#FFCC4D"
			d="M28.394 23.999c.148 3.084-2.561 4.293-4.019 3.709-2.106-.843-1.541-2.291-2.083-5.291s-2.625-5.083-5.708-6c2.25 6.333-1.247 8.667-3.08 9.084-1.872.426-3.753-.001-3.968-4.007C7.352 23.668 6 26.676 6 30c0 .368.023.73.055 1.09C9.125 34.124 13.342 36 18 36s8.875-1.876 11.945-4.91c.032-.36.055-.722.055-1.09 0-2.187-.584-4.236-1.606-6.001z" />
	</svg>
`);

export const thinkingReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<circle fill="#FFCB4C" cx="18" cy="17.018" r="17" />
		<path fill="#65471B"
			d="M14.524 21.036c-.145-.116-.258-.274-.312-.464-.134-.46.13-.918.59-1.021 4.528-1.021 7.577 1.363 7.706 1.465.384.306.459.845.173 1.205-.286.358-.828.401-1.211.097-.11-.084-2.523-1.923-6.182-1.098-.274.061-.554-.016-.764-.184z" />
		<ellipse fill="#65471B" cx="13.119" cy="11.174" rx="2.125" ry="2.656" />
		<ellipse fill="#65471B" cx="24.375" cy="12.236" rx="2.125" ry="2.656" />
		<path fill="#F19020"
			d="M17.276 35.149s1.265-.411 1.429-1.352c.173-.972-.624-1.167-.624-1.167s1.041-.208 1.172-1.376c.123-1.101-.861-1.363-.861-1.363s.97-.4 1.016-1.539c.038-.959-.995-1.428-.995-1.428s5.038-1.221 5.556-1.341c.516-.12 1.32-.615 1.069-1.694-.249-1.08-1.204-1.118-1.697-1.003-.494.115-6.744 1.566-8.9 2.068l-1.439.334c-.54.127-.785-.11-.404-.512.508-.536.833-1.129.946-2.113.119-1.035-.232-2.313-.433-2.809-.374-.921-1.005-1.649-1.734-1.899-1.137-.39-1.945.321-1.542 1.561.604 1.854.208 3.375-.833 4.293-2.449 2.157-3.588 3.695-2.83 6.973.828 3.575 4.377 5.876 7.952 5.048l3.152-.681z" />
		<path fill="#65471B"
			d="M9.296 6.351c-.164-.088-.303-.224-.391-.399-.216-.428-.04-.927.393-1.112 4.266-1.831 7.699-.043 7.843.034.433.231.608.747.391 1.154-.216.405-.74.546-1.173.318-.123-.063-2.832-1.432-6.278.047-.257.109-.547.085-.785-.042zm12.135 3.75c-.156-.098-.286-.243-.362-.424-.187-.442.023-.927.468-1.084 4.381-1.536 7.685.48 7.823.567.415.26.555.787.312 1.178-.242.39-.776.495-1.191.238-.12-.072-2.727-1.621-6.267-.379-.266.091-.553.046-.783-.096z" />
		</svg>
`);

export const eyesReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<ellipse fill="#F5F8FA" cx="8.828" cy="18" rx="7.953" ry="13.281" />
		<path fill="#E1E8ED"
			d="M8.828 32.031C3.948 32.031.125 25.868.125 18S3.948 3.969 8.828 3.969 17.531 10.132 17.531 18s-3.823 14.031-8.703 14.031zm0-26.562C4.856 5.469 1.625 11.09 1.625 18s3.231 12.531 7.203 12.531S16.031 24.91 16.031 18 12.8 5.469 8.828 5.469z" />
		<circle fill="#8899A6" cx="6.594" cy="18" r="4.96" />
		<circle fill="#292F33" cx="6.594" cy="18" r="3.565" />
		<circle fill="#F5F8FA" cx="7.911" cy="15.443" r="1.426" />
		<ellipse fill="#F5F8FA" cx="27.234" cy="18" rx="7.953" ry="13.281" />
		<path fill="#E1E8ED"
			d="M27.234 32.031c-4.88 0-8.703-6.163-8.703-14.031s3.823-14.031 8.703-14.031S35.938 10.132 35.938 18s-3.824 14.031-8.704 14.031zm0-26.562c-3.972 0-7.203 5.622-7.203 12.531 0 6.91 3.231 12.531 7.203 12.531S34.438 24.91 34.438 18 31.206 5.469 27.234 5.469z" />
		<circle fill="#8899A6" cx="25" cy="18" r="4.96" />
		<circle fill="#292F33" cx="25" cy="18" r="3.565" />
		<circle fill="#F5F8FA" cx="26.317" cy="15.443" r="1.426" /></svg>
`);

export const rocketReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<path fill="#A0041E" d="M1 17l8-7 16 1 1 16-7 8s.001-5.999-6-12-12-6-12-6z" />
		<path fill="#FFAC33"
			d="M.973 35s-.036-7.979 2.985-11S15 21.187 15 21.187 14.999 29 11.999 32c-3 3-11.026 3-11.026 3z" />
		<circle fill="#FFCC4D" cx="8.999" cy="27" r="4" />
		<path fill="#55ACEE" d="M35.999 0s-10 0-22 10c-6 5-6 14-4 16s11 2 16-4c10-12 10-22 10-22z" />
		<path
			d="M26.999 5c-1.623 0-3.013.971-3.641 2.36.502-.227 1.055-.36 1.641-.36 2.209 0 4 1.791 4 4 0 .586-.133 1.139-.359 1.64 1.389-.627 2.359-2.017 2.359-3.64 0-2.209-1.791-4-4-4z" />
		<path fill="#A0041E" d="M8 28s0-4 1-5 13.001-10.999 14-10-9.001 13-10.001 14S8 28 8 28z" /></svg>
`);

export const prayReactionIcon = withAttributes(html`
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true">
		<path fill="#50A5E6" d="M30 22c-3 0-6.688 7.094-7 10-.421 3.915 2 4 2 4h11V26s-3.438-4-6-4z" />
		<ellipse transform="rotate(-60 27.574 28.49)" fill="#1C6399" cx="27.574" cy="28.489" rx="5.848" ry="1.638" />
		<path fill="#F9CA55"
			d="M20.086 0c1.181 0 2.138.957 2.138 2.138 0 .789.668 10.824.668 10.824L17.948 18V2.138C17.948.957 18.905 0 20.086 0z" />
		<path fill="#FFDC5D"
			d="M18.875 4.323c0-1.099.852-1.989 1.903-1.989 1.051 0 1.903.891 1.903 1.989 0 0 .535 5.942 1.192 9.37.878 1.866 1.369 4.682 1.261 6.248.054.398 5.625 5.006 5.625 5.006-.281 1.813-2.259 6.155-4.759 8.159l-3.521-2.924c-2.885-.404-4.458-3.331-4.458-4.264 0-2.984.854-21.595.854-21.595z" />
		<path fill="#50A5E6" d="M6 22c3 0 6.688 7.094 7 10 .421 3.915-2 4-2 4H0V26s3.438-4 6-4z" />
		<ellipse transform="rotate(-30 8.424 28.489)" fill="#1C6399" cx="8.426" cy="28.489" rx="1.638" ry="5.848" />
		<path fill="#F9CA55"
			d="M16.061.011c-1.266-.127-2.333.864-2.333 2.103 0 .78-.184 10.319-.184 10.319L17.895 18l.062-15.765c0-1.106-.795-2.114-1.896-2.224z" />
		<path fill="#FFDC5D"
			d="M17.125 4.323c0-1.099-.852-1.989-1.903-1.989-1.051 0-1.903.891-1.903 1.989 0 0-.535 5.942-1.192 9.37-.878 1.866-1.369 4.682-1.261 6.248-.054.398-5.625 5.006-5.625 5.006C5.522 26.76 7.5 31.102 10 33.106l3.521-2.924c2.885-.404 4.458-3.331 4.458-4.264 0-2.984-.854-21.595-.854-21.595z" />
		<path fill="#F9CA55"
			d="M17.958 25.823c-.414 0-.75-.336-.75-.75V2.792c0-.414.336-.75.75-.75s.75.336.75.75v22.282c.001.413-.335.749-.75.749z" />
		</svg>
`);

/** Settings / server details (stroke gear, 24×24). */
export const gearIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<circle cx="12" cy="12" r="3"></circle>
		<path
			d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z">
		</path>
	</svg>
`);

const COG_INNER = html`
	<circle cx="12" cy="12" r="3"></circle>
	<path
		d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z">
	</path>
`;

/** Two meshing cogs — GPU generating overlay. */
export function generatingGearsIcon(className = '') {
	const extra = className ? ` ${className}` : '';
	return html`<span class="creation-wait-gears${extra}" data-from="svg-strings" aria-hidden="true">
		<svg class="creation-wait-gear creation-wait-gear--lg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
			stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${COG_INNER}</svg>
		<svg class="creation-wait-gear creation-wait-gear--sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"
			stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${COG_INNER}</svg>
	</span>`;
}

/** Wristwatch — GPU queued overlay (lucide watch). */
export function queuedWatchIcon(className = '') {
	const extra = className ? ` ${className}` : '';
	return html`<svg class="creation-wait-watch${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
		stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" data-from="svg-strings" aria-hidden="true">
		<circle cx="12" cy="12" r="6"></circle>
		<polyline points="12 10 12 12 13.5 13"></polyline>
		<path d="m16.13 7.66-.81-1.41a2 2 0 0 0-1.74-1h-3.16a2 2 0 0 0-1.74 1l-.81 1.41"></path>
		<path d="m16.13 16.34-.81 1.41a2 2 0 0 1-1.74 1h-3.16a2 2 0 0 1-1.74-1l-.81-1.41"></path>
	</svg>`;
}

/** Sliders / manage-settings (lucide sliders-horizontal). */
export const slidersIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<line x1="21" x2="14" y1="4" y2="4"></line>
		<line x1="10" x2="3" y1="4" y2="4"></line>
		<line x1="21" x2="12" y1="12" y2="12"></line>
		<line x1="8" x2="3" y1="12" y2="12"></line>
		<line x1="21" x2="16" y1="20" y2="20"></line>
		<line x1="12" x2="3" y1="20" y2="20"></line>
		<line x1="14" x2="14" y1="2" y2="6"></line>
		<line x1="8" x2="8" y1="10" y2="14"></line>
		<line x1="16" x2="16" y1="18" y2="22"></line>
	</svg>
`);

/** Undo / revert (lucide undo-2). */
export const undoIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M9 14 4 9l5-5"></path>
		<path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"></path>
	</svg>
`);

/** Challenge organizer stats / bar chart (stroke, 24×24). */
export const statsBarsIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M6 20V12"></path>
		<path d="M12 20V6"></path>
		<path d="M18 20v-8"></path>
	</svg>
`);

/** Reaction icon key → (className?) => svgString. Use for comment reactions. */
export const REACTION_ICONS = {
	thumbsUp: thumbsUpReactionIcon,
	thumbsDown: thumbsDownReactionIcon,
	heart: heartReactionIcon,
	joy: joyReactionIcon,
	grin: grinReactionIcon,
	openMouth: openMouthReactionIcon,
	sad: sadReactionIcon,
	angry: angryReactionIcon,
	clap: clapReactionIcon,
	hundred: hundredReactionIcon,
	fire: fireReactionIcon,
	thinking: thinkingReactionIcon,
	eyes: eyesReactionIcon,
	rocket: rocketReactionIcon,
	pray: prayReactionIcon,
};

/** Display order for reaction strip (same as API REACTION_ORDER). */
export const REACTION_ORDER = [
	'heart', 'thumbsUp', 'thumbsDown', 'joy', 'grin', 'openMouth', 'sad', 'angry',
	'clap', 'hundred', 'fire', 'thinking', 'eyes', 'rocket', 'pray',
];
