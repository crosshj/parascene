/**
 * Utilities for building forms from provider/server config (methods[].fields).
 * Field types are handled by separate handlers so new types can be added easily.
 */

import { attachAutoGrowTextarea } from './autogrow.js';

// --- Field type detection (used to choose handler) ---

export function isPromptLikeField(fieldKey, field) {
	const key = String(fieldKey || '');
	const label = String(field?.label || '');
	return /prompt/i.test(key) || /prompt/i.test(label);
}

export function isMultilineField(fieldKey, field) {
	const type = typeof field?.type === 'string' ? field.type.toLowerCase() : '';
	if (type === 'textarea' || type === 'multiline') return true;
	if (field?.multiline === true) return true;
	if (type === '' || type === 'text' || type === 'string') {
		return isPromptLikeField(fieldKey, field);
	}
	return false;
}

// --- Label (shared across field types) ---

function createLabel(fieldKey, field, { labelClassName, requiredClassName, fieldIdPrefix }) {
	const label = document.createElement('label');
	label.className = labelClassName;
	label.htmlFor = `${fieldIdPrefix}${fieldKey}`;
	label.appendChild(document.createTextNode(field.label || fieldKey));
	if (field.required) {
		const required = document.createElement('span');
		required.className = requiredClassName;
		required.textContent = ' *';
		label.appendChild(required);
	}
	return label;
}

// --- Field type handlers ---
// Each handler(fieldKey, field, context) returns the input/textarea element.
// Context: { inputClassName, fieldIdPrefix, onValueChange, selectClassName? }.
// Handler must set id, name, className, required, value and attach listeners that call onValueChange(fieldKey, value).

function createColorField(fieldKey, field, context) {
	const { inputClassName, fieldIdPrefix, onValueChange } = context;
	const input = document.createElement('input');
	input.type = 'color';
	input.id = `${fieldIdPrefix}${fieldKey}`;
	input.name = fieldKey;
	input.className = inputClassName;
	input.value = typeof field.default === 'string' ? field.default : '#000000';
	if (field.required) input.required = true;

	const notify = (value) => onValueChange(fieldKey, value);
	notify(input.value);
	input.addEventListener('change', (e) => notify(e.target.value));
	input.addEventListener('input', (e) => notify(e.target.value));
	return input;
}

function createTextareaField(fieldKey, field, context) {
	const { inputClassName, fieldIdPrefix, onValueChange } = context;
	const input = document.createElement('textarea');
	input.id = `${fieldIdPrefix}${fieldKey}`;
	input.name = fieldKey;
	input.className = inputClassName;
	input.placeholder = field.label || fieldKey;
	input.rows = typeof field.rows === 'number' && field.rows > 0 ? field.rows : 3;
	if (field.required) input.required = true;

	attachAutoGrowTextarea(input);

	const notify = (value) => onValueChange(fieldKey, value);
	notify(input.value);
	input.addEventListener('input', (e) => notify(e.target.value));
	return input;
}

function createTextField(fieldKey, field, context) {
	const { inputClassName, fieldIdPrefix, onValueChange } = context;
	const input = document.createElement('input');
	input.type = field.type || 'text';
	input.id = `${fieldIdPrefix}${fieldKey}`;
	input.name = fieldKey;
	input.className = inputClassName;
	input.placeholder = field.label || fieldKey;
	if (field.required) input.required = true;

	const notify = (value) => onValueChange(fieldKey, value);
	notify(input.value);
	input.addEventListener('input', (e) => notify(e.target.value));
	input.addEventListener('change', (e) => notify(e.target.value));
	return input;
}

/**
 * Normalize field.options to an array of { value, label }.
 * Accepts: string[] or { value?, id?, label? }[].
 */
function normalizeSelectOptions(options) {
	if (!Array.isArray(options)) return [];
	return options.map((item) => {
		if (typeof item === 'string') {
			return { value: item, label: item };
		}
		if (item && typeof item === 'object') {
			const value = item.value ?? item.id ?? item.label ?? '';
			const label = item.label ?? item.value ?? item.id ?? String(value);
			return { value: String(value), label: String(label) };
		}
		return { value: '', label: '' };
	});
}

function createSelectField(fieldKey, field, context) {
	const { fieldIdPrefix, onValueChange } = context;
	const selectClassName = context.selectClassName ?? context.inputClassName;
	const select = document.createElement('select');
	select.id = `${fieldIdPrefix}${fieldKey}`;
	select.name = fieldKey;
	select.className = selectClassName;
	if (field.required) select.required = true;

	const options = normalizeSelectOptions(field.options || []);
	const defaultValue = field.default !== undefined && field.default !== null ? String(field.default) : '';

	options.forEach(({ value, label }) => {
		const option = document.createElement('option');
		option.value = value;
		option.textContent = label;
		if (value === defaultValue) option.selected = true;
		select.appendChild(option);
	});

	const notify = (value) => onValueChange(fieldKey, value);
	notify(select.value);
	select.addEventListener('change', (e) => notify(e.target.value));
	return select;
}

function createBooleanField(fieldKey, field, context) {
	const { fieldIdPrefix, onValueChange } = context;
	const input = document.createElement('input');
	input.type = 'checkbox';
	input.name = fieldKey;
	input.className = 'form-switch-input';
	input.setAttribute('aria-hidden', 'true');
	input.setAttribute('tabindex', '-1');
	if (field.required) input.required = true;

	const defaultValue = field.default === true || field.default === 'true';
	input.checked = defaultValue;

	const wrapper = document.createElement('div');
	wrapper.id = `${fieldIdPrefix}${fieldKey}`;
	wrapper.className = 'form-switch';
	wrapper.setAttribute('role', 'switch');
	wrapper.setAttribute('aria-checked', String(input.checked));
	wrapper.setAttribute('tabindex', '0');
	wrapper.setAttribute('aria-label', field.label || fieldKey);

	const track = document.createElement('span');
	track.className = 'form-switch-track';
	const thumb = document.createElement('span');
	thumb.className = 'form-switch-thumb';
	track.appendChild(thumb);
	wrapper.appendChild(input);
	wrapper.appendChild(track);

	const notify = (value) => onValueChange(fieldKey, value);
	notify(input.checked);

	const updateAria = () => wrapper.setAttribute('aria-checked', String(input.checked));

	const handleChange = () => {
		updateAria();
		notify(input.checked);
	};

	input.addEventListener('change', handleChange);

	wrapper.addEventListener('click', (e) => {
		if (e.target === input) return;
		e.preventDefault();
		input.checked = !input.checked;
		updateAria();
		notify(input.checked);
	});

	wrapper.addEventListener('keydown', (e) => {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			input.checked = !input.checked;
			updateAria();
			notify(input.checked);
		}
	});

	return wrapper;
}

// --- Handler resolution ---

const FIELD_HANDLERS = {
	color: createColorField,
	textarea: createTextareaField,
	text: createTextField,
	select: createSelectField,
	boolean: createBooleanField
};

/**
 * Returns the handler key for a given field (e.g. 'color', 'textarea', 'text', 'select', 'boolean').
 * Used to look up the handler in FIELD_HANDLERS.
 */
export function getFieldType(fieldKey, field) {
	if (field?.type === 'color') return 'color';
	if (field?.type === 'select') return 'select';
	if (field?.type === 'boolean') return 'boolean';
	if (isMultilineField(fieldKey, field)) return 'textarea';
	return 'text';
}

/**
 * Create an input/textarea for a single field from provider config.
 * Uses the appropriate handler for the field type.
 *
 * @param {string} fieldKey - Field key from config
 * @param {object} field - Field config { type, label, required, rows?, default?, options? (for select) }
 * @param {object} context - { inputClassName, fieldIdPrefix, onValueChange, selectClassName? }
 * @returns {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement}
 */
export function createFieldInput(fieldKey, field, context) {
	const type = getFieldType(fieldKey, field);
	const handler = FIELD_HANDLERS[type] || FIELD_HANDLERS.text;
	return handler(fieldKey, field, context);
}

// --- Main render ---

const DEFAULTS = {
	inputClassName: 'form-input',
	labelClassName: 'form-label',
	requiredClassName: 'field-required',
	fieldIdPrefix: 'field-',
	selectClassName: 'form-select'
};

/**
 * Render form fields from a provider method's fields config into a container.
 * Each field type is handled by a dedicated handler (color, textarea, text, select, boolean).
 *
 * @param {HTMLElement} container - Element to append form-group divs into (e.g. data-fields-container)
 * @param {object} fields - Method fields config, e.g. method.fields from server_config
 * @param {object} options - Optional overrides
 * @param {function(string, string): void} options.onFieldChange - Called (fieldKey, value) when any field changes and once per field with initial value
 * @param {string} [options.inputClassName] - Class for inputs
 * @param {string} [options.selectClassName] - Class for select elements (default 'form-select')
 * @param {string} [options.labelClassName] - Class for labels
 * @param {string} [options.requiredClassName] - Class for required asterisk span
 * @param {string} [options.fieldIdPrefix] - Prefix for input id/for (default 'field-')
 */
export function renderFields(container, fields, options = {}) {
	if (!container || !fields || typeof fields !== 'object') return;

	const opts = { ...DEFAULTS, ...options };
	const fieldKeys = Object.keys(fields);
	if (fieldKeys.length === 0) return;

	container.innerHTML = '';

	fieldKeys.forEach((fieldKey) => {
		const field = fields[fieldKey];
		const fieldGroup = document.createElement('div');
		const type = getFieldType(fieldKey, field);
		fieldGroup.className = type === 'boolean' ? 'form-group form-group-checkbox' : 'form-group';

		const label = createLabel(fieldKey, field, {
			labelClassName: opts.labelClassName,
			requiredClassName: opts.requiredClassName,
			fieldIdPrefix: opts.fieldIdPrefix
		});
		const input = createFieldInput(fieldKey, field, {
			inputClassName: opts.inputClassName,
			selectClassName: opts.selectClassName,
			fieldIdPrefix: opts.fieldIdPrefix,
			onValueChange: opts.onFieldChange
		});

		fieldGroup.appendChild(label);
		fieldGroup.appendChild(input);
		container.appendChild(fieldGroup);
	});
}
