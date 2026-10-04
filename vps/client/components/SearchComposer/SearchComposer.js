import markup from './SearchComposer.html';
import './SearchComposer.css';
import { createTemplateFactory } from '../../utils/dom.js';
const clone = createTemplateFactory(markup);
export function createSearchComposerElement() { return clone('search-composer'); }

export function bindSearchComposer({ form, onSearch }) {
 const input = form.querySelector('input'), clear = form.querySelector('[data-search-clear]');
 const sync = () => { clear.hidden = !input.value; };
 const submit = event => { event.preventDefault(); onSearch(input.value); };
 const reset = () => { input.value = ''; sync(); onSearch(''); input.focus(); };
 form.addEventListener('submit', submit); clear.addEventListener('click', reset); input.addEventListener('input', sync);
 return { setQuery(value) { input.value = value; sync(); }, destroy() { form.removeEventListener('submit', submit); clear.removeEventListener('click', reset); input.removeEventListener('input', sync); input.value = ''; sync(); } };
}
