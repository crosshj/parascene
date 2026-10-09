import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

const loader = `data:text/javascript,${encodeURIComponent(`
	export async function load(url, context, nextLoad) {
		if (url.endsWith('.css')) return { format: 'module', source: 'export default "";', shortCircuit: true };
		return nextLoad(url, context);
	}
`)}`;
register(loader);
const { createSidebarModel } = await import('../client/views/Sidebar/SidebarModel.js');

test('copies the feedback channel unread onto the sidebar item', () => {
	const model = createSidebarModel({}, {
		threads: [
			{ type: 'channel', id: 4, channel_slug: 'feedback', unread_count: 3, last_message: { id: 9 } },
			{ type: 'channel', id: 8, channel_slug: 'general', unread_count: 1, last_message: { id: 2 } },
		],
		unreadSummary: { challenges_unread: 0 },
	});
	assert.equal(model.navigation.find((item) => item.id === 'feedback').unread, 3);
	assert.equal(model.channels.some((item) => item.label === '#feedback'), false);
});
