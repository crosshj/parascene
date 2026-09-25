import './Button.css';

const template = '<button class="ps-button" type="button"></button>';

export function createButton({ label, variant = '', type = 'button', onClick } = {}) {
	const fragment = document.createRange().createContextualFragment(template.trim());
	const button = fragment.firstElementChild;
	button.type = type;
	button.textContent = label || '';
	if (variant) button.classList.add(`ps-button--${variant}`);
	if (onClick) button.addEventListener('click', onClick);
	return button;
}
