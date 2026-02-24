/**
 * Landing page: nav only (Login / Sign up in header).
 */

import '../components/navigation/index.js';

import { waitForComponents } from '../shared/pageInit.js';

export async function init() {
	await waitForComponents(['app-navigation']);
}
