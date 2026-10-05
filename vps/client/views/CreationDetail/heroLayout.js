import { applyHeroAspectLayoutToElement, aspectRatioFromCreation, normalizeCreationMeta } from '../../shared/aspectRatio.js';

export function detailHeroRecord(record) {
	const meta = normalizeCreationMeta(record?.meta);
	const group = meta?.group;
	if (group?.kind === 'group_creations') {
		const sources = Array.isArray(group.source_creations) ? group.source_creations : [];
		return sources.find(source => Number(source.id) === Number(group.cover_source_id)) || sources[0] || record;
	}
	if (group?.kind === 'group_v2') {
		const items = Array.isArray(group.items) ? group.items : [];
		const view = (items.find(item => item.cover) || items[0])?.view;
		if (view) return { ...view, meta: { media_type: view.mediaType, args: view.args } };
	}
	return record;
}

export function applyInitialDetailHeroLayout(wrapper, record) {
	if (!wrapper) return false;
	const heroRecord = detailHeroRecord(record);
	if (aspectRatioFromCreation(heroRecord).source === 'default') return false;
	applyHeroAspectLayoutToElement(wrapper, heroRecord);
	wrapper.dataset.heroLayoutKnown = '1';
	wrapper.closest('main')?.classList.remove('creation-detail-layout-pending');
	return true;
}

export function releaseDetailHeroLayout(wrapper) {
	wrapper?.closest('main')?.classList.remove('creation-detail-layout-pending');
}
