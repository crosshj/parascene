export function htmlFragment(source) {
	return document.createRange().createContextualFragment(String(source || '').trim());
}

/** Clone an imported native <template>; direct markup is supported for view roots. */
export function cloneTemplate(source) {
	const holder = document.createElement('template');
	holder.innerHTML = String(source || '').trim();
	const importedTemplate = holder.content.firstElementChild;
	return importedTemplate instanceof HTMLTemplateElement
		? importedTemplate.content.cloneNode(true)
		: holder.content.cloneNode(true);
}

export function cloneTemplateElement(template) {
	if (!(template instanceof HTMLTemplateElement)) throw new Error('Expected an HTML template element');
	return template.content.cloneNode(true);
}

export function mountTemplate(outlet, source) {
	const fragment = htmlFragment(source);
	const root = fragment.firstElementChild;
	if (!(root instanceof Element)) throw new Error('View template must have an element root');
	outlet.replaceChildren(fragment);
	return root;
}

export function bindRefs(root) {
	const refs = Object.create(null);
	const elements = root.matches?.('[data-ref]') ? [root, ...root.querySelectorAll('[data-ref]')] : [...root.querySelectorAll('[data-ref]')];
	for (const element of elements) {
		const name = element.getAttribute('data-ref')?.trim();
		if (!name) continue;
		if (refs[name]) throw new Error(`Duplicate data-ref: ${name}`);
		refs[name] = element;
	}
	return refs;
}

export function escapeHtml(value) {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
