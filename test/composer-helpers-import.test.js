import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';
import { composerEnterShouldSend } from '../client/shared/composerEnterGuard.js';
import { clearCreateWorkflowHost, setCreateWorkflowHost } from '../client/shared/createWorkflowHost.js';

const loader = `data:text/javascript,${encodeURIComponent(`
	export async function load(url, context, nextLoad) {
		if (url.endsWith('.css')) return { format: 'module', source: 'export default "";', shortCircuit: true };
		return nextLoad(url, context);
	}
`)}`;
register(loader);

const { openImportMediaModal } = await import('../client/shared/importSunoModal.js');
const { syncChatComposerSuggestCaches } = await import('../client/shared/chatComposerSuggestCaches.js');
const { orderCreateComposerItemsForPopup } = await import('../client/shared/triggeredSuggest.js');
const { createConversationController } = await import('../client/components/Messages/ConversationController.js');
const { createQuery } = await import('../client/core/query.js');

const root = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(root, '../client');

test('create composer @ list keeps people above personas (and styles last)', () => {
	const ordered = orderCreateComposerItemsForPopup([
		{ type: 'persona', id: 'persona:p1', label: 'P1' },
		{ type: 'style', id: 'style:s1', label: 'S1' },
		{ type: 'user', id: '1', label: 'Ada' },
		{ type: 'persona', id: 'persona:p2', label: 'P2' },
		{ type: 'user', id: '2', label: 'Bob' },
	]);
	assert.deepEqual(
		ordered.map((item) => item.id),
		['1', '2', 'persona:p1', 'persona:p2', 'style:s1']
	);
});

test('composer Enter skips send while the suggest popup is open', () => {
	const enter = { key: 'Enter', shiftKey: false, isComposing: false };
	assert.equal(
		composerEnterShouldSend(enter, {
			field: {},
			isSuggestOpen: () => true,
			finePointerMatches: true,
		}),
		false
	);
	assert.equal(
		composerEnterShouldSend(enter, {
			field: {},
			isSuggestOpen: () => false,
			finePointerMatches: true,
		}),
		true
	);
	assert.equal(composerEnterShouldSend({ ...enter, shiftKey: true }, { finePointerMatches: true }), false);
	assert.equal(composerEnterShouldSend(enter, { finePointerMatches: false }), false);
});

test('message composer wires chat suggest attach and Enter guard', () => {
	const src = fs.readFileSync(path.join(clientRoot, 'components/Messages/Composer.js'), 'utf8');
	assert.match(src, /attachChatComposerSuggest\s*\(\s*input\s*\)/);
	assert.match(src, /composerEnterShouldSend/);
	assert.match(src, /isTriggeredSuggestPopupOpen/);
});

test('Basic Create wires prompt fields with $style-capable attachPromptInlineSuggest', () => {
	const src = fs.readFileSync(path.join(clientRoot, 'views/Create/BasicCreate.js'), 'utf8');
	assert.match(src, /attachPromptInlineSuggest/);
	assert.match(src, /attachPromptInlineSuggest\s*\(\s*el\s*\)/);
	assert.doesNotMatch(src, /attachMentionSuggest\s*\(\s*el\s*\)/);
});

test('import media modal portals under create-workflow-root when Create host is absent', () => {
	const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/feed', pretendToBeVisual: true });
	const previous = {
		document: globalThis.document,
		HTMLElement: globalThis.HTMLElement,
		HTMLInputElement: globalThis.HTMLInputElement,
		HTMLButtonElement: globalThis.HTMLButtonElement,
		requestAnimationFrame: globalThis.requestAnimationFrame,
	};
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.HTMLInputElement = dom.window.HTMLInputElement;
	globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
	globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
	clearCreateWorkflowHost();

	const handle = openImportMediaModal();
	const overlay = dom.window.document.querySelector('[data-import-suno-modal]');
	assert.ok(overlay);
	const portal = overlay.parentElement;
	assert.equal(portal?.classList.contains('create-workflow-root'), true);
	assert.equal(portal?.dataset.modalPortal, 'import-suno');
	assert.equal(portal?.parentElement, dom.window.document.body);
	handle.close();
	assert.equal(dom.window.document.querySelector('[data-import-suno-modal]'), null);
	assert.equal(dom.window.document.querySelector('[data-modal-portal="import-suno"]'), null);

	const host = dom.window.document.createElement('div');
	host.className = 'create-workflow-root create-page';
	dom.window.document.body.append(host);
	setCreateWorkflowHost({ root: host });
	const hosted = openImportMediaModal();
	const hostedOverlay = host.querySelector('[data-import-suno-modal]');
	assert.ok(hostedOverlay);
	assert.equal(hostedOverlay.parentElement, host);
	assert.equal(dom.window.document.querySelector('[data-modal-portal="import-suno"]'), null);
	hosted.close();
	clearCreateWorkflowHost();
	for (const [key, value] of Object.entries(previous)) {
		if (value === undefined) delete globalThis[key];
		else globalThis[key] = value;
	}
	dom.window.close();
});

test('conversation start syncs chat suggest caches from inbox roster', async () => {
	const settle = () => new Promise((resolve) => setImmediate(resolve));
	const inbox = {
		threads: [
			{ id: 7, type: 'channel', channel_slug: 'general', title: '#general' },
			{ id: 8, type: 'channel', channel_slug: 'feedback', title: 'Feedback' },
		],
		servers: [{ id: 2, name: 'Studio One' }],
	};
	const query = createQuery({
		load: async () => ({
			messages: [{ id: 1, sender_id: 9, sender_user_name: 'ada', sender_display_name: 'Ada' }],
			hasMore: false,
			nextBefore: null,
		}),
	});
	const provider = {
		query: createQuery({ initialData: inbox, load: async () => inbox }),
		acquireMessages: () => ({
			query,
			release() {
				query.destroy();
			},
		}),
		send: async () => ({ id: 2 }),
	};
	const view = { render() {}, setStatus() {}, setReady() {}, setThread() {} };
	const controller = createConversationController({
		view,
		provider,
		route: { kind: 'channel', slug: 'general' },
		viewerId: 1,
	});
	await settle();
	assert.doesNotThrow(() =>
		syncChatComposerSuggestCaches({
			thread: inbox.threads[0],
			inbox,
			messages: [{ id: 1, sender_id: 9, sender_user_name: 'ada', sender_display_name: 'Ada' }],
		})
	);
	controller.destroy();
});
