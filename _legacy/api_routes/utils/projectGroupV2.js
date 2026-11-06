/** Project sits on a group v2. Group v2 itself is generic — see groupV2.js. */

export {
	GROUP_V2_KIND,
	HIDDEN_IN_GROUP_META_KEY,
	HIDDEN_IN_PROJECT_META_KEY,
	DESKTOP_HEADER,
	appendItems,
	applyCostumeToCreationPayload,
	costumeGroupV2Meta as costumeProjectV2Meta,
	groupActionSupported,
	groupActionSupportedForMeta,
	coverItem,
	creationPointer,
	groupV2Items,
	groupV2RejectMessage,
	isGroupV2Meta,
	isGroupV2Row,
	isHiddenInGroupMeta,
	itemFromCreationRow,
	itemFromLocal,
	localPointer,
	localUri,
	memberCreationIds,
	normalizeItem,
	normalizeItems,
	normalizePointer,
	parseLocalUri,
	parseMeta,
	removeItems,
	setCoverItem,
	wantsRawGroupV2,
	withHiddenInGroup,
	withoutHiddenInGroup,
	withUpdatedItems,
} from "./groupV2.js";

import {
	emptyGroupV2Meta,
	groupV2Items,
	groupV2RejectMessage,
	isGroupV2Meta,
	isHiddenInGroupMeta,
	normalizeGroupSupported,
	parseMeta,
	PROJECT_GROUP_SUPPORTED,
	withHiddenInGroup,
	withoutHiddenInGroup,
	withUpdatedItems,
} from "./groupV2.js";

export const PROJECT_TYPE = "project";

export function wantsProjectGroupType(body) {
	const type = String(body?.type ?? body?.creation_type ?? "").trim();
	return type === PROJECT_TYPE;
}

export function isProjectV2Meta(meta) {
	const type = String(meta?.type || meta?.creation_type || "").trim();
	return type === PROJECT_TYPE && isGroupV2Meta(meta);
}

export function isProjectV2Row(row) {
	return isProjectV2Meta(parseMeta(row?.meta));
}

export function emptyProjectV2Meta(opts = {}) {
	return {
		...emptyGroupV2Meta({
			...opts,
			badge: typeof opts.badge === "string" && opts.badge.trim() ? opts.badge.trim() : "project",
			supported: {
				...PROJECT_GROUP_SUPPORTED,
				...(normalizeGroupSupported(opts.supported) || {}),
			},
		}),
		type: PROJECT_TYPE,
		creation_type: PROJECT_TYPE,
		media_type: "image",
		publish_forbidden: true,
	};
}

export function projectV2Items(meta) {
	return groupV2Items(meta);
}

export function isHiddenInProjectMeta(meta) {
	return isHiddenInGroupMeta(meta);
}

export function withHiddenInProject(meta, projectId) {
	return withHiddenInGroup(meta, projectId);
}

export function withoutHiddenInProject(meta) {
	return withoutHiddenInGroup(meta);
}

export function projectRejectMessage(action) {
	if (action === "publish") return "Projects cannot be published";
	if (action === "remix") return "Projects cannot be remixed";
	if (action === "ungroup") return groupV2RejectMessage("ungroup");
	if (action === "group") return groupV2RejectMessage("group");
	return "This project cannot be changed that way";
}

export function withUpdatedProjectItems(meta, items, extra = {}) {
	return withUpdatedItems(
		{
			...meta,
			type: PROJECT_TYPE,
			creation_type: PROJECT_TYPE,
			publish_forbidden: true,
		},
		items,
		extra,
	);
}
