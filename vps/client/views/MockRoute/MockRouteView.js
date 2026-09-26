import { escapeHtml } from '../../utils/dom.js';
import template from './MockRouteView.html';
import './MockRouteView.css';

export function renderMockRouteView({ outlet, title = 'Coming soon' }) {
	outlet.innerHTML = template.replace('{{TITLE}}', escapeHtml(title));
	document.title = `${title} - parascene beta`;
}
