import assert from 'node:assert/strict';
import test from 'node:test';
import createLibraryFoldersRoutes from '../server/routes/libraryFolders.js';
import createGroupV2Routes from '../server/routes/groupV2.js';
import createRepairRoutes from '../server/routes/createRepair.js';
import createCreateRoutes from '../server/routes/create.js';
import sharp from 'sharp';
import { normalizeLibraryFolderOperations } from '../server/routes/utils/libraryFolders.js';

function handler(router, method, path) {
	const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
	assert.ok(layer, `${method.toUpperCase()} ${path} is mounted`);
	return layer.route.stack[0].handle;
}

async function call(handle, req) {
	const res = {
		statusCode: 200,
		headers: {},
		status(code) { this.statusCode = code; return this; },
		set(name, value) { this.headers[name] = value; return this; },
		json(body) { this.body = body; return this; },
	};
	await handle(req, res, (error) => { throw error; });
	return res;
}

test('desktop folder sync returns snapshots and conflict revisions', async () => {
	const snapshot = { revision: 3, folders: [{ id: 'f', title: 'Folder', creation_ids: [12] }] };
	const router = createLibraryFoldersRoutes({ queries: {
		getLibraryFoldersSnapshot: { get: async (id) => { assert.equal(id, 7); return snapshot; } },
		mutateLibraryFolders: { run: async (id, revision, operations) => {
			assert.equal(id, 7);
			assert.equal(revision, 2);
			assert.equal(operations[0].op, 'delete');
			return { ...snapshot, ok: false, error: 'conflict' };
		} },
	} });
	const get = await call(handler(router, 'get', '/api/library/folders'), { auth: { userId: 7 } });
	assert.equal(get.statusCode, 200);
	assert.equal(get.body.folders[0].member_count, 1);
	const post = await call(handler(router, 'post', '/api/library/folders/mutate'), {
		auth: { userId: 7 }, body: { base_revision: 2, operations: [{ op: 'delete', id: 'c7826d84-92b2-42b5-92db-473662b51a77' }] },
	});
	assert.equal(post.statusCode, 409);
	assert.equal(post.body.revision, 3);
	assert.equal(normalizeLibraryFolderOperations([{ op: 'move', folder_id: null, creation_ids: [12] }]).operations[0].folder_id, null);
});

test('desktop group and repair routes require a signed-in user', async () => {
	const group = createGroupV2Routes({ queries: {} });
	const repair = createRepairRoutes({ queries: {}, storage: {} });
	for (const [router, method, path] of [
		[group, 'post', '/api/create/group'],
		[group, 'patch', '/api/create/group/:id'],
		[repair, 'post', '/api/create/images/repair-group-aspect'],
		[repair, 'post', '/api/create/images/repair-fit-thumbnails'],
	]) {
		const response = await call(handler(router, method, path), { body: {}, params: {} });
		assert.equal(response.statusCode, 401, path);
	}
});

test('desktop can upload a native-aspect fit thumbnail for its own creation', async () => {
	const image = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#123456' } }).jpeg().toBuffer();
	let saved = null;
	const router = createCreateRoutes({
		queries: { selectCreatedImageById: { get: async (id, userId) => {
			assert.equal(id, 42);
			assert.equal(userId, 7);
			return { id, filename: '7_42_cover.jpg' };
		} } },
		storage: { uploadFitThumbnail: async (buffer, filename) => { saved = { buffer, filename }; } },
		canUseServer: async () => true,
	});
	const response = await call(handler(router, 'post', '/api/create/images/:id/fit-thumbnail'), {
		auth: { userId: 7 }, params: { id: '42' }, body: { image_base64: image.toString('base64') },
	});
	assert.equal(response.statusCode, 200);
	assert.equal(response.body.from_client, true);
	assert.equal(saved.filename, '7_42_cover.jpg');
	assert.deepEqual(saved.buffer, image);
});
