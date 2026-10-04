/**
 * Provider method field visibility: always-hidden vs show_when, plus select-option extras.
 */

export function isConfigHiddenField(field) {
	return Boolean(field && (field.hidden === true || field.hidden === 'true'));
}

/** Always-off unless "Show hidden fields". `show_when` fields stay in the form and toggle. */
export function isAlwaysHiddenField(field) {
	return isConfigHiddenField(field) && !field?.show_when;
}

export function fieldMatchesShowWhen(field, values = {}) {
	const rule = field?.show_when;
	if (!rule?.field) return true;
	return String(values[rule.field] ?? '') === String(rule.equals ?? '');
}

export function extraFieldsFromSelectOptions(fields, values = {}) {
	const extra = {};
	if (!fields || typeof fields !== 'object') return extra;
	for (const [fieldName, def] of Object.entries(fields)) {
		if (def?.type !== 'select' || !Array.isArray(def.options)) continue;
		const value = values[fieldName] ?? def.default;
		const opt = def.options.find((item) => {
			if (typeof item === 'string') return String(item) === String(value);
			if (!item || typeof item !== 'object') return false;
			const optionValue = item.value ?? item.id ?? item.label ?? '';
			return String(optionValue) === String(value);
		});
		if (opt?.fields && typeof opt.fields === 'object') {
			Object.assign(extra, opt.fields);
		}
	}
	return extra;
}

export function resolveRenderableFields(fields, values = {}) {
	const base = fields && typeof fields === 'object' ? fields : {};
	const extra = extraFieldsFromSelectOptions(base, values);
	const merged = { ...base };
	for (const [key, field] of Object.entries(extra)) {
		if (!(key in merged)) merged[key] = field;
	}
	return merged;
}

export function collectNamedFieldValues(root) {
	const values = {};
	if (!root) return values;
	for (const input of root.querySelectorAll('[name]')) {
		const name = input.getAttribute('name');
		if (!name) continue;
		if (input.type === 'checkbox') values[name] = input.checked;
		else if ('value' in input) values[name] = input.value;
	}
	return values;
}

export function applyShowWhenFields(container, values) {
	if (!container) return;
	const resolved = values && typeof values === 'object' ? values : collectNamedFieldValues(container);
	for (const group of container.querySelectorAll('[data-show-when-field]')) {
		const field = group.getAttribute('data-show-when-field');
		const equals = group.getAttribute('data-show-when-equals');
		const shown = String(resolved[field] ?? '') === String(equals ?? '');
		group.style.display = shown ? '' : 'none';
		const input = group.querySelector('input, textarea, select');
		if (!input) continue;
		if (shown) input.removeAttribute('disabled');
		else input.setAttribute('disabled', '');
	}
}
