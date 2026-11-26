import { mountAudioControl, mountImageControl } from './media.js';

function optionOf(option) {
	if (typeof option === 'string') return { label: option, value: option };
	const value = String(option?.value ?? '');
	const item = { label: String(option?.label || value), value };
	if (option?.section) item.section = String(option.section);
	return item;
}

const openListSelects = new Set();

function closeListSelects(except) {
	for (const select of openListSelects) {
		if (select !== except) select.close();
	}
}

function onListSelectPointerDown(event) {
	const target = event.target instanceof Node ? event.target : null;
	for (const select of [...openListSelects]) {
		if (target && select.owns(target)) continue;
		select.close();
	}
}

function onListSelectLayout() {
	for (const select of openListSelects) select.position();
}

let listSelectListeners = false;

function ensureListSelectListeners() {
	if (listSelectListeners) return;
	listSelectListeners = true;
	document.addEventListener('pointerdown', onListSelectPointerDown, true);
	window.addEventListener('resize', onListSelectLayout);
	window.addEventListener('scroll', onListSelectLayout, true);
}

/**
 * Composer-style listbox. A hidden input keeps the value in the form.
 * @param {{ options?: { label: string, value: string }[], value?: string, name?: string, onChange?: (value: string) => void }} [args]
 */
export function mountListSelect({ options = [], value = '', name = '', onChange } = {}) {
	ensureListSelectListeners();
	const root = document.createElement('div');
	root.className = 'advanced-create__select';
	const hidden = document.createElement('input');
	hidden.type = 'hidden';
	hidden.name = name;
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'advanced-create__control advanced-create__select-btn';
	button.setAttribute('aria-haspopup', 'listbox');
	button.setAttribute('aria-expanded', 'false');
	const label = document.createElement('span');
	label.className = 'advanced-create__select-label';
	const chevron = document.createElement('span');
	chevron.className = 'advanced-create__select-chevron';
	chevron.setAttribute('aria-hidden', 'true');
	chevron.textContent = '▾';
	button.append(label, chevron);
	const popover = document.createElement('div');
	popover.className = 'advanced-create__select-popover';
	popover.hidden = true;
	popover.tabIndex = -1;
	popover.setAttribute('role', 'listbox');
	popover.setAttribute('data-advanced-create-select', '');
	popover.setAttribute('aria-hidden', 'true');
	const popoverId = `advanced-create-select-${Math.random().toString(36).slice(2, 8)}`;
	popover.id = popoverId;
	button.setAttribute('aria-controls', popoverId);
	root.append(button, hidden);

	let items = options.map(optionOf);
	let current = value;
	let activeValue = '';

	function selected() {
		return items.find((option) => option.value === current) || items[0] || null;
	}

	function syncLabel() {
		const option = selected();
		current = option?.value || '';
		hidden.value = current;
		label.textContent = option?.label || '';
		button.setAttribute('aria-label', option?.label || 'Choose');
	}

	function optionButtons() {
		return [...popover.querySelectorAll('[data-advanced-create-option]')];
	}

	function setActive(next, scroll = true) {
		activeValue = next;
		let active = null;
		for (const item of optionButtons()) {
			const on = item.getAttribute('data-value') === next;
			item.classList.toggle('is-active', on);
			if (on) active = item;
		}
		if (active) popover.setAttribute('aria-activedescendant', active.id);
		if (scroll && active) {
			const popRect = popover.getBoundingClientRect();
			const optRect = active.getBoundingClientRect();
			if (optRect.top < popRect.top) popover.scrollTop -= popRect.top - optRect.top;
			else if (optRect.bottom > popRect.bottom) popover.scrollTop += optRect.bottom - popRect.bottom;
		}
	}

	function build() {
		popover.replaceChildren();
		let group = null;
		let lastSection = null;
		items.forEach((option, index) => {
			const section = option.section || '';
			if (section !== lastSection) {
				lastSection = section;
				group = null;
				if (section) {
					group = document.createElement('div');
					group.className = 'advanced-create__select-group';
					group.setAttribute('role', 'group');
					group.setAttribute('aria-label', section);
					const heading = document.createElement('div');
					heading.className = 'advanced-create__select-group-label';
					heading.setAttribute('aria-hidden', 'true');
					heading.textContent = section;
					group.append(heading);
					popover.append(group);
				}
			}
			const item = document.createElement('button');
			item.type = 'button';
			item.className = 'advanced-create__select-option';
			item.id = `${popoverId}-opt-${index}`;
			item.setAttribute('role', 'option');
			item.setAttribute('data-advanced-create-option', '');
			item.setAttribute('data-value', option.value);
			const on = option.value === selected()?.value;
			item.setAttribute('aria-selected', on ? 'true' : 'false');
			item.classList.toggle('is-selected', on);
			item.textContent = option.label;
			item.addEventListener('click', () => choose(option.value));
			item.addEventListener('pointerenter', () => setActive(option.value, false));
			(group || popover).append(item);
		});
	}

	function position() {
		if (popover.hidden) return;
		const rect = button.getBoundingClientRect();
		const margin = 8;
		const maxWidth = Math.floor(window.innerWidth - margin * 2);
		popover.style.transform = 'none';
		popover.style.maxHeight = 'none';
		popover.style.overflowY = 'visible';
		popover.style.width = 'max-content';
		popover.style.minWidth = `${Math.round(rect.width)}px`;
		popover.style.maxWidth = `${maxWidth}px`;
		for (const item of optionButtons()) {
			item.style.width = 'max-content';
			item.style.whiteSpace = 'nowrap';
		}
		let width = Math.min(maxWidth, Math.max(Math.round(rect.width), popover.offsetWidth));
		popover.style.width = `${width}px`;
		for (const item of optionButtons()) {
			item.style.width = '';
			item.style.whiteSpace = '';
		}
		const needed = popover.offsetHeight;
		const pageHeight = Math.max(margin, window.innerHeight - margin * 2);
		const height = Math.min(needed, pageHeight);
		if (needed > pageHeight) {
			popover.style.maxHeight = `${pageHeight}px`;
			popover.style.overflowY = 'auto';
		}
		let top = rect.bottom + margin;
		if (top + height > window.innerHeight - margin) top = rect.top - margin - height;
		if (top < margin) top = margin;
		let left = rect.left;
		if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
		if (left < margin) left = margin;
		popover.style.top = `${Math.round(top)}px`;
		popover.style.left = `${Math.round(left)}px`;
	}

	function open() {
		if (!items.length) return;
		closeListSelects(api);
		build();
		document.body.append(popover);
		popover.hidden = false;
		popover.setAttribute('aria-hidden', 'false');
		button.setAttribute('aria-expanded', 'true');
		openListSelects.add(api);
		position();
		setActive(selected()?.value || items[0].value);
		popover.focus({ preventScroll: true });
	}

	function close() {
		openListSelects.delete(api);
		popover.hidden = true;
		popover.setAttribute('aria-hidden', 'true');
		button.setAttribute('aria-expanded', 'false');
		popover.removeAttribute('aria-activedescendant');
		if (popover.isConnected && popover.parentElement !== root) root.append(popover);
	}

	function choose(next) {
		current = next;
		syncLabel();
		close();
		button.focus();
		hidden.dispatchEvent(new Event('input', { bubbles: true }));
		onChange?.(current);
	}

	function moveActive(key) {
		if (!items.length) return;
		const index = items.findIndex((option) => option.value === activeValue);
		let next = index;
		if (key === 'Home') next = 0;
		else if (key === 'End') next = items.length - 1;
		else if (key === 'ArrowDown') next = index < 0 ? 0 : Math.min(items.length - 1, index + 1);
		else if (key === 'ArrowUp') next = index < 0 ? items.length - 1 : Math.max(0, index - 1);
		const option = items[next];
		if (option) setActive(option.value);
	}

	button.addEventListener('click', (event) => {
		event.preventDefault();
		if (popover.hidden) open();
		else close();
	});
	button.addEventListener('keydown', (event) => {
		if (!popover.hidden) return;
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		event.preventDefault();
		open();
	});
	popover.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
			button.focus();
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			moveActive(event.key);
			return;
		}
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			const option = items.find((item) => item.value === activeValue) || selected();
			if (option) choose(option.value);
		}
	});

	const api = {
		root,
		owns(node) {
			return root.contains(node) || popover.contains(node);
		},
		position,
		close,
		setOptions(nextOptions, nextValue) {
			items = (nextOptions || []).map(optionOf);
			current = nextValue || '';
			syncLabel();
			if (!popover.hidden) build();
		},
		destroy() {
			close();
			popover.remove();
		},
	};
	Object.defineProperty(root, 'value', {
		get() { return hidden.value; },
		set(next) {
			current = String(next ?? '');
			syncLabel();
		},
	});
	root.listSelect = api;
	syncLabel();
	return api;
}


const ASPECT_NAMES = {
	'1:1': 'square',
	'4:5': 'portrait',
	'9:16': 'phone',
	'16:9': 'cinema',
	'3:2': 'landscape',
	'5:4': 'computer',
	'2:3': 'tablet',
};

function parseAspect(value) {
	const match = String(value || '').match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
	if (!match) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!width || !height) return null;
	return [width, height];
}

function aspectShape(width, height, max = 28) {
	const minSide = 8;
	if (width >= height) return { width: max, height: Math.max(minSide, Math.round((max * height) / width)) };
	return { width: Math.max(minSide, Math.round((max * width) / height)), height: max };
}

function mountAspect(field) {
	const options = (field?.options || []).map(optionOf).filter((option) => option.value);
	const root = document.createElement('div');
	root.className = 'advanced-create__aspect';
	root.setAttribute('role', 'radiogroup');
	const hidden = document.createElement('input');
	hidden.type = 'hidden';
	hidden.name = field?.key || 'aspect_ratio';
	root.append(hidden);
	let current = options[0]?.value || '';

	function paint() {
		hidden.value = current;
		for (const button of root.querySelectorAll('[data-advanced-create-aspect]')) {
			const on = button.getAttribute('data-value') === current;
			button.classList.toggle('is-selected', on);
			button.setAttribute('aria-checked', on ? 'true' : 'false');
			button.tabIndex = on ? 0 : -1;
		}
	}

	function choose(next, focus) {
		if (!options.some((option) => option.value === next)) return;
		current = next;
		paint();
		hidden.dispatchEvent(new Event('input', { bubbles: true }));
		if (focus) root.querySelector('[data-value="' + CSS.escape(next) + '"]')?.focus();
	}

	options.forEach((option, index) => {
		const ratio = parseAspect(option.value) || [1, 1];
		const shape = aspectShape(ratio[0], ratio[1]);
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'advanced-create__aspect-option';
		button.setAttribute('role', 'radio');
		button.setAttribute('data-advanced-create-aspect', '');
		button.setAttribute('data-value', option.value);
		const ratioEl = document.createElement('span');
		ratioEl.className = 'advanced-create__aspect-ratio';
		ratioEl.textContent = option.value;
		const stage = document.createElement('span');
		stage.className = 'advanced-create__aspect-shape';
		stage.setAttribute('aria-hidden', 'true');
		const inner = document.createElement('span');
		inner.className = 'advanced-create__aspect-shape-inner';
		inner.style.width = shape.width + 'px';
		inner.style.height = shape.height + 'px';
		stage.append(inner);
		const name = document.createElement('span');
		name.className = 'advanced-create__aspect-name';
		name.textContent = ASPECT_NAMES[option.value] || option.label;
		button.append(ratioEl, stage, name);
		button.addEventListener('click', () => choose(option.value, false));
		button.addEventListener('keydown', (event) => {
			const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
			if (!keys.includes(event.key)) return;
			event.preventDefault();
			event.stopPropagation();
			let next = index;
			if (event.key === 'Home') next = 0;
			else if (event.key === 'End') next = options.length - 1;
			else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
			else next = (index - 1 + options.length) % options.length;
			choose(options[next].value, true);
		});
		root.append(button);
	});

	Object.defineProperty(root, 'value', {
		get() { return hidden.value; },
		set(next) {
			const value = String(next ?? '');
			current = options.some((option) => option.value === value) ? value : (options[0]?.value || '');
			paint();
		},
	});
	paint();
	return root;
}

function mountControl(field) {
	if (field?.key === 'aspect_ratio') return mountAspect(field);
	const type = field?.type;
	if (type === 'select') {
		return mountListSelect({
			name: field.key || '',
			options: (field.options || []).map(optionOf),
		}).root;
	}
	if (type === 'text') {
		const writing = field?.key === 'prompt' || field?.key === 'lyrics';
		const input = document.createElement(writing ? 'textarea' : 'input');
		input.className = 'advanced-create__control';
		if (writing) input.rows = 3;
		if (field?.key === 'prompt') input.placeholder = 'Describe what you want to create...';
		return input;
	}
	if (type === 'boolean') {
		const input = document.createElement('input');
		input.className = 'advanced-create__check';
		input.type = 'checkbox';
		return input;
	}
	if (type === 'image') return mountImageControl(field);
	if (type === 'audio') return mountAudioControl(field);
	const input = document.createElement('input');
	input.className = 'advanced-create__control';
	if (type === 'number') input.type = 'number';
	else input.type = 'text';
	if (type === 'video') input.placeholder = 'Video URL';
	return input;
}

export function mountField(field, value) {
	const aspect = field?.key === 'aspect_ratio';
	const media = field?.type === 'image' || field?.type === 'audio';
	const wrap = document.createElement(aspect || media ? 'div' : 'label');
	wrap.className = 'advanced-create__field';
	const label = document.createElement('span');
	label.className = 'advanced-create__label';
	label.textContent = field?.label || field?.key || '';
	const control = mountControl(field);
	if (aspect) {
		const labelId = `advanced-create-label-${Math.random().toString(36).slice(2, 8)}`;
		label.id = labelId;
		control.setAttribute('aria-labelledby', labelId);
	}
	if (value != null && value !== '') {
		if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = value === 'true';
		else if ('value' in control) control.value = value;
	}
	wrap.append(label, control);
	return wrap;
}
