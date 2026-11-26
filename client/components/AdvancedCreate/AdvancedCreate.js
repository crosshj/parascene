import template from './AdvancedCreate.html';
import './AdvancedCreate.css';
import { bindRefs, mountTemplate } from '../../utils/dom.js';
import { loadAdvancedConfig } from './config.js';
import { mountField, mountListSelect } from './fields.js';

const OUTPUT_LABELS = { image: 'Image', audio: 'Audio', video: 'Video', upload: 'Upload' };
const ROUTE_ROLES = ['audio', 'video', 'image', 'ref', 'text'];

function entries(record) {
	if (!record || typeof record !== 'object') return [];
	return Object.entries(record);
}

function clear(node) {
	node.replaceChildren();
}

function choiceButton(label, pressed, onClick) {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'advanced-create__choice';
	button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
	button.textContent = label;
	button.addEventListener('click', onClick);
	return button;
}

/**
 * Desktop advanced create. The form is whatever the selected config node lists.
 * @param {{ outlet: HTMLElement, output?: string }} args
 */
export function mountAdvancedCreate({ outlet, output = 'image' } = {}) {
	const root = mountTemplate(outlet, template);
	const refs = bindRefs(root);
	let closed = false;
	let config = null;
	let outputKey = output;
	let modelId = '';
	let modelSelect = null;

	function outputNode() {
		return config?.[outputKey] || null;
	}

	function models() {
		const node = outputNode();
		if (Array.isArray(node?.models)) return node.models;
		return [];
	}

	function fieldValue(key) {
		const control = refs.form.elements.namedItem(key);
		if (!control) return '';
		if (control instanceof HTMLInputElement && control.type === 'checkbox') return control.checked ? 'true' : '';
		return 'value' in control ? String(control.value || '').trim() : '';
	}

	function optionFor(field, values) {
		const options = Array.isArray(field?.options) ? field.options : [];
		const value = values ? (values.get(field?.key) || '') : fieldValue(field?.key);
		return options.find((option) => String(option?.value ?? '') === value) || options[0] || null;
	}

	function visibleFields(model, values) {
		const fields = [];
		const extras = [];
		for (const field of model?.fields || []) {
			fields.push(field);
			const extra = optionFor(field, values)?.fields;
			if (Array.isArray(extra)) extras.push(...extra);
		}
		return fields.concat(extras);
	}

	function activeRoutes(model) {
		for (const field of model?.fields || []) {
			const routes = optionFor(field)?.routes;
			if (routes && typeof routes === 'object') return routes;
		}
		return model?.routes && typeof model.routes === 'object' ? model.routes : null;
	}

	function activeCredits(model) {
		for (const field of model?.fields || []) {
			const credits = optionFor(field)?.credits;
			if (credits != null) return credits;
		}
		return model?.credits;
	}

	function activeServer(model) {
		for (const field of model?.fields || []) {
			const server = optionFor(field)?.server;
			if (server) return server;
		}
		return model?.server || '';
	}

	function resolveRoute(model) {
		const routes = activeRoutes(model);
		if (!routes) {
			if (!model?.method) return null;
			return { role: '', method: model.method, model: model.model };
		}
		const filled = new Set();
		for (const field of visibleFields(model)) {
			if (!field.role || field.role === 'text') continue;
			if (fieldValue(field.key)) filled.add(field.role);
		}
		for (const role of ROUTE_ROLES) {
			if (role !== 'text' && filled.has(role) && routes[role]) return concreteRoute(role, routes[role]);
		}
		if (routes.text) return concreteRoute('text', routes.text);
		const [role, route] = Object.entries(routes)[0] || [];
		return route ? concreteRoute(role, route) : null;
	}

	function concreteRoute(role, route) {
		const model = route.modelField ? fieldValue(route.modelField) : route.model;
		return { role, method: route.method, model: model || '' };
	}

	function selectedModel() {
		const list = models();
		if (list.length) return list.find((model) => model.id === modelId) || list[0];
		const node = outputNode();
		return node?.fields ? node : null;
	}

	function collectValues() {
		const values = new Map();
		for (const element of refs.form.elements) {
			if (!element.name) continue;
			if (element instanceof HTMLInputElement && element.type === 'checkbox') values.set(element.name, element.checked ? 'true' : '');
			else if ('value' in element) values.set(element.name, element.value);
		}
		return values;
	}

	function releaseFields() {
		for (const select of refs.form.querySelectorAll('.advanced-create__select')) {
			if (refs.model?.contains(select)) continue;
			select.listSelect?.destroy();
		}
		for (const media of refs.form.querySelectorAll('[data-advanced-create-media]')) media.mediaPicker?.destroy();
	}

	function fieldPlace(field) {
		if (field.key === 'variant' || field.key === 'finetune') return 'selection';
		if (field.key === 'prompt' || field.key === 'lyrics') return 'workspace';
		if (field.key === 'aspect_ratio' || field.type === 'image' || field.type === 'audio' || field.type === 'video') return 'setting';
		return 'more';
	}

	function renderFields(model, preserved = collectValues()) {
		refs.route.remove();
		releaseFields();
		for (const child of [...refs.form.children]) {
			if (child !== refs.selection) child.remove();
		}
		for (const row of [...refs.selection.children]) {
			if (row !== refs['model-field']) row.remove();
		}
		const fields = visibleFields(model, preserved);
		const hasWorkspace = fields.some((field) => fieldPlace(field) === 'workspace');
		const settings = document.createElement('div');
		settings.className = 'advanced-create__settings';
		const moreFields = document.createElement('div');
		moreFields.className = 'advanced-create__surface';
		const more = document.createElement('div');
		more.className = 'advanced-create__more-body';
		for (const field of fields) {
			const place = fieldPlace(field);
			const node = mountField(field, preserved.get(field.key));
			if (place === 'selection') {
				node.classList.add('advanced-create__row');
				refs.selection.append(node);
			} else if (place === 'workspace') {
				node.classList.add('advanced-create__workspace');
				refs.form.append(node);
			} else if (place === 'setting') {
				node.classList.add('advanced-create__setting');
				settings.append(node);
			} else if (hasWorkspace) {
				node.classList.add('advanced-create__row');
				moreFields.append(node);
			} else {
				node.classList.add('advanced-create__setting');
				settings.append(node);
			}
		}
		if (moreFields.childElementCount) more.append(moreFields);
		more.append(refs.route);
		const details = document.createElement('details');
		details.className = 'advanced-create__more';
		const summary = document.createElement('summary');
		summary.append('More');
		const names = [...moreFields.children]
			.map((node) => node.querySelector('.advanced-create__label')?.textContent?.trim())
			.filter(Boolean);
		if (names.length) {
			const hint = document.createElement('span');
			hint.className = 'advanced-create__more-hint';
			hint.textContent = names.join(', ');
			summary.append(hint);
		}
		details.append(summary, more);
		if (settings.childElementCount) refs.form.append(settings);
		refs.form.append(details);
		refs.selection.hidden = refs['model-field'].hidden && refs.selection.children.length < 2;
	}

	function renderRoute(model) {
		const route = resolveRoute(model);
		let text = '';
		if (model && route) {
			const creditsValue = activeCredits(model);
			const credits = creditsValue != null ? ` · ${creditsValue} credits` : '';
			const role = route.role ? `${route.role} · ` : '';
			const modelName = route.model ? ` · ${route.model}` : '';
			text = `${activeServer(model)} · ${role}${route.method}${modelName}${credits}`;
		}
		refs.route.textContent = text;
		refs.route.hidden = !text;
		const details = refs.route.closest('.advanced-create__more');
		if (!details) return;
		const body = details.querySelector('.advanced-create__more-body');
		details.hidden = ![...body.children].some((child) => !child.hidden);
	}

	function render() {
		const outputEntries = entries(config);
		const list = models();
		refs.status.hidden = true;
		refs.outputs.hidden = false;
		refs['model-field'].hidden = list.length === 0;
		clear(refs.outputs);
		for (const [key] of outputEntries) {
			refs.outputs.append(choiceButton(OUTPUT_LABELS[key] || key, key === outputKey, () => {
				outputKey = key;
				modelId = '';
				render();
			}));
		}
		const model = selectedModel();
		const modelOptions = list.map((item) => ({ label: item.label, value: item.id, section: item.section }));
		if (!modelSelect) {
			modelSelect = mountListSelect({
				options: modelOptions,
				value: model?.id || '',
				onChange(value) {
					modelId = value;
					const next = selectedModel();
					renderFields(next);
					renderRoute(next);
				},
			});
			refs.model.replaceChildren(modelSelect.root);
		} else {
			modelSelect.setOptions(modelOptions, model?.id || '');
		}
		if (!list.length) modelSelect.close();
		renderFields(model);
		renderRoute(model);
	}

	refs.form.addEventListener('input', (event) => {
		const model = selectedModel();
		const field = (model?.fields || []).find((item) => item.key === event.target?.name);
		const changesFields = field?.type === 'select' && (field.options || []).some((option) => Array.isArray(option?.fields));
		if (changesFields) renderFields(model, collectValues());
		renderRoute(model);
	});

	loadAdvancedConfig()
		.then((data) => {
			if (closed) return;
			config = data;
			if (!config?.[outputKey]) outputKey = entries(config)[0]?.[0] || '';
			modelId = '';
			render();
		})
		.catch((error) => {
			if (closed) return;
			refs.status.hidden = false;
			refs.status.textContent = error?.message || 'Could not load create config.';
		});

	return {
		destroy() {
			closed = true;
			for (const select of root.querySelectorAll('.advanced-create__select')) {
				select.listSelect?.destroy();
			}
			for (const media of root.querySelectorAll('[data-advanced-create-media]')) media.mediaPicker?.destroy();
			root.remove();
		},
	};
}
