/**
 * Shared todo card row builder and dial styling. Used by todo route and admin page.
 */

import { starIcon } from '../icons/svg-strings.js';

function getDialColor(value) {
	const clamped = Math.max(0, Math.min(100, Number(value) || 0));
	let hue;
	if (clamped <= 20) {
		hue = 0;
	} else if (clamped <= 50) {
		const t = (clamped - 20) / 30;
		hue = 0 + t * 30;
	} else {
		const t = (clamped - 50) / 50;
		hue = 30 + t * 90;
	}
	return `hsl(${hue} 70% 50%)`;
}

/**
 * Apply priority/dial visual styles to a .todo-card-dial element.
 * @param {HTMLElement} dial
 * @param {number} value
 */
export function applyDialStyles(dial, value) {
	if (!dial) return;
	const dialColor = getDialColor(value);
	const dialPercent = Math.max(0, Math.min(100, Number(value) || 0));
	dial.textContent = value ?? '0';
	dial.style.setProperty('--dial-color', dialColor);
	dial.style.setProperty('--dial-percent', `${dialPercent}%`);
}

/**
 * Build one todo row DOM element.
 * @param {{ name: string, description?: string, time?: string, impact?: string, priority?: number, dependsOn?: unknown[], starred?: boolean }} item
 * @param {{ showStar?: boolean }} options
 * @returns {HTMLDivElement}
 */
export function buildTodoRowElement(item, options = {}) {
	const { showStar = false } = options;

	const row = document.createElement('div');
	row.className = 'todo-card';
	row.dataset.itemName = item.name;
	row.dataset.itemDescription = item.description || '';
	row.dataset.itemTime = item.time;
	row.dataset.itemImpact = item.impact;
	row.dataset.itemDependsOn = JSON.stringify(Array.isArray(item.dependsOn) ? item.dependsOn : []);
	if (showStar) row.dataset.itemStarred = item.starred ? '1' : '0';

	const card = document.createElement('div');
	card.className = 'todo-card-inner';

	const header = document.createElement('div');
	header.className = 'todo-card-header';

	if (showStar) {
		const star = document.createElement('div');
		star.className = 'todo-card-star';
		if (item.starred) star.classList.add('todo-card-star-active');
		star.setAttribute('aria-hidden', 'true');
		star.innerHTML = starIcon('todo-card-star-icon');
		header.appendChild(star);
	}

	const text = document.createElement('div');
	text.className = 'todo-card-text';

	const title = document.createElement('div');
	title.className = 'todo-card-title';
	title.textContent = item.name;

	const description = document.createElement('div');
	description.className = 'todo-card-description';
	description.textContent = item.description || '';

	text.appendChild(title);
	text.appendChild(description);

	const dial = document.createElement('div');
	dial.className = 'todo-card-dial';
	applyDialStyles(dial, item.priority);

	header.appendChild(text);
	header.appendChild(dial);
	card.appendChild(header);
	row.appendChild(card);

	return row;
}

/**
 * Build the ghost "Add new item" row.
 * @returns {HTMLDivElement}
 */
export function buildTodoGhostRow() {
	const ghostRow = document.createElement('div');
	ghostRow.className = 'todo-card todo-card-ghost';
	const ghostButton = document.createElement('button');
	ghostButton.type = 'button';
	ghostButton.className = 'todo-ghost';
	ghostButton.textContent = 'Add new item';
	ghostButton.dataset.todoAdd = 'true';
	ghostRow.appendChild(ghostButton);
	return ghostRow;
}
