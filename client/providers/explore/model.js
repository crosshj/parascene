export function mergeExploreSearchKeywordSemantic(keyword, semantic, preferSemanticFirst) {
		const k = 60;
		const keywordItems = Array.isArray(keyword) ? keyword : [];
		const semanticItems = Array.isArray(semantic) ? semantic : [];
		const keywordRank = new Map();
		keywordItems.forEach((item, i) => {
			const id = item?.created_image_id ?? item?.id;
			if (id != null) keywordRank.set(Number(id), i + 1);
		});
		const semanticRank = new Map();
		semanticItems.forEach((item, i) => {
			const id = item?.created_image_id ?? item?.id;
			if (id != null) semanticRank.set(Number(id), i + 1);
		});
		function scoreForItem(item) {
			const id = item?.created_image_id ?? item?.id;
			if (id == null) return null;
			const n = Number(id);
			const sk = keywordRank.has(n) ? 1 / (k + keywordRank.get(n)) : 0;
			const ss = semanticRank.has(n) ? 1 / (k + semanticRank.get(n)) : 0;
			return sk + ss;
		}
		if (keywordItems.length > 0 && semanticItems.length > 0) {
			const firstList = preferSemanticFirst ? semanticItems : keywordItems;
			const secondList = preferSemanticFirst ? keywordItems : semanticItems;
			const firstIds = new Set(firstList.map((i) => i?.created_image_id ?? i?.id).filter(Boolean));
			const appended = secondList.filter((i) => !firstIds.has(i?.created_image_id ?? i?.id));
			return [...firstList, ...appended].map((item) => {
				const s = scoreForItem(item);
				return s != null ? { ...item, searchScore: s } : item;
			});
		}
		if (keywordItems.length > 0) {
			return keywordItems.map((item, i) => ({ ...item, searchScore: 1 / (k + i + 1) }));
		}
		if (semanticItems.length > 0) {
			return semanticItems.map((item, i) => ({ ...item, searchScore: 1 / (k + i + 1) }));
		}
		return [];
	}
