import template from './MockRouteView.html';
import './MockRouteView.css';

export function renderMockRouteView({ outlet, title = 'Coming soon' }) {
	outlet.innerHTML = template;
	document.title = `${title} - parascene beta`;
}
