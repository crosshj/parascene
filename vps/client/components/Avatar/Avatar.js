import { escapeHtml } from '../../utils/dom.js';
import { normalizeAvatarUrl } from '../../shared/avatar.js';
import './Avatar.css';

export function avatarMarkup({ label = '', avatarUrl = '', color = '#7c3aed', text = '', kind = 'person' } = {}, className = '') {
	const safeLabel = escapeHtml(label);
	const safeClass = escapeHtml(['ps-avatar', `ps-avatar--${kind}`, className].filter(Boolean).join(' '));
	const safeColor = escapeHtml(color);
	const fallback = escapeHtml(text || label.trim().replace(/^#|^@/, '').slice(0, 1).toUpperCase() || '?');
	const safeAvatarUrl = normalizeAvatarUrl(avatarUrl);
	const image = safeAvatarUrl ? `<img data-avatar-src="${escapeHtml(safeAvatarUrl)}" alt="" loading="lazy">` : fallback;
	return `<span class="${safeClass}" style="--avatar-color:${safeColor}" role="img" aria-label="${safeLabel}">${image}</span>`;
}
