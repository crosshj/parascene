import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildThreadMetaWithChannelPin,
	getChannelPinnedMessageIdFromThreadRow,
	viewerCanPinChannelMessages,
} from '../shared/channelPin.js';

test('channel pin helpers read and clear meta.channel_pin', () => {
	assert.equal(getChannelPinnedMessageIdFromThreadRow({ meta: { channel_pin: { message_id: 12 } } }), 12);
	assert.equal(getChannelPinnedMessageIdFromThreadRow({ meta: {} }), null);
	const cleared = buildThreadMetaWithChannelPin({ channel_pin: { message_id: 12 }, other: 1 }, null);
	assert.equal(cleared.channel_pin, undefined);
	assert.equal(cleared.other, 1);
	const set = buildThreadMetaWithChannelPin({}, 9, 3);
	assert.equal(set.channel_pin.message_id, 9);
	assert.equal(set.channel_pin.pinned_by, 3);
});

test('viewerCanPinChannelMessages allows admin and oceanman', () => {
	assert.equal(viewerCanPinChannelMessages({ role: 'admin' }, { user_name: 'anyone' }), true);
	assert.equal(viewerCanPinChannelMessages({ role: 'consumer' }, { user_name: 'oceanman' }), true);
	assert.equal(viewerCanPinChannelMessages({ role: 'consumer' }, { user_name: 'alice' }), false);
});
