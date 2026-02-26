/**
 * Auth page: no web components in body; just show page.
 */

import { waitForComponents } from '../shared/pageInit.js';

export async function init() {
	await waitForComponents([]);
}
