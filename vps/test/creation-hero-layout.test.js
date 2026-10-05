import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { applyInitialDetailHeroLayout, releaseDetailHeroLayout } from '../client/views/CreationDetail/heroLayout.js';

test('detail stays hidden without dimensions and reserves known aspect before revealing', () => {
	const dom = new JSDOM('<main class="creation-detail-layout-pending"><div class="creation-detail-image-wrapper"></div></main>');
	const wrapper = dom.window.document.querySelector('div');
	const main = wrapper.closest('main');
	try {
		assert.equal(applyInitialDetailHeroLayout(wrapper, {}), false);
		assert.ok(main.classList.contains('creation-detail-layout-pending'));
		assert.equal(applyInitialDetailHeroLayout(wrapper, { width: 1600, height: 900 }), true);
		assert.equal(wrapper.style.getPropertyValue('--hero-aspect-ratio'), '1600 / 900');
		assert.ok(wrapper.classList.contains('hero-layout-landscape'));
		assert.equal(main.classList.contains('creation-detail-layout-pending'), false);
		assert.equal(applyInitialDetailHeroLayout(wrapper, {}), false);
		assert.equal(wrapper.style.getPropertyValue('--hero-aspect-ratio'), '1600 / 900');
		main.classList.add('creation-detail-layout-pending');
		releaseDetailHeroLayout(wrapper);
		assert.equal(main.classList.contains('creation-detail-layout-pending'), false);
	} finally { dom.window.close(); }
});

test('detail sizing uses the selected group cover and job aspect ratio before image loading', () => {
	const dom = new JSDOM('<main class="creation-detail-layout-pending"><div></div></main>');
	const wrapper = dom.window.document.querySelector('div');
	try {
		assert.ok(applyInitialDetailHeroLayout(wrapper, { width: 1024, height: 1024, meta: { group: {
			kind: 'group_creations', cover_source_id: 2, source_creations: [{ id: 1, width: 1024, height: 1024 }, { id: 2, width: 900, height: 1600 }]
		} } }));
		assert.ok(wrapper.classList.contains('hero-layout-portrait'));
		assert.equal(wrapper.style.getPropertyValue('--hero-aspect-ratio'), '900 / 1600');
		assert.ok(applyInitialDetailHeroLayout(wrapper, { meta: { args: { aspect_ratio: '16:9' } } }));
		assert.ok(wrapper.classList.contains('hero-layout-landscape'));
	} finally { dom.window.close(); }
});
