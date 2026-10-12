/**
 * Shared kebab (⋮) dropdown for creation actions.
 * Used by creation-detail and creations list; same markup and open/close/position behavior.
 */

const html = String.raw;

/**
 * Returns HTML for the kebab button + dropdown menu container.
 * Menu content (items) is passed as HTML string so callers can vary items (e.g. Set avatar, Landscape).
 * @param {Object} options
 * @param {string} options.menuContentHtml - Inner HTML for the menu (e.g. feed-card-menu-item buttons)
 * @param {string} [options.buttonAriaLabel='More'] - Aria label for the kebab button
 * @param {string} [options.menuDataAttr='data-creation-menu'] - Data attribute on the menu for querySelector
 * @param {string} [options.buttonDataAttr='data-creation-more-button'] - Data attribute on the button
 * @returns {string}
 */
export function renderCreationKebabHtml({ menuContentHtml, buttonAriaLabel = 'More' }) {
	return html`
		<button class="feed-card-action feed-card-action-more" type="button" aria-label="${buttonAriaLabel}" data-creation-more-button>
			<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<circle cx="12" cy="5" r="1.6"></circle>
				<circle cx="12" cy="12" r="1.6"></circle>
				<circle cx="12" cy="19" r="1.6"></circle>
			</svg>
		</button>
		<div class="feed-card-menu" data-creation-menu style="display: none;">
			${menuContentHtml}
		</div>
	`;
}

/**
 * Sets up open/close and positioning for a kebab dropdown.
 * Call after the kebab is in the DOM. Listener for outside click is added when opened and removed when closed.
 * @param {HTMLButtonElement} buttonEl - The kebab button (e.g. [data-creation-more-button])
 * @param {HTMLElement} menuEl - The menu container (e.g. [data-creation-menu])
 * @param {Object} [options]
 * @param {HTMLElement} [options.wrapEl] - If provided, menu is positioned relative to this (e.g. .creation-detail-more). Otherwise relative to button.
 */
export function setupKebabDropdown(buttonEl, menuEl, options = {}) {
	if (!buttonEl || !menuEl) return;

	const { wrapEl = null } = options;

	const closeMenu = (e) => {
		if (!menuEl.contains(e.target) && !buttonEl.contains(e.target)) {
			menuEl.style.display = 'none';
			document.removeEventListener('click', closeMenu);
		}
	};

	buttonEl.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();

		const isVisible = menuEl.style.display !== 'none';
		menuEl.style.display = isVisible ? 'none' : 'block';

		if (!isVisible) {
			const buttonRect = buttonEl.getBoundingClientRect();
			const refRect = wrapEl ? wrapEl.getBoundingClientRect() : buttonRect;
			menuEl.style.position = 'absolute';
			menuEl.style.right = `${refRect.right - buttonRect.right}px`;
			menuEl.style.top = `${buttonRect.bottom - refRect.top + 4}px`;
			menuEl.style.bottom = 'auto';
			menuEl.style.zIndex = '1000';

			setTimeout(() => {
				document.addEventListener('click', closeMenu);
			}, 0);
		} else {
			document.removeEventListener('click', closeMenu);
		}
	});
}
