let formatDateTime;
let formatRelativeTime;
let enableLikeButtons;
let getCreationLikeCount;
let initLikeButton;
let fetchJsonWithStatusDeduped;
let getAvatarColor;
let fetchCreatedImageActivity;
let postCreatedImageComment;
let toggleCommentReaction;
let deleteCreatedImageComment;
let updateCreatedImageComment;
let processUserText;
let hydrateUserTextLinks;
let hydrateRichUserTextEmbeds;
let attachAutoGrowTextarea;
let attachMentionSuggest;
let isTriggeredSuggestPopupOpen;
let addPageUsers;
let clearPageUsers;
let textsSameWithinTolerance;
let buildProfilePath;
let getNsfwObscure;
let NSFW_VIEW_BODY_CLASS;
let addToMutateQueue;
let loadMutateQueue;
let removeFromMutateQueueByImageUrl;
let openQueueFromFrameModal;
let showToast;
let creditIcon;
let eyeHiddenIcon;
let shareIcon;
let sparkleIcon;
let sendIcon;
let plusIcon;
let REACTION_ORDER;
let REACTION_ICONS;
let smileIcon;
let replyTurnIcon;
let plainTextReplyPreview;
let renderEmptyState;
let renderEmptyLoading;
let renderEmptyError;
let skeletonLine;
let skeletonCircle;
let skeletonPill;
let buildCreationCardShell;
let renderCommentAvatarHtml;
let uploadImageFile;
let createReplyIndicatorElement;

function getAssetVersionParam() {
	const meta = document.querySelector('meta[name="asset-version"]');
	return meta?.getAttribute('content')?.trim() || '';
}

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

/** @type {typeof import('/shared/chatInlineImageLightbox.js') | null} */
let creationDetailInlineLightboxMod = null;
/** @type {typeof import('/shared/safeMediaPlay.js').safeMediaPlay | null} */
let safeMediaPlay = null;

let _depsPromise;
async function loadDeps() {
	if (_depsPromise) return _depsPromise;
	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	_depsPromise = (async () => {
		const datetimeMod = await import(`/shared/datetime.js${qs}`);
		formatDateTime = datetimeMod.formatDateTime;
		formatRelativeTime = datetimeMod.formatRelativeTime;

		const likesMod = await import(`/shared/likes.js${qs}`);
		enableLikeButtons = likesMod.enableLikeButtons;
		getCreationLikeCount = likesMod.getCreationLikeCount;
		initLikeButton = likesMod.initLikeButton;

		const apiMod = await import(`/shared/api.js${qs}`);
		fetchJsonWithStatusDeduped = apiMod.fetchJsonWithStatusDeduped;

		const avatarMod = await import(`/shared/avatar.js${qs}`);
		getAvatarColor = avatarMod.getAvatarColor;

		const commentsMod = await import(`/shared/comments.js${qs}`);
		fetchCreatedImageActivity = commentsMod.fetchCreatedImageActivity;
		postCreatedImageComment = commentsMod.postCreatedImageComment;
		toggleCommentReaction = commentsMod.toggleCommentReaction;
		deleteCreatedImageComment = commentsMod.deleteCreatedImageComment;
		updateCreatedImageComment = commentsMod.updateCreatedImageComment;

		const replyUiMod = await import(`/shared/replyIndicatorUi.js${qs}`);
		createReplyIndicatorElement = replyUiMod.createReplyIndicatorElement;

		const userTextMod = await import(`/shared/userText.js${qs}`);
		processUserText = userTextMod.processUserText;
		hydrateUserTextLinks = userTextMod.hydrateUserTextLinks;
		hydrateRichUserTextEmbeds = userTextMod.hydrateRichUserTextEmbeds;

		creationDetailInlineLightboxMod = await import(`/shared/chatInlineImageLightbox.js${qs}`);

		const safeMediaPlayMod = await import(`/shared/safeMediaPlay.js${qs}`);
		safeMediaPlay = safeMediaPlayMod.safeMediaPlay;

		const autogrowMod = await import(`/shared/autogrow.js${qs}`);
		attachAutoGrowTextarea = autogrowMod.attachAutoGrowTextarea;

		const suggestMod = await import(`/shared/triggeredSuggest.js${qs}`);
		attachMentionSuggest = suggestMod.attachMentionSuggest;
		isTriggeredSuggestPopupOpen = suggestMod.isTriggeredSuggestPopupOpen;
		addPageUsers = suggestMod.addPageUsers;
		clearPageUsers = suggestMod.clearPageUsers;

		const textCompareMod = await import(`/shared/textCompare.js${qs}`);
		textsSameWithinTolerance = textCompareMod.textsSameWithinTolerance;

		const profileLinksMod = await import(`/shared/profileLinks.js${qs}`);
		buildProfilePath = profileLinksMod.buildProfilePath;

		const nsfwMod = await import(`/shared/nsfwView.js${qs}`);
		getNsfwObscure = nsfwMod.getNsfwObscure;
		NSFW_VIEW_BODY_CLASS = nsfwMod.NSFW_VIEW_BODY_CLASS;

		const mutateQueueMod = await import(`/shared/mutateQueue.js${qs}`);
		addToMutateQueue = mutateQueueMod.addToMutateQueue;
		loadMutateQueue = mutateQueueMod.loadMutateQueue;
		removeFromMutateQueueByImageUrl = mutateQueueMod.removeFromMutateQueueByImageUrl;

		const queueFromFrameMod = await import(`/shared/queueFromFrameModal.js${qs}`);
		openQueueFromFrameModal = queueFromFrameMod.openQueueFromFrameModal;

		const toastMod = await import(`/shared/toast.js${qs}`);
		showToast = toastMod.showToast;

		const iconsMod = await import(`../icons/svg-strings.js${qs}`);
		creditIcon = iconsMod.creditIcon;
		eyeHiddenIcon = iconsMod.eyeHiddenIcon;
		shareIcon = iconsMod.shareIcon;
		sparkleIcon = iconsMod.sparkleIcon;
		sendIcon = iconsMod.sendIcon;
		plusIcon = iconsMod.plusIcon;
		REACTION_ORDER = iconsMod.REACTION_ORDER;
		REACTION_ICONS = iconsMod.REACTION_ICONS;
		smileIcon = iconsMod.smileIcon;
		replyTurnIcon = iconsMod.replyTurnIcon;

		const replyPreviewMod = await import(`/shared/plainTextReplyPreview.js${qs}`);
		plainTextReplyPreview = replyPreviewMod.plainTextReplyPreview;

		const emptyStateMod = await import(`/shared/emptyState.js${qs}`);
		renderEmptyState = emptyStateMod.renderEmptyState;
		renderEmptyLoading = emptyStateMod.renderEmptyLoading;
		renderEmptyError = emptyStateMod.renderEmptyError;

		const skeletonMod = await import(`/shared/skeleton.js${qs}`);
		skeletonLine = skeletonMod.skeletonLine;
		skeletonCircle = skeletonMod.skeletonCircle;
		skeletonPill = skeletonMod.skeletonPill;

		const creationCardMod = await import(`/shared/creationCard.js${qs}`);
		buildCreationCardShell = creationCardMod.buildCreationCardShell;

		const commentItemMod = await import(`/shared/commentItem.js${qs}`);
		renderCommentAvatarHtml = commentItemMod.renderCommentAvatarHtml;

		const createSubmitMod = await import(`/shared/createSubmit.js${qs}`);
		uploadImageFile = createSubmitMod.uploadImageFile;
	})();
	return _depsPromise;
}

const html = String.raw;
const TIP_MIN_VISIBLE_BALANCE = 10.0;

/** Normalize image URL for queue match (origin + path). Same idea as creation-edit toParasceneImageUrl. */
function normalizeImageUrlForQueue(raw) {
	const base = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
	if (typeof raw !== 'string') return '';
	const value = raw.trim();
	if (!value) return '';
	try {
		const parsed = new URL(value, base);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
		return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return '';
	}
}

/** SVG + label for each creation-detail action. inKebabMenu: true = only in more menu (no pill); false = only as pill. */
function getCreationDetailActionDefs() {
	return [
		{
			key: 'publish',
			dataAttr: 'data-publish-btn',
			btnClass: 'btn-primary',
			inKebabMenu: false,
			inner: html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="margin-right: 6px; vertical-align: middle;">
	<path d="M1.5 8L14.5 1.5L10.5 14.5L8 9L1.5 8Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" fill="none" />
</svg>
Publish`,
			show: (c) => c?.showPublish,
			disabled: (c) => !c?.showPublish
		},
		{
			key: 'mutate',
			dataAttr: 'data-mutate-btn',
			btnClass: 'btn-outlined',
			inKebabMenu: false,
			inner: html`<span class="creation-detail-action-strip-pill-icon">${sparkleIcon('')}</span>
Mutate`,
			show: (c) => c?.showMutate,
			disabled: (c) => !c?.showMutate
		},
		{
			key: 'share',
			dataAttr: 'data-share-btn',
			btnClass: 'btn-outlined',
			inKebabMenu: false,
			inner: html`<span class="creation-detail-action-strip-pill-icon">${shareIcon('')}</span>
Share`,
			show: (c) => c?.showShare,
			disabled: (c) => !c?.showShare
		},
		{
			key: 'edit',
			dataAttr: 'data-edit-btn',
			btnClass: 'btn-outlined',
			inKebabMenu: false,
			inner: html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="margin-right: 6px; vertical-align: middle;">
	<path d="M11.5 2.5L13.5 4.5L5.5 12.5H3.5V10.5L11.5 2.5Z" stroke="currentColor" stroke-width="1.5"
		stroke-linecap="round" stroke-linejoin="round" fill="none" />
</svg>
Edit`,
			show: (c) => c?.showEdit,
			disabled: (c) => !c?.showEdit
		},
		{
			key: 'unpublish',
			dataAttr: 'data-unpublish-btn',
			btnClass: 'btn-outlined',
			inKebabMenu: true,
			inner: html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="margin-right: 6px; vertical-align: middle;">
	<path d="M1.5 8L14.5 1.5L10.5 14.5L8 9L1.5 8Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" fill="none" />
</svg>
Un-publish`,
			show: (c) => c?.showUnpublish,
			disabled: (c) => !c?.showUnpublish
		},
		{
			key: 'retry',
			dataAttr: 'data-retry-btn',
			btnClass: 'btn-outlined',
			inKebabMenu: false,
			inner: html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="margin-right: 6px; vertical-align: middle;">
	<path d="M3 12a9 9 0 1 0 3-6.708" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" />
	<polyline points="3 4 3 10 9 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" />
</svg>
Retry`,
			show: (c) => c?.showRetry,
			disabled: (c) => !c?.showRetry
		},
		{
			key: 'more-info',
			dataAttr: 'data-more-info-btn',
			btnClass: 'btn-outlined',
			inKebabMenu: false,
			inner: html`<span class="creation-detail-action-strip-pill-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
		stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<circle cx="12" cy="12" r="10"></circle>
		<path d="M12 8v8"></path>
		<path d="M12 6h.01"></path>
	</svg></span>
More Info`,
			show: (c) => c?.showMoreInfoPill,
			disabled: () => false
		},
		{
			key: 'delete',
			dataAttr: 'data-delete-btn',
			btnClass: 'btn-outlined btn-danger-outlined',
			inKebabMenu: true,
			inner: html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="margin-right: 6px; vertical-align: middle;">
	<path
		d="M2 4H14M12.5 4V13.5C12.5 14.3284 11.8284 15 11 15H5C4.17157 15 3.5 14.3284 3.5 13.5V4M5.5 4V2.5C5.5 1.67157 6.17157 1 7 1H9C9.82843 1 10.5 1.67157 10.5 2.5V4M6.5 7.5V11.5M9.5 7.5V11.5"
		stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
</svg>`,
			show: (c) => c?.showDelete,
			disabled: (c) => c?.deleteDisabled !== false,
			extraAttrs: (c) => c?.deletePermanent ? ' data-permanent-delete="1"' : '',
			label: (c) => (c?.deleteLabel ?? ' Delete')
		},
		{
			key: 'permanent-delete',
			dataAttr: 'data-delete-btn',
			btnClass: 'btn-outlined btn-danger-outlined',
			inKebabMenu: false,
			inner: html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="margin-right: 6px; vertical-align: middle;">
	<path
		d="M2 4H14M12.5 4V13.5C12.5 14.3284 11.8284 15 11 15H5C4.17157 15 3.5 14.3284 3.5 13.5V4M5.5 4V2.5C5.5 1.67157 6.17157 1 7 1H9C9.82843 1 10.5 1.67157 10.5 2.5V4M6.5 7.5V11.5M9.5 7.5V11.5"
		stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
</svg>`,
			show: (c) => c?.deletePermanent,
			disabled: () => false,
			extraAttrs: () => ' data-permanent-delete="1"',
			label: () => ' Permanently delete'
		}
	];
}

/**
 * Strip segment defs: each has show(stripData) and render(stripData, escapeFn). Rendered in order; only segments with show() true are included.
 */
const STRIP_SEGMENT_DEFS = [
	{
		key: 'avatar',
		show: () => true,
		render: (d, escapeFn) => d.creatorProfileHref
			? html`<a class="creation-detail-action-strip-avatar" href="${d.creatorProfileHref}"
	aria-label="View ${escapeFn(d.creatorName)} profile">${d.authorAvatar}</a>`
			: html`<div class="creation-detail-action-strip-avatar" aria-hidden="true">${d.authorAvatar}</div>`
	},
	{
		key: 'creatorInfo',
		show: () => true,
		render: (d, escapeFn) => html`
					<div class="creation-detail-action-strip-creator-info">
						<div class="creation-detail-action-strip-creator-name">${escapeFn(d.creatorName)}</div>
						<div class="creation-detail-action-strip-creator-followers">${d.creatorFollowerCount} Followers</div>
					</div>`
	},
	{
		key: 'follow',
		show: (d) => !d.hideActions && !d.isAdmin && d.canShowFollowButton && !d.viewerFollowsCreator,
		render: (d, escapeFn) => html`
					<button type="button" class="creation-detail-action-strip-follow" data-follow-button
						data-follow-user-id="${escapeFn(d.creatorId)}">Follow</button>`
	},
	{
		key: 'like',
		show: (d) => !d.hideActions && d.hasEngagementActions && !d.shareMountedPrivate && !d.isAdmin,
		render: (d) => html`
					<button type="button" class="creation-detail-action-strip-pill${d.creationWithLikes?.viewer_liked ? ' is-liked' : ''}"
						aria-label="Like" aria-pressed="${d.creationWithLikes?.viewer_liked ? 'true' : 'false'}" data-like-button>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
							stroke-linejoin="round" aria-hidden="true">
							<path
								d="M20.8 4.6a5 5 0 0 0-7.1 0L12 6.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l1.7 1.7L12 21l7.1-7.6 1.7-1.7a5 5 0 0 0 0-7.1z">
							</path>
						</svg>
						<span class="creation-detail-action-strip-pill-count" data-like-count>${d.likeCount}</span>
					</button>`
	},
	{
		key: 'pills',
		show: (d) => !d.hideActions,
		render: (d) => renderCreationDetailActionStripPills(d.actionsContext)
	},
	{
		key: 'tip',
		show: (d) => !d.hideActions && !d.isOwner && !d.isAdmin,
		render: () => html`
					<button type="button" class="creation-detail-action-strip-pill" data-tip-creator-button aria-label="Tip">
						<span class="creation-detail-action-strip-pill-icon">${creditIcon('')}</span>
						<span>Tip</span>
					</button>`
	},
	{
		key: 'more',
		show: (d) => !d.hideActions && (!d.isFailed || (d.isFailed && d.actionsContext?.showDelete)),
		render: () => html`
					<button type="button" class="creation-detail-more-btn" aria-label="More options" data-creation-more-btn>
						<span class="creation-detail-more-dots" aria-hidden="true"></span>
					</button>`
	}
];

/**
 * Renders the creation-detail-action-strip from segment defs. Builds items that should be shown from stripData, then injects into the strip template.
 * @param {object} stripData - Data for avatar, creator, follow, like, pills, tip, more (creatorName, authorAvatar, actionsContext, etc.)
 * @param {(s: string) => string} escapeFn - escapeHtml for safe attribute/text output
 * @returns {string}
 */
function renderCreationDetailActionStrip(stripData, escapeFn) {
	const segments = STRIP_SEGMENT_DEFS.filter((def) => def.show(stripData)).map((def) => def.render(stripData, escapeFn));
	return html`
<div class="creation-detail-action-strip has-overflow-right">
	<div class="creation-detail-action-strip-scroll">
		${segments.join('')}
		<span class="creation-detail-action-strip-scroll-spacer" aria-hidden="true"></span>
	</div>
</div>`;
}

/** More menu item defs: each has action (data-creation-more-action), show(menuData), icon (svg string), label (string or (menuData)=>string), danger?: boolean. */
const MORE_MENU_ITEM_DEFS = [
	{
		action: 'copy-link',
		show: () => true,
		icon: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
	stroke-linejoin="round" aria-hidden="true">
	<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
	<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
</svg>`,
		label: 'Copy link'
	},
	{
		action: 'queue-for-later',
		show: (d) => d.actionsContext?.showQueueForLater,
		icon: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
	stroke-linejoin="round" aria-hidden="true">
	<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
	<line x1="16" y1="2" x2="16" y2="6"></line>
	<line x1="8" y1="2" x2="8" y2="6"></line>
	<line x1="3" y1="10" x2="21" y2="10"></line>
</svg>`,
		label: (d) => (d.actionsContext?.queueForLaterLabel ?? 'Queue for later')
	},
	{
		action: 'queue-from-frame',
		show: (d) => d.actionsContext?.showQueueFromFrame,
		icon: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
	stroke-linejoin="round" aria-hidden="true">
	<rect x="2" y="4" width="20" height="16" rx="2"></rect>
	<path d="M10 9v6l5-3-5-3z"></path>
</svg>`,
		label: 'Queue from frame'
	},
	{
		action: 'set-avatar',
		show: (d) => d.isOwner,
		icon: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
	stroke-linejoin="round" aria-hidden="true">
	<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
	<circle cx="12" cy="7" r="4"></circle>
</svg>`,
		label: 'Set as profile picture'
	},
	{
		action: 'landscape',
		show: (d) => d.isOwner && !d.isAdmin,
		icon: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
	stroke-linejoin="round" aria-hidden="true">
	<rect x="2" y="6" width="20" height="12" rx="1.5" /></svg>`,
		label: 'Landscape'
	},
	{
		action: 'more-info',
		show: (d) => d.hasDetailsModalContent,
		icon: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
	stroke-linejoin="round" aria-hidden="true">
	<circle cx="12" cy="12" r="10"></circle>
	<path d="M12 8v8"></path>
	<path d="M12 6h.01"></path>
</svg>`,
		label: 'More Info'
	},
	{
		action: 'unpublish',
		show: (d) => d.actionsContext?.showUnpublish,
		icon: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
	stroke-linejoin="round" aria-hidden="true">
	<path d="M1.5 8L14.5 1.5L10.5 14.5L8 9L1.5 8Z"></path>
</svg>`,
		label: 'Un-publish'
	},
	{
		action: 'delete',
		show: (d) => d.actionsContext?.showDelete && !d.actionsContext?.deletePermanent,
		icon: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
	stroke-linejoin="round" aria-hidden="true">
	<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
	<line x1="10" y1="11" x2="10" y2="17"></line>
	<line x1="14" y1="11" x2="14" y2="17"></line>
</svg>`,
		label: (d) => (typeof d.actionsContext?.deleteLabel === 'string' ? d.actionsContext.deleteLabel.trim() : 'Delete'),
		danger: true
	}
];

/**
 * Renders the creation-detail-more-menu from item defs. Renders for failed creations when owner can delete.
 * @param {object} menuData - isFailed, hasDetailsModalContent, isOwner, isAdmin, actionsContext
 * @param {(s: string) => string} escapeFn - escapeHtml for labels
 * @returns {string}
 */
function renderCreationDetailMoreMenu(menuData, escapeFn) {
	const items = MORE_MENU_ITEM_DEFS.filter((def) => def.show(menuData)).map((def) => {
		const label = typeof def.label === 'function' ? def.label(menuData) : def.label;
		const itemClass = def.danger ? 'creation-detail-more-menu-item creation-detail-more-menu-item-danger' : 'creation-detail-more-menu-item';
		const labelHtml = def.action === 'queue-for-later'
			? html`<span data-queue-for-later-label>${escapeFn(label)}</span>`
			: html`<span>${escapeFn(label)}</span>`;
		return html`<button type="button" class="${itemClass}" role="menuitem" data-creation-more-action="${def.action}">
	${def.icon}
	${labelHtml}
</button>`;
	});
	return html`
<div class="creation-detail-more-menu" data-creation-more-menu aria-hidden="true" role="menu">
	${items.join('')}
</div>`;
}

/** Skeleton placeholder for creation-detail-info while content is loading. Mirrors the loaded layout for a smooth transition. */
function renderCreationDetailSkeleton() {
	return html`
<div class="creation-detail-skeleton" aria-label="Loading" aria-busy="true">
	<div class="creation-detail-title-row">
		<div class="skeleton skeleton-line" style="width: 72%; max-width: 320px;"></div>
	</div>
	<div class="creation-detail-title-row">
		<div class="skeleton skeleton-line" style="width: 62%; max-width: 220px;"></div>
	</div>
	<!-- <div class="creation-detail-title-byline creation-detail-title-byline-mobile">
		<span class="skeleton skeleton-line skeleton-line--short"></span>
	</div> -->
	<div class="creation-detail-action-strip">
		<div class="creation-detail-action-strip-scroll">
			<div class="creation-detail-action-strip-avatar">${skeletonCircle(40)}</div>
			<div class="creation-detail-action-strip-creator-info">
				<div class="skeleton skeleton-line skeleton-line--short" style="margin-bottom: 4px;"></div>
				<div class="skeleton skeleton-line skeleton-line--medium"></div>
			</div>
			${skeletonPill('72px')}
			${skeletonPill('64px')}
			${skeletonPill('88px')}
			<span class="skeleton skeleton-circle" style="width: 34px; height: 34px;"></span>
		</div>
	</div>
	<div class="creation-detail-skeleton-description" style="margin-bottom: 40px;">
		<span class="skeleton skeleton-line" style="display: block; margin-bottom: 8px;"></span>
		<span class="skeleton skeleton-line" style="display: block; margin-bottom: 12px; width: 95%;"></span>
		<span class="skeleton skeleton-line skeleton-line--medium" style="display: block; margin-bottom: 12px;"></span>
	</div>
	<div class="comment-input">
		<div class="comment-avatar">${skeletonCircle(32)}</div>
		<div class="comment-input-body">
			<span class="skeleton skeleton-line" style="display: block; height: 40px; border-radius: 8px;"></span>
		</div>
	</div>
	<div class="comments-toolbar">
		<div class="skeleton skeleton-line" style="width: 120px;"></div>
		<div class="skeleton skeleton-line" style="width: 100px; margin-left: auto;"></div>
	</div>
	<div class="comment-list">
		<div class="creation-detail-skeleton-comment">${skeletonCircle(32)}<div><span
					class="skeleton skeleton-line skeleton-line--short"
					style="display: block; margin-bottom: 4px;"></span><span
					class="skeleton skeleton-line skeleton-line--medium" style="display: block;"></span></div>
		</div>
		<div class="creation-detail-skeleton-comment">${skeletonCircle(32)}<div><span
					class="skeleton skeleton-line skeleton-line--medium"
					style="display: block; margin-bottom: 4px;"></span><span
					class="skeleton skeleton-line skeleton-line--short" style="display: block;"></span></div>
		</div>
	</div>
</div>`;
}

/** Renders visible actions as pills in the action strip. Only actions with inKebabMenu === false are shown (items in the more menu are not duplicated as pills). */
function renderCreationDetailActionStripPills(ctx) {
	if (!ctx) return '';
	const visible = getCreationDetailActionDefs().filter((def) => def.show(ctx) && !def.inKebabMenu);
	return visible.map((def) => {
		const disabled = def.disabled(ctx);
		const extraAttrs = def.extraAttrs ? def.extraAttrs(ctx) : '';
		const label = def.label ? def.label(ctx) : '';
		return `<button type="button" class="creation-detail-action-strip-pill" ${def.dataAttr}${disabled ? ' disabled' : ''}${extraAttrs}>${def.inner}${label}</button>`;
	}).join('\n\t\t\t\t');
}

async function copyTextToClipboard(text) {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// ignore
	}
	try {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.left = '-9999px';
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
		const ok = document.execCommand('copy');
		document.body.removeChild(ta);
		return ok;
	} catch {
		return false;
	}
}

function formatDuration(meta) {
	if (!meta) return '';
	const durationMs =
		typeof meta.duration_ms === 'number' && Number.isFinite(meta.duration_ms)
			? meta.duration_ms
			: null;
	let ms = durationMs;
	if (ms == null) {
		const started = meta.started_at ? Date.parse(meta.started_at) : NaN;
		const endedRaw = meta.completed_at || meta.failed_at || null;
		const ended = endedRaw ? Date.parse(endedRaw) : NaN;
		if (Number.isFinite(started) && Number.isFinite(ended) && ended >= started) {
			ms = ended - started;
		}
	}
	if (!Number.isFinite(ms) || ms <= 0) return '';
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	const rem = Math.round(seconds % 60);
	if (minutes >= 60) {
		const hours = Math.floor(minutes / 60);
		const remMin = minutes % 60;
		return `${hours}h ${remMin}m`;
	}
	return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`;
}

function setupCollapsibleDescription(rootEl) {
	const root = rootEl instanceof Element ? rootEl : document;
	const wrap = root.querySelector('[data-description-wrap]');
	const descriptionEl = root.querySelector('[data-description]');
	const toggleBtn = root.querySelector('[data-description-toggle]');

	if (!(wrap instanceof HTMLElement)) return;
	if (!(descriptionEl instanceof HTMLElement)) return;
	if (!(toggleBtn instanceof HTMLButtonElement)) return;

	if (!wrap.dataset.psDescInit) {
		// Default state: collapsed, but only keep it if it actually overflows.
		wrap.classList.add('is-collapsed');
		wrap.dataset.psDescInit = '1';
	}

	if (!descriptionEl.id) {
		descriptionEl.id = 'creation-detail-description';
	}
	toggleBtn.setAttribute('aria-controls', descriptionEl.id);
	function update() {
		// Measure overflow using the collapsed max-height enforced by CSS.
		// This avoids fragile computed line-height math across browsers.
		const wasCollapsed = wrap.classList.contains('is-collapsed');
		wrap.classList.add('is-measuring');
		wrap.classList.add('is-collapsed');
		const delta = descriptionEl.scrollHeight - descriptionEl.clientHeight;
		wrap.classList.remove('is-measuring');
		// Tolerate small sub-pixel rounding differences that can vary by browser/font.
		const overflows = delta > 4;
		if (!overflows) {
			wrap.classList.remove('is-collapsed');
			toggleBtn.hidden = true;
			return;
		}

		toggleBtn.hidden = false;
		// Restore expanded state if user already expanded it.
		if (!wasCollapsed) wrap.classList.remove('is-collapsed');
		const isCollapsed = wrap.classList.contains('is-collapsed');
		toggleBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
		toggleBtn.textContent = isCollapsed ? 'View Full' : 'Collapse';
	}

	update();

	// Run again once layout has fully settled (fonts/styles can affect measurements).
	requestAnimationFrame(() => requestAnimationFrame(update));

	// Keep accurate on responsive layout changes and async link title hydration.
	if (typeof window.ResizeObserver === 'function') {
		const ro = new ResizeObserver(() => update());
		ro.observe(descriptionEl);
	}
	window.addEventListener('resize', update, { passive: true });

	if (!toggleBtn.dataset.psDescToggleBound) {
		toggleBtn.dataset.psDescToggleBound = '1';
		toggleBtn.addEventListener('click', () => {
			const isCollapsed = wrap.classList.toggle('is-collapsed');
			toggleBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
			toggleBtn.textContent = isCollapsed ? 'View Full' : 'Collapse';
		});
	}
}

// Set up URL change detection BEFORE header component loads
// This ensures we capture navigation events

// Get creation ID from URL
function getCreationId() {
	// Only use injected share context while we're actually on a share-mounted URL.
	// Otherwise it "sticks" across navigation and breaks header/mobile nav routing.
	if (isShareMountedView()) {
		if (window.__ps_share_context && Number.isFinite(Number(window.__ps_share_context.creationId))) {
			const id = Number(window.__ps_share_context.creationId);
			return id > 0 ? id : null;
		}
	}
	const pathname = window.location.pathname;
	const match = pathname.match(/^\/creations\/(\d+)$/);
	return match ? parseInt(match[1], 10) : null;
}

function isShareMountedView() {
	return Boolean(
		window.__ps_share_context &&
		typeof window.__ps_share_context === 'object' &&
		typeof window.location?.pathname === 'string' &&
		window.location.pathname.startsWith('/s/')
	);
}

function getPrimaryLinkUrl(creationId) {
	// When this page is served at a share URL (/s/...), keep the share URL as the primary link.
	// Otherwise, use the canonical in-app creation URL.
	if (isShareMountedView()) {
		return window.location.href;
	}
	return new URL(`/creations/${creationId}`, window.location.origin).toString();
}

const RELATED_BATCH_SIZE = 40;
const RELATED_STORAGE_KEY_PREFIX = 'related_transition_';
const RELATED_EXCLUDE_IDS_CAP = 200;
const RECSYS_RANDOM_ONLY_SEEN_THRESHOLD = 120;

function recordTransitionFromQuery(currentCreationId) {
	const params = new URLSearchParams(window.location.search);
	const fromRaw = params.get('from');
	const fromId = fromRaw != null ? parseInt(fromRaw, 10) : NaN;
	if (!Number.isFinite(fromId) || fromId < 1 || fromId === currentCreationId) return;
	const key = `${RELATED_STORAGE_KEY_PREFIX}${fromId}_${currentCreationId}`;
	try {
		if (sessionStorage.getItem(key)) return;
	} catch {
		return;
	}
	fetch('/api/creations/transitions', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			from_created_image_id: fromId,
			to_created_image_id: currentCreationId
		})
	}).then((res) => {
		if (res.ok) {
			try {
				sessionStorage.setItem(key, '1');
			} catch {
				// ignore
			}
			const url = new URL(window.location.href);
			url.searchParams.delete('from');
			const newUrl = url.pathname + (url.search ? url.search : '') + (url.hash || '');
			window.history.replaceState(window.history.state, '', newUrl);
		}
	}).catch(() => { });
}

function initRelatedSection(root, currentCreationId, options = {}) {
	const container = root.querySelector('[data-related-container]');
	const grid = root.querySelector('[data-related-grid]');
	const sentinel = root.querySelector('[data-related-sentinel]');
	if (!container || !grid || !sentinel) return;
	const showRecsysDebug = options?.showRecsysDebug === true;

	function escapeHtml(val) {
		return String(val ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	}

	function decodeHtmlEntities(val) {
		const text = String(val ?? '');
		if (!text.includes('&')) return text;
		const textarea = document.createElement('textarea');
		textarea.innerHTML = text;
		return textarea.value;
	}

	let relatedIds = [];
	const relatedIdsSet = new Set();
	let hasMore = false;
	let isLoading = false;
	let randomMode = false;
	let relatedObserver = null;

	function relatedCardUrl(createdImageId) {
		return `/creations/${createdImageId}?from=${currentCreationId}`;
	}

	function isSentinelNearViewport() {
		if (!sentinel) return false;
		const rect = sentinel.getBoundingClientRect();
		return rect.top <= (window.innerHeight + 240);
	}

	function setRelatedMediaBackground(mediaEl, url) {
		if (!mediaEl || !url) return;
		if (mediaEl.dataset.bgLoadedUrl === url) return;
		const img = new Image();
		img.onload = () => {
			mediaEl.dataset.bgLoadedUrl = url;
			mediaEl.style.backgroundImage = `url("${String(url).replace(/"/g, '\\"')}")`;
		};
		img.src = url;
	}

	function buildRelatedReasonRows(item) {
		const rows = [];
		if (Number.isFinite(Number(item?.recsys_score))) {
			let scoreLine = `Score ${Number(item.recsys_score).toFixed(2)}`;
			if (Number.isFinite(Number(item?.recsys_click_score))) {
				const shareText = Number.isFinite(Number(item?.recsys_click_share))
					? ` (${(Number(item.recsys_click_share) * 100).toFixed(1)}%)`
					: '';
				scoreLine += ` | Click ${Number(item.recsys_click_score).toFixed(4)}${shareText}`;
			}
			rows.push(scoreLine);
		}
		const details = Array.isArray(item?.reason_details) ? item.reason_details : [];
		for (const d of details.slice(0, 3)) {
			if (!d?.label) continue;
			const relId = d.related_creation_id;
			const relTitle = d.related_creation_title;
			if (relId || relTitle) {
				rows.push(`${d.label}: ${relTitle || 'Untitled'}${relId ? ` (#${relId})` : ''}`);
			} else {
				rows.push(String(d.label));
			}
		}
		if (rows.length === 0) {
			const labels = Array.isArray(item?.reason_labels) ? item.reason_labels : [];
			for (const label of labels.slice(0, 3)) rows.push(String(label));
		}
		return rows;
	}

	function appendRelatedCards(items) {
		if (!items || items.length === 0) return;
		const startIndex = grid.querySelectorAll('.route-card').length;
		items.forEach((item, i) => {
			if (!item || typeof item !== 'object') return;
			const cid = item.created_image_id ?? item.id;
			if (!cid) return;
			const card = document.createElement('div');
			card.className = 'route-card route-card-image';
			card.setAttribute('role', 'listitem');
			const authorUserId = item.user_id != null ? Number(item.user_id) : null;
			const profileHref = buildProfilePath({ userName: item.author_user_name, userId: authorUserId });
			const authorLabel = item.author_display_name || item.author_user_name || item.author || 'User';
			const handleText = item.author_user_name || '';
			const handle = handleText ? `@${handleText}` : '';
			const href = relatedCardUrl(cid);
			const reasonRows = showRecsysDebug ? buildRelatedReasonRows(item) : [];
			const reasonsHtml = showRecsysDebug && reasonRows.length > 0
				? `<div class="creation-detail-related-reasons">${reasonRows.map((line) => `<div class="creation-detail-related-reason-line">${escapeHtml(line)}</div>`).join('')}</div>`
				: '';
			const detailsContent = html`
						<div class="route-title">${escapeHtml(decodeHtmlEntities(item.title != null ? item.title : 'Untitled'))}</div>
						<div class="route-summary">${escapeHtml(decodeHtmlEntities(item.summary != null ? item.summary : ''))}</div>
						<div class="route-meta" title="${formatDateTime(item.created_at)}">${formatRelativeTime(item.created_at)}</div>
						<div class="route-meta">
							By ${profileHref ? html`<a class="user-link" href="${profileHref}"
								data-related-profile-link>${escapeHtml(decodeHtmlEntities(authorLabel))}</a>` :
					escapeHtml(decodeHtmlEntities(authorLabel))}${handle ? html` <span>(${handle})</span>` : ''}
						</div>
						${reasonsHtml}
						<div class="route-meta route-meta-spacer"></div>
						<div class="route-tags">${escapeHtml(item.tags ?? '')}</div>`;
			const mediaType = typeof item.media_type === 'string' ? item.media_type : 'image';
			const mediaAttrs = {
				'data-related-media': true,
				'data-image-id': cid,
				'data-status': 'completed'
			};
			if (mediaType === 'video') {
				mediaAttrs['data-media-type'] = 'video';
			}
			card.innerHTML = buildCreationCardShell({
				mediaAttrs,
				detailsContentHtml: detailsContent,
				nsfw: Boolean(item.nsfw),
			});
			card.style.cursor = 'pointer';
			card.addEventListener('click', (e) => {
				if (e.target.closest('.user-link')) return;
				window.location.href = href;
			});
			const mediaEl = card.querySelector('[data-related-media]');
			const bgUrl = (item.thumbnail_url || item.image_url || '').trim();
			if (mediaEl && bgUrl) {
				mediaEl.dataset.bgUrl = bgUrl;
				if (startIndex + i < 6) setRelatedMediaBackground(mediaEl, bgUrl);
				else {
					const io = new IntersectionObserver((entries) => {
						entries.forEach((entry) => {
							if (entry.isIntersecting && mediaEl.dataset.bgUrl) {
								setRelatedMediaBackground(mediaEl, mediaEl.dataset.bgUrl);
								io.disconnect();
							}
						});
					}, { rootMargin: '100px', threshold: 0 });
					io.observe(mediaEl);
				}
			}
			const profileLink = card.querySelector('[data-related-profile-link]');
			if (profileLink) {
				profileLink.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					window.location.href = profileLink.getAttribute('href') || '#';
				});
			}
			grid.appendChild(card);
		});
	}

	async function loadRelated(excludeIds = null) {
		if (isLoading) return;
		isLoading = true;
		try {
			const params = new URLSearchParams();
			params.set('limit', String(RELATED_BATCH_SIZE));
			if (excludeIds && excludeIds.length > 0) params.set('exclude_ids', excludeIds.join(','));
			if (randomMode) params.set('force_random', '1');
			else if (relatedIds.length >= RECSYS_RANDOM_ONLY_SEEN_THRESHOLD) params.set('seen_count', String(relatedIds.length));
			const res = await fetch(`/api/creations/${currentCreationId}/related?${params}`, { credentials: 'include' });
			if (!res.ok) {
				container.style.display = 'none';
				return;
			}
			const data = await res.json();
			const rawItems = Array.isArray(data?.items) ? data.items : [];
			let items = [];
			hasMore = Boolean(data?.hasMore);
			if (randomMode) {
				// In random mode, allow previously seen IDs so the feed never stalls.
				items = rawItems.filter((it) => {
					const id = it?.created_image_id ?? it?.id;
					if (id == null) return false;
					relatedIds.push(id);
					return true;
				});
			} else {
				// Deterministic mode: dedupe strictly across what we've already rendered.
				items = rawItems.filter((it) => {
					const id = it?.created_image_id ?? it?.id;
					if (id == null || relatedIdsSet.has(id)) return false;
					relatedIdsSet.add(id);
					relatedIds.push(id);
					return true;
				});
			}
			if (items.length > 0) {
				container.style.display = '';
				appendRelatedCards(items);
			}
			if (!hasMore) {
				randomMode = true;
				hasMore = true;
				if (sentinel) sentinel.style.display = '';
			}
		} finally {
			isLoading = false;
			// If the sentinel remains in view, continue auto-loading.
			// Use a small delay to avoid tight request loops when responses are sparse.
			if (hasMore && relatedIds.length > 0 && isSentinelNearViewport()) {
				window.setTimeout(() => {
					loadMoreRelated();
				}, 180);
			}
		}
	}

	function loadMoreRelated() {
		if (!hasMore || isLoading || relatedIds.length === 0) return;
		// Keep excludes tighter in random mode to reduce request lock-in.
		const excludeTail = randomMode
			? Math.min(40, RELATED_EXCLUDE_IDS_CAP)
			: RELATED_EXCLUDE_IDS_CAP;
		const excludeIds = [currentCreationId, ...relatedIds.slice(-excludeTail)];
		loadRelated(excludeIds);
	}

	function observeSentinel() {
		if (!sentinel || !hasMore) return;
		relatedObserver = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) loadMoreRelated();
			});
		}, { rootMargin: '200px', threshold: 0 });
		relatedObserver.observe(sentinel);
	}

	void loadRelated().then(() => {
		if (hasMore) observeSentinel();
	});
}

// Store original history methods before anything else modifies them
const originalPushState = history.pushState.bind(history);
const originalReplaceState = history.replaceState.bind(history);

async function loadCreation() {
	const detailContent = document.querySelector('[data-detail-content]');
	const imageEl = document.querySelector('[data-image]');
	const backgroundEl = document.querySelector('[data-background]');
	const imageWrapper = imageEl?.closest?.('.creation-detail-image-wrapper');
	const videoEl = document.querySelector('[data-video]');
	const videoMutedBadgeEl = imageWrapper?.querySelector?.('[data-video-muted-badge]') || null;
	const groupHeroPrevBtn = imageWrapper?.querySelector?.('[data-group-hero-prev]') || null;
	const groupHeroNextBtn = imageWrapper?.querySelector?.('[data-group-hero-next]') || null;
	const heroImagePreloadPromises = new Map();
	const heroImageWarmUrls = new Set();
	let groupHeroStackEl = null;
	const groupHeroImageBySourceId = new Map();

	if (!detailContent || !imageEl || !backgroundEl) return;

	if (creationDetailInlineLightboxMod && !detailContent.dataset.prsnInlineLightboxBound) {
		detailContent.dataset.prsnInlineLightboxBound = '1';
		creationDetailInlineLightboxMod.bindChatInlineImageLightboxClickDelegation(detailContent, {
			bubbleSelector: null,
			openHooks: {},
		});
	}

	const loadToken = ++loadCreationSequence;
	const isCurrentLoad = () => loadToken === loadCreationSequence;

	function applyLoadedImageState() {
		const modIcon = imageWrapper?.querySelector('.creation-detail-error-icon-moderated');
		if (modIcon) modIcon.remove();
		imageWrapper?.classList.remove('image-loading', 'image-error', 'image-error-moderated');
		if (imageEl.dataset.currentUrl) {
			backgroundEl.style.backgroundImage = `url('${imageEl.dataset.currentUrl}')`;
		}
		imageEl.style.visibility = 'visible';
	}

	function urlsMatch(a, b) {
		const left = String(a || '').trim();
		const right = String(b || '').trim();
		if (!left || !right) return false;
		if (left === right) return true;
		try {
			return new URL(left, window.location.origin).href === new URL(right, window.location.origin).href;
		} catch {
			return false;
		}
	}

	function hasLoadedHeroImage() {
		return Boolean(imageEl.src && imageEl.complete && imageEl.naturalWidth > 0 && imageEl.style.visibility !== 'hidden');
	}

	function clearHeroImage() {
		backgroundEl.style.backgroundImage = '';
		imageEl.style.visibility = 'hidden';
		imageEl.removeAttribute('src');
		delete imageEl.dataset.currentUrl;
		delete imageEl.dataset.pendingUrl;
	}

	function syncHeroVideoMutedBadge() {
		if (!videoMutedBadgeEl || !videoEl) return;
		const visible =
			videoEl.style.display !== 'none' &&
			Boolean(videoEl.getAttribute('src')) &&
			videoEl.muted;
		videoMutedBadgeEl.hidden = !visible;
	}

	function resetHeroVideo() {
		if (!videoEl) return;
		videoEl.style.display = 'none';
		videoEl.pause?.();
		videoEl.removeAttribute('src');
		try {
			videoEl.load();
		} catch {
			// ignore
		}
		if (videoMutedBadgeEl) videoMutedBadgeEl.hidden = true;
	}

	function applyHeroVideoUserUnmute() {
		if (!videoEl || videoEl.style.display === 'none') return;
		if (!videoEl.controls) {
			videoEl.controls = true;
			videoEl.setAttribute('controls', '');
		}
		if (videoEl.muted) {
			videoEl.muted = false;
			videoEl.removeAttribute('muted');
			if (typeof safeMediaPlay === 'function') {
				safeMediaPlay(videoEl);
			}
		}
		syncHeroVideoMutedBadge();
	}

	function appendCreationIdToMediaUrl(url, delegatedCreationId) {
		const raw = String(url || '').trim();
		const id = Number(delegatedCreationId);
		if (!raw || !Number.isFinite(id) || id <= 0) return raw;
		if (!raw.includes('/api/images/created/') && !raw.includes('/api/videos/created/')) return raw;
		const [beforeHash, hash = ''] = raw.split('#');
		if (/[?&]creation_id=/.test(beforeHash)) {
			return hash ? `${beforeHash}#${hash}` : beforeHash;
		}
		const sep = beforeHash.includes('?') ? '&' : '?';
		const next = `${beforeHash}${sep}creation_id=${encodeURIComponent(String(id))}`;
		return hash ? `${next}#${hash}` : next;
	}

	function preloadHeroImageUrl(url) {
		const key = String(url || '').trim();
		if (!key) return Promise.resolve();
		const cached = heroImagePreloadPromises.get(key);
		if (cached) return cached;
		const promise = new Promise((resolve) => {
			const im = new Image();
			im.onload = () => {
				heroImageWarmUrls.add(key);
				if (typeof im.decode === 'function') {
					im.decode()
						.then(() => resolve({ ok: true }))
						.catch(() => resolve({ ok: true }));
					return;
				}
				resolve({ ok: true });
			};
			im.onerror = () => resolve({ ok: false });
			im.decoding = 'async';
			if ('fetchPriority' in im) {
				im.fetchPriority = 'high';
			}
			im.src = key;
			if (im.complete && im.naturalWidth > 0) {
				heroImageWarmUrls.add(key);
				resolve({ ok: true });
			}
		});
		heroImagePreloadPromises.set(key, promise);
		return promise;
	}

	function showHeroImage(nextUrl) {
		const url = String(nextUrl || '').trim();
		if (!url) return;
		const currentUrl = imageEl.dataset.currentUrl || imageEl.getAttribute('src') || imageEl.currentSrc || '';
		if (urlsMatch(currentUrl, url)) {
			imageEl.dataset.currentUrl = url;
			if (hasLoadedHeroImage()) {
				applyLoadedImageState();
			} else {
				imageWrapper?.classList.remove('image-error', 'image-error-moderated');
				imageWrapper?.classList.add('image-loading');
			}
			return;
		}

		const keepCurrentImageVisible = hasLoadedHeroImage();
		resetHeroVideo();
		const modIcon = imageWrapper?.querySelector('.creation-detail-error-icon-moderated');
		if (modIcon) modIcon.remove();
		imageWrapper?.classList.remove('image-error', 'image-error-moderated');
		imageWrapper?.classList.toggle('image-loading', !keepCurrentImageVisible);
		if (!keepCurrentImageVisible) {
			imageEl.style.visibility = 'hidden';
		}
		imageEl.dataset.pendingUrl = url;
		if (heroImageWarmUrls.has(url)) {
			imageEl.dataset.currentUrl = url;
			delete imageEl.dataset.pendingUrl;
			backgroundEl.style.backgroundImage = `url('${url}')`;
			imageEl.src = url;
			imageEl.style.visibility = 'visible';
			imageWrapper?.classList.remove('image-loading', 'image-error', 'image-error-moderated');
			return;
		}

		preloadHeroImageUrl(url).then((result) => {
			if (!isCurrentLoad() || imageEl.dataset.pendingUrl !== url) return;
			if (!result?.ok) {
				delete imageEl.dataset.pendingUrl;
				clearHeroImage();
				imageWrapper?.classList.remove('image-loading');
				imageWrapper?.classList.add('image-error');
				return;
			}
			imageEl.dataset.currentUrl = url;
			delete imageEl.dataset.pendingUrl;
			backgroundEl.style.backgroundImage = `url('${url}')`;
			imageEl.src = url;
			imageEl.style.visibility = 'visible';
			imageWrapper?.classList.remove('image-loading', 'image-error', 'image-error-moderated');
		});
	}

	function teardownGroupHeroCarousel() {
		if (groupHeroStackEl && groupHeroStackEl.parentNode) {
			groupHeroStackEl.parentNode.removeChild(groupHeroStackEl);
		}
		groupHeroStackEl = null;
		groupHeroImageBySourceId.clear();
		imageWrapper?.classList.remove('group-carousel-active');
		imageEl.style.removeProperty('display');
	}

	function setGroupHeroCarouselActive(sourceId) {
		const sid = Number(sourceId);
		const activeImg = groupHeroImageBySourceId.get(sid);
		if (!activeImg) return false;
		for (const [id, img] of groupHeroImageBySourceId.entries()) {
			const isActive = Number(id) === sid;
			img.classList.toggle('is-active', isActive);
		}
		const activeUrl = String(activeImg.getAttribute('src') || '').trim();
		if (activeUrl) {
			backgroundEl.style.backgroundImage = `url('${activeUrl}')`;
		}
		imageWrapper?.classList.remove('image-loading', 'image-error', 'image-error-moderated');
		return true;
	}

	function mountGroupHeroCarousel(sources, initialSourceId) {
		const usable = (Array.isArray(sources) ? sources : [])
			.filter((source) => source && typeof source === 'object')
			.map((source) => ({
				id: Number(source.id),
				url: typeof source.filePath === 'string' ? source.filePath.trim() : '',
				title: typeof source.title === 'string' ? source.title : 'Grouped creation image',
			}))
			.filter((source) => Number.isFinite(source.id) && source.id > 0 && source.url);
		if (!imageWrapper || usable.length === 0) return false;
		teardownGroupHeroCarousel();
		const stack = document.createElement('div');
		stack.className = 'creation-detail-group-hero-stack';
		const initialId = Number(initialSourceId);
		for (const source of usable) {
			const img = document.createElement('img');
			img.className = 'creation-detail-group-hero-image';
			img.alt = source.title;
			img.decoding = 'async';
			img.loading = 'eager';
			img.src = source.url;
			if (source.id === initialId) img.classList.add('is-active');
			groupHeroImageBySourceId.set(source.id, img);
			stack.appendChild(img);
		}
		groupHeroStackEl = stack;
		imageWrapper.appendChild(stack);
		imageWrapper.classList.add('group-carousel-active');
		imageEl.style.display = 'none';
		if (!setGroupHeroCarouselActive(initialId)) {
			const first = usable[0];
			setGroupHeroCarouselActive(first.id);
		}
		return true;
	}

	function showHeroLoadingPlaceholder() {
		resetHeroVideo();
		clearHeroImage();
		imageWrapper?.classList.remove('image-error', 'image-error-moderated');
		imageWrapper?.classList.add('image-loading');
	}

	teardownGroupHeroCarousel();

	detailContent.innerHTML = renderCreationDetailSkeleton();

	// Attach image load/error handlers once, so broken-image icons never show
	if (!imageEl.dataset.fallbackAttached) {
		imageEl.dataset.fallbackAttached = '1';

		imageEl.addEventListener('load', applyLoadedImageState);

		imageEl.addEventListener('error', (event) => {
			// eslint-disable-next-line no-console
			console.error('[creation-detail] image load error', {
				src: imageEl?.currentSrc || imageEl?.src || null,
				event
			});
			// Show error placeholder; do not clear moderated state — loadCreation() may have already set it for a failed creation
			imageWrapper?.classList.remove('image-loading');
			imageWrapper?.classList.add('image-error');
			backgroundEl.style.backgroundImage = '';
			// Hide default browser broken-image UI
			imageEl.style.visibility = 'hidden';
		});
	}

	// If server-rendered image has already loaded before handlers attach, apply loaded state now.
	if (imageEl.src && imageEl.complete && imageEl.naturalWidth > 0) {
		applyLoadedImageState();
	}

	// Attach video load/error handlers once for video creations
	if (videoEl) {
		// Attach video load/error handlers once for video creations
		if (!videoEl.dataset.fallbackAttached) {
			videoEl.dataset.fallbackAttached = '1';

			videoEl.addEventListener('loadeddata', () => {
				const modIcon = imageWrapper?.querySelector('.creation-detail-error-icon-moderated');
				if (modIcon) modIcon.remove();
				imageWrapper?.classList.remove('image-loading', 'image-error', 'image-error-moderated');
				videoEl.style.display = 'block';
				syncHeroVideoMutedBadge();
			});

			videoEl.addEventListener('volumechange', () => {
				syncHeroVideoMutedBadge();
			});

			videoEl.addEventListener('error', (event) => {
				const mediaError = videoEl?.error || null;
				// eslint-disable-next-line no-console
				console.error('[creation-detail] video error', {
					src: videoEl?.currentSrc || videoEl?.src || null,
					code: mediaError && typeof mediaError.code === 'number' ? mediaError.code : null,
					message: mediaError && mediaError.message ? mediaError.message : null,
					event
				});
				imageWrapper?.classList.remove('image-loading');
				imageWrapper?.classList.add('image-error');
				backgroundEl.style.backgroundImage = '';
				videoEl.style.display = 'none';
				videoEl.removeAttribute('src');
				try {
					videoEl.load();
				} catch {
					// ignore
				}
				if (videoMutedBadgeEl) videoMutedBadgeEl.hidden = true;
			});
		}

		// Show controls only after the first user click; unmute at that moment.
		if (!videoEl.dataset.controlsOnClickAttached) {
			videoEl.dataset.controlsOnClickAttached = '1';
			videoEl.addEventListener('click', () => {
				applyHeroVideoUserUnmute();
			});
		}

		if (videoMutedBadgeEl && !videoMutedBadgeEl.dataset.heroMutedBadgeAttached) {
			videoMutedBadgeEl.dataset.heroMutedBadgeAttached = '1';
			videoMutedBadgeEl.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				applyHeroVideoUserUnmute();
			});
		}
	}

	const creationId = getCreationId();
	clearPageUsers();
	if (!creationId) {
		// eslint-disable-next-line no-console
		console.error('[creation-detail] missing creation id; showing image-error');
		imageWrapper?.classList.remove('image-loading', 'nsfw', 'image-error-moderated');
		imageWrapper?.classList.add('image-error');
		imageWrapper?.removeAttribute('data-creation-id');
		resetHeroVideo();
		clearHeroImage();
		detailContent.innerHTML = renderEmptyState({ title: 'Invalid creation ID' });
		return;
	}

	try {
		const headers = {};
		if (window.__ps_share_context && typeof window.__ps_share_context === 'object') {
			const shareVersion = typeof window.__ps_share_context.version === 'string' ? window.__ps_share_context.version : '';
			const shareToken = typeof window.__ps_share_context.token === 'string' ? window.__ps_share_context.token : '';
			if (shareVersion && shareToken) {
				headers['x-share-version'] = shareVersion;
				headers['x-share-token'] = shareToken;
			}
		}

		const lineageFetchInit = { credentials: 'include', headers: { ...headers } };

		let challengeSubmitQs = '';
		if (!isShareMountedView()) {
			try {
				const v = getAssetVersionParam();
				const qs = getImportQuery(v);
				const ctxMod = await import(`/shared/challengeSubmitContext.js${qs}`);
				const ctx = ctxMod.readChallengeSubmitContext?.();
				if (ctx?.threadId) {
					challengeSubmitQs = `?challenge_submit_thread=${encodeURIComponent(String(ctx.threadId))}`;
				}
			} catch {
				// ignore
			}
		}

		const response = await fetch(`/api/create/images/${creationId}${challengeSubmitQs}`, {
			credentials: 'include',
			headers
		});
		if (!response.ok) {
			if (response.status === 404) {
				// eslint-disable-next-line no-console
				console.error('[creation-detail] /api/create/images/:id returned 404; showing image-error', { creationId });
				// Show image-error state (rectangle-with-slash icon), not loading animation
				imageWrapper?.classList.remove('image-loading', 'nsfw', 'image-error-moderated');
				imageWrapper?.classList.add('image-error');
				imageWrapper?.removeAttribute('data-creation-id');
				resetHeroVideo();
				clearHeroImage();
				detailContent.innerHTML = renderEmptyState({
					title: 'Creation not found',
					message: "The creation you're looking for doesn't exist or you don't have access to it.",
				});
				return;
			}
			throw new Error('Failed to load creation');
		}

		const creation = await response.json();
		if (!isCurrentLoad()) return;

		// Fetch direct children (published creations with mutate_of_id = this id), order by created_at
		const childrenPromise = fetch(`/api/create/images/${creationId}/children`, { credentials: 'include' })
			.then((r) => (r.ok ? r.json() : []))
			.catch(() => []);

		const lineageOfQuerySuffix = `?lineage_of=${encodeURIComponent(String(creationId))}`;

		const status = creation.status || 'completed';
		const meta = creation.meta || null;
		const challengeSubmissions = Array.isArray(meta?.challenge_submissions) ? meta.challenge_submissions : [];
		const hasChallengeSubmission = challengeSubmissions.length > 0;
		const mediaType = typeof creation.media_type === 'string'
			? creation.media_type
			: (meta && typeof meta.media_type === 'string' ? meta.media_type : 'image');
		const timeoutAt = meta && typeof meta.timeout_at === 'string' ? new Date(meta.timeout_at).getTime() : NaN;
		const isTimedOut = status === 'creating' && Number.isFinite(timeoutAt) && Date.now() > timeoutAt;
		const isFailed = status === 'failed' || isTimedOut;
		const shareMounted = isShareMountedView();

		// Load like metadata from backend (no localStorage fallback).
		let likeMeta = { like_count: 0, viewer_liked: false };
		// When the detail page is served at a share URL (/s/...), don't touch likes for private/unpublished creations.
		// Likes are a "public surface area" and we don't want extra API calls here.
		if (!shareMounted) {
			try {
				const likeRes = await fetch(`/api/created-images/${creationId}/like`, { credentials: 'include' });
				if (likeRes.ok) {
					const meta = await likeRes.json();
					likeMeta = {
						like_count: Number(meta?.like_count ?? 0),
						viewer_liked: Boolean(meta?.viewer_liked)
					};
				}
			} catch {
				// ignore like meta load failures
			}
		}
		if (!isCurrentLoad()) return;

		const creationWithLikes = { ...creation, ...likeMeta, created_image_id: creationId };
		lastCreationMeta = creation;
		const likeCount = getCreationLikeCount(creationWithLikes);

		// Set image and blurred background depending on status
		imageWrapper?.classList.remove('image-error');
		imageWrapper?.classList.toggle('nsfw', !!(creation.nsfw ?? creation.meta?.nsfw));
		if (imageWrapper) {
			if (creation.nsfw ?? creation.meta?.nsfw) {
				imageWrapper.setAttribute('data-creation-id', String(creationId));
			} else {
				imageWrapper.removeAttribute('data-creation-id');
			}
		}

		if (status === 'completed' && mediaType === 'image' && creation.url) {
			showHeroImage(creation.url);
		} else if (status === 'completed' && mediaType === 'video' && creation.video_url) {
			clearHeroImage();
			const modIcon = imageWrapper?.querySelector('.creation-detail-error-icon-moderated');
			if (modIcon) modIcon.remove();
			imageWrapper?.classList.remove('image-error-moderated');
			imageWrapper?.classList.add('image-loading');

			const bgUrl = creation.url || creation.thumbnail_url || null;
			if (bgUrl) {
				backgroundEl.style.backgroundImage = `url('${bgUrl}')`;
			}

			if (videoEl) {
				if (videoMutedBadgeEl) videoMutedBadgeEl.hidden = true;
				// Use bgUrl (creation image or thumbnail) as poster while video loads.
				if (bgUrl) {
					videoEl.setAttribute('poster', bgUrl);
				} else {
					videoEl.removeAttribute('poster');
				}
				videoEl.style.display = 'block';
				videoEl.muted = true;
				videoEl.playsInline = true;
				videoEl.autoplay = true;
				videoEl.loop = true;
				videoEl.setAttribute('playsinline', '');
				videoEl.setAttribute('muted', '');
				videoEl.setAttribute('autoplay', '');
				videoEl.setAttribute('loop', '');
				videoEl.src = creation.video_url;
				if (typeof safeMediaPlay === 'function') {
					safeMediaPlay(videoEl);
				}
			}
		} else if (status === 'creating' && !isTimedOut) {
			const modIcon = imageWrapper?.querySelector('.creation-detail-error-icon-moderated');
			if (modIcon) modIcon.remove();
			showHeroLoadingPlaceholder();
		} else if (isFailed) {
			resetHeroVideo();
			clearHeroImage();
			// eslint-disable-next-line no-console
			console.error('[creation-detail] creation status is failed/timed-out; showing image-error', {
				status,
				meta
			});
			// Failed or timed out: show error placeholder (use imageWrapper so we target the same hero element we cleared)
			if (imageWrapper) {
				const isModerated = creation.is_moderated_error === true;
				if (!isModerated) {
					const existingModIcon = imageWrapper.querySelector('.creation-detail-error-icon-moderated');
					if (existingModIcon) existingModIcon.remove();
					imageWrapper.classList.remove('image-error-moderated');
				}
				imageWrapper.classList.add('image-error');
				if (isModerated) {
					imageWrapper.classList.add('image-error-moderated');
					if (!imageWrapper.querySelector('.creation-detail-error-icon-moderated')) {
						const moderatedIconEl = document.createElement('span');
						moderatedIconEl.className = 'creation-detail-error-icon-moderated';
						moderatedIconEl.setAttribute('role', 'img');
						moderatedIconEl.setAttribute('aria-label', 'Content moderated');
						moderatedIconEl.innerHTML = eyeHiddenIcon();
						imageWrapper.appendChild(moderatedIconEl);
					}
				}
			} else {
				imageWrapper?.classList.add('image-error');
			}
		}

		// Format date (tooltip only; no visible "time ago" on this page)
		const date = new Date(creation.created_at);
		const createdAtTitle = formatDateTime(date);

		// Generate title from published title or use default
		const isPublished = creation.published === true || creation.published === 1;
		const shareMountedPrivate = shareMounted && !isPublished;
		const displayTitle = creation.title || 'Untitled';
		const isUntitled = !creation.title;
		const groupTitleForSourceLabels =
			typeof creation.title === 'string' && creation.title.trim()
				? creation.title.trim()
				: 'Untitled';

		// Check if current user owns this creation
		let currentUserId = null;
		let currentUser = null;
		let currentUserProfile = null;
		try {
			const profile = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 2000 });
			if (!isCurrentLoad()) return;
			if (profile.ok) {
				currentUser = profile.data ?? null;
				currentUserProfile = currentUser?.profile ?? null;
				currentUserId = currentUser?.id ?? null;
			}
		} catch {
			// ignore
		}

		const isOwner = currentUserId && creation.user_id && currentUserId === creation.user_id;
		const isAdmin = currentUser?.role === 'admin';
		const canEdit = isOwner || isAdmin;
		const enableNsfw = currentUser?.enableNsfw === true;
		const showUnobscured = !getNsfwObscure() || document.body.classList.contains(NSFW_VIEW_BODY_CLASS);
		// Let global NSFW click handler know whether click-to-reveal is allowed on this page
		document.body.dataset.enableNsfw = enableNsfw ? '1' : '0';

		function escapeHtml(value) {
			return String(value ?? '')
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		}

		function isHydratedProviderPromptJson(argsPrompt) {
			if (typeof argsPrompt !== 'string' || !argsPrompt.trim().startsWith('{')) return false;
			try {
				const o = JSON.parse(argsPrompt);
				return Boolean(
					o &&
					typeof o === 'object' &&
					!Array.isArray(o) &&
					(o.cast != null || typeof o.prompt === 'string')
				);
			} catch {
				return false;
			}
		}

		/** Main UI: exact prompt as entered. Never the provider JSON (cast + expanded prompt); that stays in More Info. */
		function promptTextForMainUi(storedUserPrompt, argsPrompt) {
			const stored = typeof storedUserPrompt === 'string' ? storedUserPrompt.trim() : '';
			if (stored) return stored;
			if (typeof argsPrompt !== 'string') return '';
			const t = argsPrompt.trim();
			if (!t) return '';
			if (isHydratedProviderPromptJson(t)) return '';
			return t;
		}

		// Action buttons: visibility and disabled state (matches original DOM-update logic for all roles and creation states).
		// Publish/Edit/Unpublish/Retry/Delete: canEdit (owner or admin). Mutate: non-admin viewers only. Share: any viewer when not private share.
		// When admin is viewing a user-deleted creation, hide Publish and Edit (admin only gets e.g. Permanently delete).
		const userDeleted = Boolean(creation.user_deleted);
		const adminViewingUserDeleted = isAdmin && userDeleted;
		const showQueueForLater = !isAdmin && status === 'completed' && !isFailed && Boolean(creation.url);
		const showQueueFromFrame =
			!isAdmin &&
			status === 'completed' &&
			!isFailed &&
			mediaType === 'video' &&
			Boolean(creation.video_url);
		const showAdminVideoTools = isAdmin && !adminViewingUserDeleted && (status === 'completed' || status === 'failed');
		const normalizedImageUrlForQueue = showQueueForLater ? normalizeImageUrlForQueue(creation.url) : '';
		let isQueuedForLater = false;
		if (showQueueForLater && normalizedImageUrlForQueue) {
			try {
				const queueItems = loadMutateQueue();
				const creationIdNum = Number(creationId);
				isQueuedForLater = queueItems.some((item) => {
					const itemUrl = typeof item?.imageUrl === 'string' ? item.imageUrl : '';
					const itemSourceIdNum = Number(item?.sourceId);
					const matchesSourceId = Number.isFinite(itemSourceIdNum) && itemSourceIdNum > 0 && itemSourceIdNum === creationIdNum;
					const matchesUrl = itemUrl === normalizedImageUrlForQueue || normalizeImageUrlForQueue(itemUrl) === normalizedImageUrlForQueue;
					return matchesSourceId || matchesUrl;
				});
			} catch {
				// ignore storage errors
			}
		}
		const queueForLaterLabel = isQueuedForLater ? 'Remove from queue' : 'Queue for later';
		const hasDetailsForFailed = isFailed && (Object.keys(meta?.args || {}).length > 0 || (meta?.provider_error != null && typeof meta.provider_error === 'object'));
		const actionsContext = {
			showPublish:
				canEdit &&
				!isPublished &&
				status === 'completed' &&
				!isFailed &&
				!adminViewingUserDeleted &&
				!hasChallengeSubmission,
			showEdit: canEdit && status === 'completed' && !isFailed && !adminViewingUserDeleted,
			showUnpublish: canEdit && isPublished && !isFailed && !adminViewingUserDeleted,
			showMutate: !isAdmin && status === 'completed' && !isFailed && Boolean(creation.url),
			showShare: !shareMountedPrivate && status === 'completed' && !isFailed,
			showRetry: canEdit && isFailed && !adminViewingUserDeleted,
			showMoreInfoPill: hasDetailsForFailed,
			showDelete: canEdit && !isAdmin,
			showQueueForLater,
			showQueueFromFrame,
			queueForLaterLabel,
			isFailed,
			deleteDisabled: (userDeleted && isAdmin) ? false : !(!isPublished && (status === 'failed' || (status === 'creating' && isTimedOut) || status === 'completed')),
			deletePermanent: false,
			deleteLabel: userDeleted && isAdmin ? ' Permanently delete' : ' Delete'
		};
		const groupMeta = meta?.group && typeof meta.group === 'object' ? meta.group : null;
		const isGroupCreation = groupMeta?.kind === 'group_creations';
		if (isGroupCreation) {
			actionsContext.showEdit = false;
			actionsContext.showMutate = false;
			actionsContext.showShare = false;
			actionsContext.showRetry = false;
			actionsContext.showDelete = false;
			actionsContext.showQueueForLater = false;
			actionsContext.showQueueFromFrame = false;
			actionsContext.showMoreInfoPill = false;
		}
		const hasGroupPublishActions = Boolean(actionsContext.showPublish || actionsContext.showUnpublish);
		const groupSourcesRaw = Array.isArray(groupMeta?.source_creations) ? groupMeta.source_creations : [];
		const groupSourcesMapped = groupSourcesRaw
			.map((source, index) => {
				const sourceObj = source && typeof source === 'object' ? source : null;
				if (!sourceObj) return null;
				const sourceId = Number(sourceObj.id);
				if (!Number.isFinite(sourceId) || sourceId <= 0) return null;
				const sourceFilePathRaw = typeof sourceObj.file_path === 'string' ? sourceObj.file_path.trim() : '';
				const sourceFilePath = appendCreationIdToMediaUrl(sourceFilePathRaw, creationId);
				const sourceRawTitle = typeof sourceObj.title === 'string' ? sourceObj.title.trim() : '';
				const sourceDescription = typeof sourceObj.description === 'string' ? sourceObj.description.trim() : '';
				const sourceCreatedAt = typeof sourceObj.created_at === 'string' ? sourceObj.created_at : '';
				const sourceMeta = sourceObj.meta && typeof sourceObj.meta === 'object' ? sourceObj.meta : null;
				const sourceArgs = sourceMeta?.args && typeof sourceMeta.args === 'object' && !Array.isArray(sourceMeta.args)
					? sourceMeta.args
					: null;
				const sourceStoredPrompt = typeof sourceMeta?.user_prompt === 'string' ? sourceMeta.user_prompt.trim() : '';
				const sourceArgsPrompt = typeof sourceArgs?.prompt === 'string' ? sourceArgs.prompt.trim() : '';
				const sourcePrompt = promptTextForMainUi(sourceStoredPrompt, sourceArgsPrompt);
				const sourceServerName = typeof sourceMeta?.server_name === 'string' && sourceMeta.server_name.trim()
					? sourceMeta.server_name.trim()
					: (sourceMeta?.server_id != null ? String(sourceMeta.server_id) : '');
				const sourceMethodName = typeof sourceMeta?.method_name === 'string' && sourceMeta.method_name.trim()
					? sourceMeta.method_name.trim()
					: (typeof sourceMeta?.method === 'string' ? sourceMeta.method : '');
				const sourceDuration = formatDuration(sourceMeta || {});
				const sourceModelRaw = typeof sourceArgs?.model === 'string'
					? sourceArgs.model.trim()
					: String(sourceArgs?.model ?? '').trim();
				const sourceModel = sourceModelRaw
					? (sourceModelRaw.includes(':') ? sourceModelRaw.split(':')[0] : sourceModelRaw)
					: '';
				const sourceMetaItems = [];
				if (sourceServerName && sourceServerName !== 'Parascene') sourceMetaItems.push(`Server ${sourceServerName}`);
				if (sourceMethodName && sourceMethodName !== 'Replicate') sourceMetaItems.push(`Method ${sourceMethodName}`);
				if (sourceModel) sourceMetaItems.push(`Model ${sourceModel}`);
				if (sourceDuration) sourceMetaItems.push(`Duration ${sourceDuration}`);
				const sourceGenerationInfo = sourceMetaItems.join(' • ');
				return {
					id: sourceId,
					title: sourceRawTitle ? `${sourceRawTitle} (${sourceId})` : `${groupTitleForSourceLabels} (${sourceId})`,
					rawTitle: sourceRawTitle,
					filePath: sourceFilePath,
					description: sourceDescription,
					createdAt: sourceCreatedAt,
					prompt: sourcePrompt,
					generationInfo: sourceGenerationInfo
				};
			})
			.filter(Boolean);
		const coverSourceIdFromMeta = Number(groupMeta?.cover_source_id);
		const groupSources = [...groupSourcesMapped];
		if (Number.isFinite(coverSourceIdFromMeta) && coverSourceIdFromMeta > 0) {
			const coverIndex = groupSources.findIndex((source) => Number(source.id) === coverSourceIdFromMeta);
			if (coverIndex > 0) {
				const [coverSource] = groupSources.splice(coverIndex, 1);
				groupSources.unshift(coverSource);
			}
		}
		const allGroupSourceIds = groupSources
			.map((source) => Number(source?.id))
			.filter((id) => Number.isFinite(id) && id > 0);
		if (allGroupSourceIds.length > 0) {
			const liveTitleById = new Map();
			await Promise.allSettled(
				allGroupSourceIds.map(async (id) => {
					try {
						const res = await fetch(`/api/create/images/${id}`, lineageFetchInit);
						if (!res.ok) return;
						const payload = await res.json().catch(() => null);
						const liveTitle = typeof payload?.title === 'string' ? payload.title.trim() : '';
						if (liveTitle) liveTitleById.set(Number(id), liveTitle);
					} catch {
						// ignore per-source title fetch errors
					}
				})
			);
			for (const source of groupSources) {
				const sourceId = Number(source?.id);
				if (!Number.isFinite(sourceId) || sourceId <= 0) continue;
				const liveTitle = liveTitleById.get(sourceId);
				const fallbackTitle = typeof source?.rawTitle === 'string' ? source.rawTitle.trim() : '';
				const titleBase = liveTitle || fallbackTitle || groupTitleForSourceLabels;
				source.title = `${titleBase} (${sourceId})`;
			}
		}
		const hasGroupHeroNavigation = isGroupCreation && groupSources.length > 1;
		if (imageWrapper instanceof HTMLElement) {
			imageWrapper.onmouseenter = null;
			imageWrapper.onmouseleave = null;
		}
		if (groupHeroPrevBtn instanceof HTMLButtonElement) {
			groupHeroPrevBtn.hidden = true;
			groupHeroPrevBtn.disabled = true;
			groupHeroPrevBtn.onclick = null;
		}
		if (groupHeroNextBtn instanceof HTMLButtonElement) {
			groupHeroNextBtn.hidden = true;
			groupHeroNextBtn.disabled = true;
			groupHeroNextBtn.onclick = null;
		}
		const groupSectionHtml = isGroupCreation && groupSources.length > 0
			? html`
				<section class="creation-detail-group-section" data-group-creation-section>
					<div class="creation-detail-group-header">
						<h3 class="creation-detail-group-title">Grouped Creations</h3>
						<div class="creation-detail-group-subtitle">${groupSources.length} image${groupSources.length === 1 ? '' : 's'}</div>
					</div>
					<div class="creation-detail-group-grid">
						${groupSources.map((source, index) => source.filePath
					? html`<button type="button" class="creation-detail-group-item creation-detail-group-thumb${index === 0 ? ' is-active' : ''}"
									data-group-source-thumb="${source.id}" aria-label="View ${escapeHtml(source.title)}">
									<img src="${escapeHtml(source.filePath)}" alt="${escapeHtml(source.title)}" loading="eager" />
								</button>`
					: html`<button type="button" class="creation-detail-group-item creation-detail-group-item-fallback creation-detail-group-thumb${index === 0 ? ' is-active' : ''}"
									data-group-source-thumb="${source.id}" aria-label="View source #${source.id}">#${source.id}</button>`).join('')}
					</div>
					${isOwner ? html`
					<div class="creation-detail-group-actions">
						<button type="button" class="btn-secondary creation-detail-group-set-cover-btn" data-group-set-cover-btn disabled>Set as cover</button>
						${!isPublished
							? html`<button type="button" class="btn-secondary creation-detail-ungroup-btn" data-ungroup-btn>Ungroup Creations</button>`
							: ''}
					</div>
					` : ''}
				</section>
			`
			: '';

		// User-deleted notice (admin only; owner gets 404)
		let userDeletedNotice = '';
		if (creation.user_deleted) {
			userDeletedNotice = html`
				<div class="creation-detail-user-deleted-notice" role="status">
					<span class="creation-detail-user-deleted-notice-text">User deleted this creation. Visible to admin only.</span>
					<button type="button" class="btn-secondary creation-detail-user-deleted-restore-btn" data-admin-restore-user-deleted>Restore for user</button>
					<p class="creation-detail-user-deleted-restore-error" data-admin-restore-user-deleted-error hidden></p>
				</div>
			`;
		}

		// Published display:
		// - Show "Published {time ago}" directly under the user identification line.
		// - Keep description as its own block further down.
		const publishedDateRaw = creation.published_at || creation.created_at || null;
		const publishedDate = publishedDateRaw ? new Date(publishedDateRaw) : null;
		const hasPublishedDate = publishedDate instanceof Date && Number.isFinite(publishedDate.valueOf());
		const publishedTimeAgo = hasPublishedDate ? formatRelativeTime(publishedDate) : '';
		const publishedAtTitle = hasPublishedDate ? formatDateTime(publishedDate) : '';

		let publishedLabel = '';
		if (isPublished) {
			publishedLabel = html`
				<div class="creation-detail-author-published" ${publishedAtTitle ? `title="${publishedAtTitle}" ` : ''}>
					Published${publishedTimeAgo ? ` ${publishedTimeAgo}` : ''}
				</div>
			`;
		}

		// Mobile-only byline under title: "@handle Published 3 hr. ago" or "@handle Not Published"
		const mobileBylineText = isPublished ? (`Published${publishedTimeAgo ? ` ${publishedTimeAgo}` : ''}`) : 'Not Published';

		// Show description whenever it exists, regardless of publication status
		// History thumbnails (mutations lineage)
		const historyRaw = meta?.history;
		const historyIds = Array.isArray(historyRaw)
			? historyRaw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
			: [];

		const historyChainIds = [];
		const seenHistoryIds = new Set();
		for (const id of historyIds) {
			if (seenHistoryIds.has(id)) continue;
			seenHistoryIds.add(id);
			historyChainIds.push(id);
		}
		if (!seenHistoryIds.has(creationId)) {
			historyChainIds.push(creationId);
		}

		const lineageVideoPlayGlyphSvg =
			'<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
		const currentIndicatorHtml = `
			<button type="button" class="creation-detail-history-current creation-detail-history-lineage-btn" data-lineage-ancestor-open="${creationId}"
				aria-label="Current creation — open in lineage">
				<span class="creation-detail-history-current-text">current</span>
			</button>
		`;
		const lineageVideoPlayBtnHtml = `
			<button type="button" class="creation-detail-history-play-lineage-btn" data-lineage-video-playlist-btn hidden
				aria-label="Play video lineage">
				<span class="creation-detail-history-play-lineage-icon">${lineageVideoPlayGlyphSvg}</span>
			</button>
		`;

		// Ancestors: lineage chain (current "lineage" content). NSFW ancestors: blank + no link when !enableNsfw; blurred/unobscured when enableNsfw.
		let ancestorsHtml = '';
		let nsfwById = new Map();
		if (historyIds.length > 0 && historyChainIds.length >= 2) {
			const nonCurrentIds = historyChainIds.filter((id) => id !== creationId);
			try {
				const flagsRes = await fetch(`/api/creations/nsfw-flags?ids=${nonCurrentIds.join(',')}`, { credentials: 'include' });
				if (flagsRes.ok) {
					const flags = await flagsRes.json();
					if (flags && typeof flags === 'object') {
						for (const [k, v] of Object.entries(flags)) nsfwById.set(k, v === true);
					}
				}
			} catch {
				// ignore
			}
			const directParentIds = Array.isArray(meta?.direct_parent_ids)
				? meta.direct_parent_ids.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
				: [];
			const directParentSet = new Set(directParentIds);
			const usePlusBetween = directParentSet.size >= 2;

			async function fetchAncestorLineageSlot(id) {
				if (!enableNsfw && nsfwById.get(String(id)) === true) {
					return { id, mode: 'nsfw-hidden' };
				}
				try {
					const res = await fetch(`/api/create/images/${id}${lineageOfQuerySuffix}`, lineageFetchInit);
					if (!res.ok) return { id, mode: 'inaccessible' };
					const c = await res.json().catch(() => null);
					if (!c) return { id, mode: 'inaccessible' };
					const pub = c.published === true || c.published === 1;
					const thumb =
						(c.thumbnail_url && String(c.thumbnail_url).trim()) ||
						(c.url && String(c.url).trim()) ||
						null;
					return {
						id,
						mode: 'lineage-open',
						thumb,
						published: pub
					};
				} catch {
					return { id, mode: 'inaccessible' };
				}
			}

			const ancestorSlots = await Promise.all(nonCurrentIds.map((id) => fetchAncestorLineageSlot(id)));
			const slotById = new Map(ancestorSlots.map((s) => [s.id, s]));

			const parts = nonCurrentIds.map((id, index) => {
				const slot = slotById.get(id) || { id, mode: 'inaccessible' };
				const isLastAncestor = index === nonCurrentIds.length - 1;
				const nextId = nonCurrentIds[index + 1];
				const bothDirect = usePlusBetween && !isLastAncestor && directParentSet.has(id) && directParentSet.has(nextId);
				const separator = bothDirect ? '+' : '→';
				const nsfw = nsfwById.get(String(id)) === true;
				if (slot.mode === 'nsfw-hidden') {
					return `<button type="button" class="creation-detail-history-thumb-link creation-detail-history-nsfw-blank creation-detail-history-lineage-btn" data-lineage-ancestor-open="${id}"
						aria-label="${escapeHtml(`Lineage #${id}: hidden (NSFW)`)}">#${id}</button><span class="creation-detail-history-arrow" aria-hidden="true">${separator}</span>`;
				}
				const nsfwClass = enableNsfw && nsfw ? (showUnobscured ? ' nsfw nsfw-revealed' : ' nsfw') : '';
				const dataCreationId = enableNsfw && nsfw ? ` data-creation-id="${id}"` : '';

				if (slot.mode === 'lineage-open') {
					const t = (slot.thumb || '').trim();
					const inner = t
						? `<span class="creation-detail-history-fallback" data-history-fallback style="display: none;">#${id}</span><img class="creation-detail-history-thumb" src="${escapeHtml(t)}" alt="" loading="lazy" />`
						: `<span class="creation-detail-history-fallback" data-history-fallback>#${id}</span><img class="creation-detail-history-thumb" data-history-img alt="" loading="lazy" style="display: none;" />`;
					const pubHint = slot.published ? 'Published — open for details or full page' : 'Open for details';
					return `
				<button
					type="button"
					class="creation-detail-history-thumb-link creation-detail-history-lineage-btn${nsfwClass}"
					data-lineage-ancestor-open="${id}"
					aria-label="${escapeHtml(`Lineage #${id}: ${pubHint}`)}"${dataCreationId}
				>${inner}</button>
				<span class="creation-detail-history-arrow" aria-hidden="true">${separator}</span>
			`;
				}
				return `
				<button type="button" class="creation-detail-history-thumb-link creation-detail-history-unavailable creation-detail-history-lineage-btn" data-lineage-ancestor-open="${id}"
					aria-label="${escapeHtml(`Lineage #${id}: not available in preview — open for details`)}" title="Not available in preview">#${id}</button>
				<span class="creation-detail-history-arrow" aria-hidden="true">${separator}</span>
			`;
			}).join('');

			ancestorsHtml = html`
				<div class="creation-detail-history-wrap">
					<div class="creation-detail-history-header">
						<div class="creation-detail-history-label">Ancestors</div>
					</div>
					<div class="creation-detail-history" data-creation-history>
						${parts}${currentIndicatorHtml}${lineageVideoPlayBtnHtml}
					</div>
				</div>
			`;
		}

		// Full chain for lineage modal prev/next (ancestors then current), same order as history strip + current.
		const lineageModalChainIdsOrdered =
			historyIds.length > 0 && historyChainIds.length >= 2 ? [...historyChainIds] : [];

		// Children: direct derivatives (mutate_of_id = this creation). NSFW children: blank + no link when !enableNsfw; blurred/unobscured when enableNsfw.
		const childrenList = await childrenPromise;
		let childrenHtml = '';
		if (Array.isArray(childrenList) && childrenList.length > 0) {
			const childParts = childrenList.map((child) => {
				const cid = child.id;
				const childNsfw = !!child.nsfw;
				const thumbUrl = (child.thumbnail_url || child.url || '').trim();
				if (!enableNsfw && childNsfw) {
					return `<span class="creation-detail-history-thumb-link creation-detail-history-nsfw-blank" data-child-id="${cid}" aria-label="${escapeHtml(`Creation #${cid} (hidden)`)}">#${cid}</span>`;
				}
				const nsfwClass = enableNsfw && childNsfw ? (showUnobscured ? ' nsfw nsfw-revealed' : ' nsfw') : '';
				const dataCreationId = enableNsfw && childNsfw ? ` data-creation-id="${cid}"` : '';
				return `
				<a
					class="creation-detail-history-thumb-link${nsfwClass}"
					href="/creations/${cid}"
					aria-label="${escapeHtml(`Go to creation #${cid}`)}"
					data-child-id="${cid}"${dataCreationId}
				>
					<span class="creation-detail-history-fallback" data-child-fallback>#${cid}</span>
					<img class="creation-detail-history-thumb" data-child-img alt="" loading="lazy" style="display: none;" data-bg-url="${escapeHtml(thumbUrl)}" />
				</a>
			`;
			}).join('');
			childrenHtml = html`
				<div class="creation-detail-history-wrap">
					<div class="creation-detail-history-label">Children</div>
					<div class="creation-detail-history" data-creation-children>
						${childParts}
					</div>
				</div>
			`;
		}

		const lineageSectionHtml = ancestorsHtml + (childrenHtml || '');

		// Meta-derived values for description section (Server, Method, Duration, Prompt)
		const args = meta?.args ?? null;
		const isPlainObject = args && typeof args === 'object' && !Array.isArray(args);
		const storedUserPrompt = typeof meta?.user_prompt === 'string' ? meta.user_prompt.trim() : '';
		const rawArgsPrompt =
			isPlainObject && Object.prototype.hasOwnProperty.call(args, 'prompt') && typeof args.prompt === 'string'
				? args.prompt.trim()
				: '';
		const promptText = promptTextForMainUi(storedUserPrompt, rawArgsPrompt);
		const hasPrompt = promptText.length > 0;
		const legacyHydratedPromptOnly = !hasPrompt && isHydratedProviderPromptJson(rawArgsPrompt);
		const hasPromptSection = hasPrompt || legacyHydratedPromptOnly;
		const serverName = typeof meta?.server_name === 'string' && meta.server_name.trim()
			? meta.server_name.trim()
			: (meta?.server_id != null ? String(meta.server_id) : '');
		const methodName = typeof meta?.method_name === 'string' && meta.method_name.trim()
			? meta.method_name.trim()
			: (typeof meta?.method === 'string' ? meta.method : '');
		const durationStr = formatDuration(meta || {});

		// Display model from args (to the right of Method in meta bar). Strip after first colon if present.
		const rawModel = isPlainObject && Object.prototype.hasOwnProperty.call(args, 'model')
			? (typeof args.model === 'string' ? args.model.trim() : String(args.model ?? '').trim())
			: '';
		const displayModel = rawModel === ''
			? ''
			: (rawModel.includes(':') ? rawModel.split(':')[0] : rawModel);

		// Style from meta (stored when created via create.html with a style)
		const styleMeta = meta?.style && typeof meta.style === 'object' ? meta.style : null;
		const styleLabel = styleMeta && typeof styleMeta.label === 'string' ? styleMeta.label.trim() : '';
		const styleModifiers = styleMeta && typeof styleMeta.modifiers === 'string' ? styleMeta.modifiers.trim() : '';
		const hasStyle = styleLabel.length > 0;

		// Show description block if we have user description, lineage (ancestors/children), prompt, style, or meta (server/method/duration).
		let descriptionHtml = '';
		const descriptionText = typeof creation.description === 'string' ? creation.description.trim() : '';
		const hasDescription = descriptionText.length > 0;
		const showGroupLeadDescription = isGroupCreation && hasDescription;
		const groupLeadDescriptionHtml = showGroupLeadDescription
			? html`
				<div class="creation-detail-group-lead-description">
					<div class="creation-detail-description">${processUserText(descriptionText, { messageMarkdown: true })}</div>
				</div>
			`
			: '';
		const hasMetaInDescription = !!(serverName || methodName || displayModel || durationStr);
		const showDescriptionBlock =
			descriptionText || hasPromptSection || hasStyle || lineageSectionHtml || hasMetaInDescription;

		if (showDescriptionBlock) {
			const descriptionParts = [];
			const sameAsPrompt = hasDescription && hasPrompt && textsSameWithinTolerance(descriptionText, promptText);
			const renderDescriptionInMainBlock = hasDescription && !sameAsPrompt && !showGroupLeadDescription;

			if (renderDescriptionInMainBlock) {
				// Show description first (only when it differs from prompt)
				descriptionParts.push(processUserText(descriptionText, { messageMarkdown: true }));
			}

			if (hasPrompt) {
				// Show prompt section: when same as description, only show this; when different, show after description
				if (renderDescriptionInMainBlock) {
					descriptionParts.push('<br><br>');
				}
				descriptionParts.push(html`<div class="creation-detail-prompt-label-row">
	<span class="creation-detail-prompt-label">Prompt</span>
	<button type="button" class="creation-detail-copy-prompt" data-copy-prompt-btn aria-label="Copy prompt"
		title="Copy prompt">
		<svg class="creation-detail-copy-prompt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
			stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
			<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
		</svg>
	</button>
</div>`);
				descriptionParts.push(processUserText(promptText));
			} else if (legacyHydratedPromptOnly) {
				if (renderDescriptionInMainBlock) {
					descriptionParts.push('<br><br>');
				}
				descriptionParts.push(html`<div class="creation-detail-prompt-label">Prompt</div>`);
				descriptionParts.push(
					`<p class="creation-detail-prompt-legacy">The original prompt was not stored for this creation. Open <strong>More Info</strong> for the full provider payload (hydrated mentions and style).</p>`
				);
			}

			if (hasStyle) {
				if (descriptionParts.length) descriptionParts.push('<br><br>');
				descriptionParts.push(html`<div class="creation-detail-prompt-label">Style</div>`);
				descriptionParts.push(escapeHtml(styleLabel));
				if (styleModifiers) {
					descriptionParts.push(html`<div class="creation-detail-style-modifiers">${escapeHtml(styleModifiers)}</div>`);
				}
			}

			const descriptionInnerHtml = descriptionParts.length ? descriptionParts.join('') : '';

			// Build Server/Method/Duration line (outside collapsible)
			let metaLineHtml = '';
			if (serverName || methodName || displayModel || durationStr) {
				const metaItems = [];
				if (serverName && serverName !== 'Parascene') metaItems.push(html`<span class="creation-detail-description-meta-label">Server</span> <span
	class="creation-detail-description-meta-value">${escapeHtml(serverName)}</span>`);
				if (methodName && methodName !== 'Replicate') metaItems.push(html`<span class="creation-detail-description-meta-label">Method</span> <span
	class="creation-detail-description-meta-value">${escapeHtml(methodName)}</span>`);
				if (displayModel) metaItems.push(html`<span class="creation-detail-description-meta-label">Model</span> <span
	class="creation-detail-description-meta-value">${escapeHtml(displayModel)}</span>`);
				if (durationStr) metaItems.push(html`<span class="creation-detail-description-meta-label">Duration</span> <span
	class="creation-detail-description-meta-value">${escapeHtml(durationStr)}</span>`);
				metaLineHtml = html`<div class="creation-detail-description-meta-line">${metaItems.join(' • ')}</div>`;
			}

			descriptionHtml = html`
				<div class="creation-detail-published${lineageSectionHtml ? ' has-history' : ''}">
					${descriptionInnerHtml ? html`
					<div class="creation-detail-description-wrap" data-description-wrap>
						<div class="creation-detail-description" data-description>${descriptionInnerHtml}</div>
						<div class="creation-detail-description-toggle-row">
							<button type="button" class="btn-secondary creation-detail-description-toggle" data-description-toggle
								hidden>View Full</button>
						</div>
					</div>
					` : ''}
					${lineageSectionHtml}
					${metaLineHtml}
				</div>
			`;
		}

		// More Info: full provider payload (meta.args) and/or provider error.
		const providerError = meta?.provider_error ?? null;
		let hasDetailsModalContent = false;
		if (isPlainObject && args && Object.keys(args).length > 0) {
			hasDetailsModalContent = true;
		}
		if (!hasDetailsModalContent && providerError && typeof providerError === 'object') {
			hasDetailsModalContent = true;
		}


		// Get creator information
		const creatorUserName = typeof creation?.creator?.user_name === 'string' ? creation.creator.user_name.trim() : '';
		const creatorDisplayName = typeof creation?.creator?.display_name === 'string' ? creation.creator.display_name.trim() : '';
		const creatorEmailPrefix = creation.creator?.email
			? creation.creator.email.split('@')[0]
			: 'User';
		const creatorName = creatorDisplayName || creatorUserName || creatorEmailPrefix || 'User';
		const creatorHandle = creatorUserName
			? `@${creatorUserName}`
			: (creation.creator?.email ? `@${creatorEmailPrefix}` : '@user');
		const creatorInitial = creatorName.charAt(0).toUpperCase();
		const creatorAvatarUrl = typeof creation?.creator?.avatar_url === 'string' ? creation.creator.avatar_url.trim() : '';
		const creatorId = Number(creation?.creator?.id ?? creation?.user_id ?? 0);
		const creatorColor = getAvatarColor(creatorUserName || creatorEmailPrefix || String(creatorId || '') || creatorName);
		const creatorProfileHref = buildProfilePath({ userName: creatorUserName, userId: creatorId });
		const creatorPlan = creation?.creator?.plan === 'founder';

		addPageUsers([{
			user_id: creatorId,
			user_name: creatorUserName || (creation?.creator?.email ? creatorEmailPrefix : undefined),
			display_name: creatorDisplayName,
			avatar_url: creatorAvatarUrl
		}]);

		let canShowFollowButton = false;
		let viewerFollowsCreator = false;
		let creatorFollowerCount = 0;

		if (Number.isFinite(creatorId) && creatorId > 0) {
			try {
				const profileSummary = await fetchJsonWithStatusDeduped(
					`/api/users/${creatorId}/profile`,
					{ credentials: 'include' },
					{ windowMs: 800 }
				);
				if (profileSummary.ok && profileSummary.data) {
					creatorFollowerCount = Number(profileSummary.data.stats?.followers_count ?? 0) || 0;
					if (currentUserId && currentUserId !== creatorId) {
						viewerFollowsCreator = Boolean(profileSummary.data.viewer_follows);
						canShowFollowButton = !viewerFollowsCreator;
					}
				}
			} catch {
				// ignore follow state load failures; follow button will be hidden
			}
		}

		const viewerUserName = typeof currentUserProfile?.user_name === 'string' ? currentUserProfile.user_name.trim() : '';
		const viewerDisplayName = typeof currentUserProfile?.display_name === 'string' ? currentUserProfile.display_name.trim() : '';
		const viewerEmailPrefix = currentUser?.email
			? String(currentUser.email).split('@')[0]
			: 'You';
		const viewerName = viewerDisplayName || viewerUserName || viewerEmailPrefix || 'You';
		const viewerInitial = viewerName.charAt(0).toUpperCase();
		const viewerAvatarUrl = typeof currentUserProfile?.avatar_url === 'string' ? currentUserProfile.avatar_url.trim() : '';
		const viewerColor = getAvatarColor(viewerUserName || viewerEmailPrefix || String(currentUserId || '') || viewerName);
		const viewerPlan = currentUser?.plan === 'founder';

		const creatorAvatarContent = creatorAvatarUrl ? html`<img class="creation-detail-author-avatar" src="${creatorAvatarUrl}" alt="">` : creatorInitial;
		const authorAvatar = creatorPlan ? html`
			<div class="avatar-with-founder-flair avatar-with-founder-flair--sm">
				<div class="founder-flair-avatar-ring">
					<div class="founder-flair-avatar-inner"
						style="background: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx;" aria-hidden="true">
						${creatorAvatarContent}
					</div>
				</div>
			</div>
		` : html`
			<span class="creation-detail-author-icon" style="background: xxxxxxxxxxxxxxx;">
				${creatorAvatarContent}
			</span>
		`;

		const authorIdentification = html`
			<span class="creation-detail-author-name${creatorPlan ? ' founder-name' : ''}">${creatorName}</span>
			<span class="creation-detail-author-handle${creatorPlan ? ' founder-name' : ''}">${creatorHandle}</span>
		`;

		const hasEngagementActions = !!(isPublished && !isFailed);
		const copyLinkButtonHtml = `
			<button class="feed-card-action" type="button" data-copy-link-button aria-label="Copy link">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
					<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
				</svg>
				<span data-copy-link-label>Copy link</span>
			</button>
		`;
		const setAvatarButtonHtml = isOwner ? `
			<button class="feed-card-action" type="button" data-set-avatar-button aria-label="Set as profile picture">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
					<circle cx="12" cy="7" r="4"></circle>
				</svg>
				<span data-set-avatar-label>Set as profile picture</span>
			</button>
		` : '';

		const stripData = {
			creatorProfileHref,
			creatorName,
			authorAvatar,
			creatorFollowerCount,
			creatorId,
			isAdmin,
			canShowFollowButton,
			viewerFollowsCreator,
			hasEngagementActions,
			shareMountedPrivate,
			creationWithLikes,
			likeCount,
			actionsContext,
			isOwner,
			isFailed,
			hideActions: isGroupCreation && !hasGroupPublishActions
		};
		const menuData = {
			isFailed,
			hasDetailsModalContent,
			isOwner,
			isAdmin,
			actionsContext
		};

		const challengeTrophyIconSvg = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
	stroke-linejoin="round" aria-hidden="true">
	<path d="M8 21h8"></path>
	<path d="M12 17v4"></path>
	<path d="M7 4h10v5a5 5 0 0 1-10 0V4z"></path>
	<path d="M7 8H5a2 2 0 0 1-2-2V5h4"></path>
	<path d="M17 8h2a2 2 0 0 0 2-2V5h-4"></path>
</svg>`;
		const challengesChannelHref = '/chat/c/challenges';
		const challengeWithdrawBtnHtml =
			isOwner && hasChallengeSubmission
				? html`<button type="button" class="creation-detail-challenge-banner-withdraw" data-challenge-withdraw-btn>Remove from challenge</button>`
				: '';
		const challengeDetailBannerHtml = hasChallengeSubmission
			? html`
			<div class="creation-detail-challenge-banner" role="status">
				<div class="creation-detail-challenge-banner-main">
					<div class="creation-detail-challenge-banner-icon">${challengeTrophyIconSvg}</div>
					<div class="creation-detail-challenge-banner-body">
						<p class="creation-detail-challenge-banner-title">Challenge entry</p>
						<p class="creation-detail-challenge-banner-detail">${isOwner && !isPublished
							? 'This creation is entered in a challenge. Publishing is not available while it remains a challenge entry.'
							: 'This creation was submitted to a community challenge.'}</p>
					</div>
				</div>
				<div class="creation-detail-challenge-banner-actions">
					${challengeWithdrawBtnHtml}
					<a class="creation-detail-challenge-banner-link btn-outlined" href="${challengesChannelHref}">Open Challenges</a>
				</div>
			</div>`
			: '';

		const showChallengeSubmitCta =
			Boolean(creation.challenge_submit?.eligible) && mediaType !== 'video';
		const challengeSubmitCtaHtml = showChallengeSubmitCta
			? html`
			<div class="creation-detail-challenge-submit-cta">
				<button type="button" class="creation-detail-challenge-submit-btn" data-challenge-submit-detail-btn>
					<span class="creation-detail-challenge-submit-btn-icon" aria-hidden="true">${challengeTrophyIconSvg}</span>
					<span class="creation-detail-challenge-submit-btn-label">Submit to challenge</span>
				</button>
				<p class="creation-detail-challenge-submit-hint">Enter this creation in the active challenge (Chat → Challenges).</p>
			</div>`
			: '';

		const challengeSubmitModalHtml = showChallengeSubmitCta
			? html`
			<div class="creation-detail-challenge-submit-modal-overlay" data-challenge-submit-modal aria-hidden="true">
				<div class="creation-detail-challenge-submit-modal" role="dialog" aria-modal="true"
					aria-labelledby="challenge-submit-modal-title">
					<div class="creation-detail-challenge-submit-modal-header">
						<h3 id="challenge-submit-modal-title" class="creation-detail-challenge-submit-modal-heading">Submit to challenge?</h3>
						<button type="button" class="creation-detail-challenge-submit-modal-dismiss" data-challenge-submit-modal-dismiss
							aria-label="Close">
							<span aria-hidden="true">×</span>
						</button>
					</div>
					<div class="creation-detail-challenge-submit-modal-body">
						<p class="creation-detail-challenge-submit-modal-section-label">Current challenge</p>
						<h4 class="creation-detail-challenge-submit-modal-challenge-title" data-challenge-submit-modal-challenge-title></h4>
						<div class="creation-detail-challenge-submit-modal-challenge-details user-text" data-challenge-submit-modal-challenge-details></div>
						<p class="creation-detail-challenge-submit-modal-verify">Please confirm this creation fits the challenge theme and rules before you submit.</p>
					</div>
					<p class="creation-detail-challenge-submit-modal-error" data-challenge-submit-modal-error role="alert" hidden></p>
					<div class="creation-detail-challenge-submit-modal-footer">
						<button type="button" class="creation-detail-challenge-submit-modal-cancel" data-challenge-submit-modal-cancel>Cancel</button>
						<button type="button" class="btn-primary creation-detail-challenge-submit-modal-confirm" data-challenge-submit-modal-confirm>
							<span class="creation-detail-challenge-submit-modal-confirm-label">Submit</span>
							<span class="creation-detail-challenge-submit-modal-confirm-spinner" aria-hidden="true"></span>
						</button>
					</div>
				</div>
			</div>`
			: '';

		if (!isCurrentLoad()) return;

		detailContent.innerHTML = html`
			<div class="creation-detail-title-row">
				${(creation.nsfw ?? creation.meta?.nsfw) ? html`<span class="creation-detail-nsfw-tag">NSFW</span>` : ''}
				${hasChallengeSubmission ? html`<span class="creation-detail-challenge-chip" title="Entered in a community challenge">${challengeTrophyIconSvg}<span class="creation-detail-challenge-chip-label">Challenge entry</span></span>` :
				''}
				<div class="creation-detail-title${isUntitled ? ' creation-detail-title-untitled' : ''}">${escapeHtml(displayTitle)}
				</div>
			</div>
			${hasChallengeSubmission && isOwner ? '' : html`<div class="creation-detail-title-byline creation-detail-title-byline-mobile">${escapeHtml(creatorHandle)}
				${escapeHtml(mobileBylineText)}</div>`}
			${challengeDetailBannerHtml}
			${renderCreationDetailActionStrip(stripData, escapeHtml)}
			${isGroupCreation && !hasGroupPublishActions ? '' : renderCreationDetailMoreMenu(menuData, escapeHtml)}
			${groupLeadDescriptionHtml}
			${groupSectionHtml}
			${groupSectionHtml ? html`<div class="creation-detail-group-divider" aria-hidden="true"></div>` : ''}
			${userDeletedNotice}
			${showAdminVideoTools ? html`
			<div class="creation-detail-admin-video" data-admin-video-section>
				<p class="creation-detail-admin-video-label">${creation.video_url ? 'Replace video' : 'Add video'}</p>
				<form class="creation-detail-admin-video-form" data-admin-video-form>
					<input type="file" name="video" accept="video/*" class="creation-detail-admin-video-input"
						data-admin-video-input />
					<button type="submit" class="btn-primary creation-detail-admin-video-submit"
						data-admin-video-submit>${creation.video_url ? 'Replace' : 'Upload'}</button>
				</form>
				<div class="creation-detail-admin-video-repair" data-admin-provider-repair-wrap>
					<p class="creation-detail-admin-video-repair-label">Provider recovery</p>
					<p class="creation-detail-admin-video-repair-hint">Single request to the provider (same POST body as the worker poll). No QStash and no client-side polling—if the job is done, the response can be the video bytes in one round trip.</p>
					<button type="button" class="btn-secondary creation-detail-admin-provider-repair" data-admin-provider-repair>Fetch video from provider</button>
					<p class="creation-detail-admin-provider-repair-status" data-admin-provider-repair-status role="status" hidden></p>
				</div>
				<p class="creation-detail-admin-video-error" data-admin-video-error role="alert" style="display: none;"></p>
			</div>
			` : ''}
			
			${descriptionHtml}
			${challengeSubmitCtaHtml}
			<div class="creation-detail-meta-hidden" aria-hidden="true">
				${hasDetailsModalContent ? `
				<button class="feed-card-action" type="button" data-creation-details-link>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
						stroke-linejoin="round" aria-hidden="true">
						<circle cx="12" cy="12" r="10"></circle>
						<path d="M12 8v8"></path>
						<path d="M12 6h.01"></path>
					</svg>
					<span>More Info</span>
				</button>
				` : ''}
				${copyLinkButtonHtml}
				${setAvatarButtonHtml}
				<button class="feed-card-action" type="button" data-landscape-btn aria-label="Landscape" style="display: none;">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
						stroke-linejoin="round" aria-hidden="true">
						<rect x="2" y="6" width="20" height="12" rx="1.5" /></svg>
					<span data-landscape-btn-text>Landscape</span>
				</button>
			</div>
			
			${isPublished && !isFailed ? html`
			<div data-creation-comments-host></div>

			<section class="creation-detail-related" data-related-container aria-label="More like this" style="display: none;">
				<div class="creation-detail-related-inner">
					<h2 class="creation-detail-related-heading">More like this</h2>
					<div class="route-cards content-cards-image-grid creation-detail-related-grid" data-related-grid role="list">
					</div>
					<div class="creation-detail-related-sentinel" data-related-sentinel aria-hidden="true"></div>
				</div>
			</section>
			` : ''}
			<div class="creation-detail-set-avatar-modal-overlay" data-set-avatar-modal aria-hidden="true">
				<div class="creation-detail-set-avatar-modal">
					<h3>Set as profile picture?</h3>
					<p class="creation-detail-set-avatar-modal-message">This image will replace your current profile picture.</p>
					<p class="creation-detail-set-avatar-modal-error" data-set-avatar-modal-error role="alert"></p>
					<div class="creation-detail-set-avatar-modal-footer">
						<button type="button" class="btn-secondary" data-set-avatar-modal-cancel>Cancel</button>
						<button type="button" class="btn-primary creation-detail-set-avatar-confirm-btn"
							data-set-avatar-modal-confirm>
							<span class="creation-detail-set-avatar-confirm-label">Set as profile picture</span>
							<span class="creation-detail-set-avatar-confirm-spinner" aria-hidden="true"></span>
						</button>
					</div>
				</div>
			</div>
			${challengeSubmitModalHtml}
			<div class="creation-detail-lineage-modal-overlay" data-lineage-modal aria-hidden="true">
				<div class="creation-detail-lineage-modal" role="dialog" aria-modal="true" aria-labelledby="lineage-modal-title">
					<div class="creation-detail-lineage-modal-desktop-chrome">
						<button type="button" class="creation-detail-lineage-modal-close" data-lineage-modal-dismiss
							aria-label="Close">×</button>
						<h3 id="lineage-modal-title" class="creation-detail-lineage-modal-heading">Lineage</h3>
					</div>
					<header class="creation-detail-lineage-modal-mobile-chrome chat-page-mobile-chrome"
						aria-label="Lineage navigation">
						<div class="creation-detail-lineage-modal-mobile-chrome-toolbar">
							<button type="button" class="chat-page-mobile-chrome-back" data-lineage-modal-dismiss
								aria-label="Back">
								<span class="chat-page-back-icon" aria-hidden="true">&lt;-</span>
							</button>
							<h1 class="chat-page-mobile-chrome-title">
								<span class="chat-page-mobile-chrome-channel-part">
									<span class="chat-page-header-title-text">Lineage</span>
								</span>
							</h1>
						</div>
					</header>
					<div class="creation-detail-lineage-modal-scroll">
						<div class="creation-detail-lineage-modal-columns">
							<div class="creation-detail-lineage-modal-media-wrap">
								<div class="creation-detail-lineage-modal-media-stage" data-lineage-modal-media-stage>
									<div class="creation-detail-lineage-modal-media-aspect">
										<div class="creation-detail-lineage-modal-media-placeholder" data-lineage-media-placeholder
											aria-hidden="true"></div>
										<div class="creation-detail-lineage-modal-media-active" data-lineage-modal-active-media>
										</div>
									</div>
								</div>
								<div class="creation-detail-lineage-modal-nav" data-lineage-modal-nav hidden>
									<button type="button" class="creation-detail-lineage-modal-nav-btn" data-lineage-modal-prev
										aria-label="Previous in lineage">
										<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
											stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
											<path d="M15 18l-6-6 6-6" /></svg>
									</button>
									<span class="creation-detail-lineage-modal-nav-counter" data-lineage-modal-counter></span>
									<button type="button" class="creation-detail-lineage-modal-nav-btn" data-lineage-modal-next
										aria-label="Next in lineage">
										<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
											stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
											<path d="M9 18l6-6-6-6" /></svg>
									</button>
								</div>
							</div>
							<div class="creation-detail-lineage-modal-body" data-lineage-modal-body></div>
						</div>
					</div>
				</div>
			</div>
		`;

		/* When showing initial only (no avatar image), set --avatar-bg so the class uses it; with image, CSS uses var(--surface-strong) */
		const founderFlairEl = detailContent.querySelector('[data-founder-flair-avatar-bg]');
		if (founderFlairEl && !viewerAvatarUrl) founderFlairEl.style.setProperty('--avatar-bg', viewerColor);

		// Landscape (hidden trigger): only for owner, not admin, when published and completed.
		const landscapeBtn = detailContent.querySelector('[data-landscape-btn]');
		if (landscapeBtn) {
			const lurl = meta?.landscapeUrl;
			const hasLandscapeUrl = typeof lurl === 'string' && lurl !== 'loading' && !lurl.startsWith('error:') && (lurl.startsWith('http') || lurl.startsWith('/'));
			const showLandscape = isPublished && isOwner && !isAdmin && status === 'completed' && !isFailed;
			if (!showLandscape) {
				landscapeBtn.style.display = 'none';
			} else {
				landscapeBtn.style.display = '';
				landscapeBtn.disabled = false;
				landscapeBtn.dataset.landscapeHasUrl = hasLandscapeUrl ? '1' : '0';
				landscapeBtn.dataset.landscapeIsSelf = isOwner ? '1' : '0';
				const labelEl = landscapeBtn.querySelector('[data-landscape-btn-text]');
				if (labelEl) labelEl.textContent = 'Landscape';
			}
		}

		// After rendering description (and initial scaffold), hydrate link titles + media embeds.
		if (typeof hydrateRichUserTextEmbeds === 'function') {
			hydrateRichUserTextEmbeds(detailContent);
		} else {
			hydrateUserTextLinks(detailContent);
		}
		setupCollapsibleDescription(detailContent);

		const copyPromptBtn = detailContent.querySelector('[data-copy-prompt-btn]');
		if (copyPromptBtn instanceof HTMLButtonElement) {
			copyPromptBtn.addEventListener('click', async (e) => {
				e.preventDefault();
				e.stopPropagation();
				await copyTextToClipboard(promptText);
			});
		}

		const lineageModalOverlay = detailContent.querySelector('[data-lineage-modal]');
		const lineageModalDismissers = detailContent.querySelectorAll('[data-lineage-modal-dismiss]');
		const lineageModalActiveMedia = detailContent.querySelector('[data-lineage-modal-active-media]');
		const lineageModalMediaPlaceholder = detailContent.querySelector('[data-lineage-media-placeholder]');
		const lineageModalMediaStage = detailContent.querySelector('[data-lineage-modal-media-stage]');
		const lineageModalBody = detailContent.querySelector('[data-lineage-modal-body]');
		const lineageModalNav = detailContent.querySelector('[data-lineage-modal-nav]');
		let lineageModalEscHandler = null;
		let lineageNavIds = [];
		let lineageNavIndex = 0;
		const lineageModalCreationById = new Map();

		function creationJsonIsLineageVideo(c) {
			if (!c || typeof c !== 'object') return false;
			if ((c.status || 'completed') !== 'completed') return false;
			const m = c.meta && typeof c.meta === 'object' ? c.meta : {};
			const mt = typeof m.media_type === 'string' ? m.media_type : '';
			if (mt === 'video' && c.video_url) return true;
			return Boolean(c.video_url);
		}

		/** meta.history is oldest → newest; current is last in the chain. */
		async function collectLineageVideoSlidesOldestFirst() {
			const chain =
				lineageModalChainIdsOrdered.length > 0 ? [...lineageModalChainIdsOrdered] : [];
			if (chain.length === 0) return [];
			await prefetchLineageModalCreationsAndMedia(chain);
			const out = [];
			for (const id of chain) {
				const c = lineageModalCreationById.get(id);
				if (!creationJsonIsLineageVideo(c)) continue;
				const url = String(c.video_url || '').trim();
				if (!url) continue;
				const w = Number(c.width);
				const h = Number(c.height);
				const slide = { url, creationId: id };
				if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
					slide.width = w;
					slide.height = h;
				}
				out.push(slide);
			}
			return out;
		}

		async function openLineageVideoPlaylist() {
			const pageVideo = document.querySelector('video[data-video]');
			let shouldResumePageVideo = false;
			if (pageVideo instanceof HTMLVideoElement && !pageVideo.paused) {
				shouldResumePageVideo = true;
				pageVideo.pause();
			}
			const slides = await collectLineageVideoSlidesOldestFirst();
			if (slides.length === 0) {
				if (shouldResumePageVideo && pageVideo instanceof HTMLVideoElement) {
					if (typeof safeMediaPlay === 'function') safeMediaPlay(pageVideo);
					else void pageVideo.play().catch(() => {});
				}
				showToast('No videos in this lineage');
				return;
			}
			if (!creationDetailInlineLightboxMod?.openChatVideoGalleryLightbox) {
				if (shouldResumePageVideo && pageVideo instanceof HTMLVideoElement) {
					if (typeof safeMediaPlay === 'function') safeMediaPlay(pageVideo);
					else void pageVideo.play().catch(() => {});
				}
				return;
			}
			creationDetailInlineLightboxMod.openChatVideoGalleryLightbox(slides, {
				galleryLabel: 'Video lineage',
				startIndex: 0,
				loopGallery: true,
				autoAdvanceOnEnded: true,
				onClose: () => {
					if (!shouldResumePageVideo || !(pageVideo instanceof HTMLVideoElement)) return;
					shouldResumePageVideo = false;
					if (typeof safeMediaPlay === 'function') safeMediaPlay(pageVideo);
					else void pageVideo.play().catch(() => {});
				},
			});
		}


		function preloadLineageImageUrl(url) {
			if (!url || typeof url !== 'string') return Promise.resolve();
			return new Promise((resolve) => {
				const im = new Image();
				const done = () => resolve();
				im.onload = done;
				im.onerror = done;
				im.decoding = 'async';
				im.src = url;
				if (im.complete) done();
			});
		}

		function preloadLineageVideoUrl(url) {
			if (!url || typeof url !== 'string') return Promise.resolve();
			return new Promise((resolve) => {
				const v = document.createElement('video');
				const done = () => resolve();
				v.addEventListener('loadeddata', done, { once: true });
				v.addEventListener('error', done, { once: true });
				v.preload = 'auto';
				v.muted = true;
				v.playsInline = true;
				v.src = url;
				try {
					v.load();
				} catch {
					done();
				}
			});
		}

		function preloadLineageCreationMediaFromJson(c) {
			if (!c || typeof c !== 'object') return Promise.resolve();
			const m = c.meta && typeof c.meta === 'object' ? c.meta : {};
			const st = c.status || 'completed';
			if (st !== 'completed') return Promise.resolve();
			const mt = typeof m.media_type === 'string' ? m.media_type : 'image';
			if (mt === 'video' && c.video_url) return preloadLineageVideoUrl(String(c.video_url));
			if (c.url) return preloadLineageImageUrl(String(c.url));
			return Promise.resolve();
		}

		async function prefetchLineageModalCreationsAndMedia(ids) {
			const unique = [
				...new Set(
					(ids || [])
						.map((x) => Number(x))
						.filter((n) => Number.isFinite(n) && n > 0)
				),
			];
			if (unique.length === 0) return;
			await Promise.allSettled(
				unique.map(async (id) => {
					const res = await fetch(`/api/create/images/${id}${lineageOfQuerySuffix}`, lineageFetchInit);
					if (!res.ok) return null;
					const c = await res.json().catch(() => null);
					if (!c) return null;
					lineageModalCreationById.set(id, c);
					await preloadLineageCreationMediaFromJson(c);
					return c;
				})
			);
		}

		function showLineageMediaPlaceholder() {
			if (lineageModalMediaPlaceholder) lineageModalMediaPlaceholder.classList.remove('is-hidden');
			if (lineageModalMediaStage) lineageModalMediaStage.classList.remove('is-media-ready');
			if (lineageModalActiveMedia) lineageModalActiveMedia.innerHTML = '';
		}

		function showLineageModalMediaUnavailable() {
			if (lineageModalMediaPlaceholder) lineageModalMediaPlaceholder.classList.add('is-hidden');
			if (lineageModalMediaStage) lineageModalMediaStage.classList.add('is-media-ready');
			if (lineageModalActiveMedia) {
				lineageModalActiveMedia.innerHTML =
					'<div class="creation-detail-lineage-modal-media-unavailable" role="img" aria-label="Image unavailable"></div>';
			}
		}

		function showLineageModalStepLoadFailed(reason) {
			const r = reason === 'not_found' ? 'not_found' : reason === 'json' ? 'json' : reason === 'network' ? 'network' : 'http';
			const lines = {
				not_found: 'This step was not found or is not available with your account.',
				json: 'This step could not be loaded (invalid response from the server).',
				network: 'This step could not be loaded (network error).',
				http: 'This step could not be loaded (server error).',
			};
			const msg = lines[r] || lines.http;
			if (lineageModalBody) {
				lineageModalBody.innerHTML = `<p class="creation-detail-lineage-modal-load-fail" role="alert">${escapeHtml(msg)}</p>`;
			}
			showLineageModalMediaUnavailable();
			updateLineageNavControls();
		}

		function closeLineageModal() {
			if (!lineageModalOverlay) return;
			lineageModalOverlay.classList.remove('open');
			lineageModalOverlay.setAttribute('aria-hidden', 'true');
			document.body.classList.remove('modal-open');
			if (lineageModalEscHandler) {
				document.removeEventListener('keydown', lineageModalEscHandler);
				lineageModalEscHandler = null;
			}
			lineageNavIds = [];
			lineageNavIndex = 0;
			lineageModalCreationById.clear();
			if (lineageModalActiveMedia) lineageModalActiveMedia.innerHTML = '';
			if (lineageModalBody) lineageModalBody.innerHTML = '';
			if (lineageModalNav) lineageModalNav.hidden = true;
			showLineageMediaPlaceholder();
		}

		function updateLineageNavControls() {
			if (!lineageModalNav || !lineageModalOverlay) return;
			const prev = lineageModalOverlay.querySelector('[data-lineage-modal-prev]');
			const next = lineageModalOverlay.querySelector('[data-lineage-modal-next]');
			const counter = lineageModalOverlay.querySelector('[data-lineage-modal-counter]');
			if (lineageNavIds.length <= 1) {
				lineageModalNav.hidden = true;
				return;
			}
			lineageModalNav.hidden = false;
			if (prev) prev.disabled = lineageNavIndex <= 0;
			if (next) next.disabled = lineageNavIndex >= lineageNavIds.length - 1;
			if (counter) counter.textContent = `${lineageNavIndex + 1} / ${lineageNavIds.length}`;
		}

		function fillLineageModalFromCreation(c, opts = {}) {
			if (!lineageModalActiveMedia || !lineageModalBody) return;
			const skipMediaPlaceholder = opts.skipMediaPlaceholder === true;
			const m = c?.meta && typeof c.meta === 'object' ? c.meta : {};
			const args = m.args ?? null;
			const isPo = args && typeof args === 'object' && !Array.isArray(args);
			const storedPr = typeof m.user_prompt === 'string' ? m.user_prompt.trim() : '';
			const rawPr = isPo && typeof args.prompt === 'string' ? args.prompt.trim() : '';
			const pText = promptTextForMainUi(storedPr, rawPr);
			const pub = c.published === true || c.published === 1;
			const st = c.status || 'completed';
			const mt = typeof m.media_type === 'string' ? m.media_type : 'image';
			const revealMedia = () => {
				if (lineageModalMediaPlaceholder) lineageModalMediaPlaceholder.classList.add('is-hidden');
				if (lineageModalMediaStage) lineageModalMediaStage.classList.add('is-media-ready');
			};
			const w = Number(c.width);
			const h = Number(c.height);
			const dimAttr =
				Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0
					? ` width="${Math.round(w)}" height="${Math.round(h)}"`
					: '';

			if (!skipMediaPlaceholder) showLineageMediaPlaceholder();

			if (st !== 'completed') {
				lineageModalActiveMedia.innerHTML = `<p class="creation-detail-lineage-modal-status">Status: ${escapeHtml(st)}</p>`;
				revealMedia();
			} else if (mt === 'video' && c.video_url) {
				lineageModalActiveMedia.innerHTML = `<video class="creation-detail-lineage-modal-img creation-detail-lineage-modal-img--contain" controls playsinline src="${escapeHtml(String(c.video_url))}"></video>`;
				const v = lineageModalActiveMedia.querySelector('video');
				if (v) {
					const done = () => revealMedia();
					v.addEventListener('loadeddata', done, { once: true });
					v.addEventListener('error', done, { once: true });
				} else {
					revealMedia();
				}
			} else if (c.url) {
				lineageModalActiveMedia.innerHTML = `<img class="creation-detail-lineage-modal-img creation-detail-lineage-modal-img--contain" src="${escapeHtml(String(c.url))}" alt="" decoding="async"${dimAttr} />`;
				const img = lineageModalActiveMedia.querySelector('img');
				if (img) {
					if (img.complete) revealMedia();
					else {
						img.addEventListener('load', () => revealMedia(), { once: true });
						img.addEventListener('error', () => revealMedia(), { once: true });
					}
				} else {
					revealMedia();
				}
			} else {
				lineageModalActiveMedia.innerHTML = '<p class="creation-detail-lineage-modal-status">No media available for this step.</p>';
				revealMedia();
			}

			const cr = c.creator && typeof c.creator === 'object' ? c.creator : null;
			const creatorUserName = typeof cr?.user_name === 'string' ? cr.user_name.trim() : '';
			const creatorDisplayName = typeof cr?.display_name === 'string' ? cr.display_name.trim() : '';
			const creatorEmailPrefix = cr?.email ? String(cr.email).split('@')[0] : '';
			const creatorName = creatorDisplayName || creatorUserName || creatorEmailPrefix || 'User';
			const creatorHandle = creatorUserName
				? `@${creatorUserName}`
				: (cr?.email ? `@${creatorEmailPrefix}` : '');
			const creatorInitial = creatorName.charAt(0).toUpperCase();
			const creatorAvatarUrl = typeof cr?.avatar_url === 'string' ? cr.avatar_url.trim() : '';
			const creatorId = Number(cr?.id ?? c.user_id ?? 0);
			const creatorColor = getAvatarColor(creatorUserName || creatorEmailPrefix || String(creatorId || '') || creatorName);
			const creatorProfileHref = buildProfilePath({ userName: creatorUserName, userId: creatorId });
			const creatorPlan = cr?.plan === 'founder';
			const avatarInner = creatorAvatarUrl
				? `<img class="creation-detail-author-avatar" src="${escapeHtml(creatorAvatarUrl)}" alt="">`
				: escapeHtml(creatorInitial);
			const avatarSlot = creatorPlan
				? `<div class="avatar-with-founder-flair avatar-with-founder-flair--sm"><div class="founder-flair-avatar-ring"><div class="founder-flair-avatar-inner" style="background: ${escapeHtml(creatorColor)};" aria-hidden="true">${avatarInner}</div></div></div>`
				: `<span class="creation-detail-author-icon" style="background: ${escapeHtml(creatorColor)};">${avatarInner}</span>`;
			const rawTitle = c.title == null ? '' : String(c.title).trim();
			const headlineTitle = rawTitle || (pub ? 'Untitled' : `#${c.id}`);
			const isUntitledHeadline = Boolean(pub && !rawTitle);
			const descRaw = c.description == null ? '' : String(c.description).trim();
			const publishedDateRaw = c.published_at || c.created_at || null;
			const publishedDate = publishedDateRaw ? new Date(publishedDateRaw) : null;
			const hasPublishedDate = publishedDate instanceof Date && Number.isFinite(publishedDate.valueOf());
			const publishedTimeAgo =
				pub && hasPublishedDate ? formatRelativeTime(publishedDate) || '' : '';
			const bylineHtml = `${creatorHandle ? `${escapeHtml(creatorHandle)} ` : ''}${pub ? `Published${publishedTimeAgo ? ` ${escapeHtml(publishedTimeAgo)}` : ''}` : 'Not published'}`;
			const descSection = descRaw
				? `<div class="creation-detail-lineage-modal-copy"><div class="creation-detail-prompt-label-row"><span class="creation-detail-prompt-label">Description</span></div><div class="creation-detail-description creation-detail-lineage-modal-prose">${processUserText(descRaw, { messageMarkdown: true })}</div></div>`
				: '';
			const promptSection = pText
				? `<div class="creation-detail-lineage-modal-copy"><div class="creation-detail-prompt-label-row"><span class="creation-detail-prompt-label">Prompt</span></div><div class="creation-detail-description creation-detail-lineage-modal-prose creation-detail-lineage-modal-prose--prompt">${processUserText(pText)}</div></div>`
				: '';
			const serverName =
				typeof m.server_name === 'string' && m.server_name.trim()
					? m.server_name.trim()
					: (m.server_id != null ? String(m.server_id) : '');
			const methodName =
				typeof m.method_name === 'string' && m.method_name.trim()
					? m.method_name.trim()
					: typeof m.method === 'string'
						? m.method
						: '';
			const rawModel =
				isPo && Object.prototype.hasOwnProperty.call(args, 'model')
					? typeof args.model === 'string'
						? args.model.trim()
						: String(args.model ?? '').trim()
					: '';
			const displayModel =
				rawModel === '' ? '' : rawModel.includes(':') ? rawModel.split(':')[0] : rawModel;
			const durationStr = formatDuration(m || {});
			let serverMethodMetaLine = '';
			if (serverName || methodName || displayModel || durationStr) {
				const metaItems = [];
				if (serverName && serverName !== 'Parascene') {
					metaItems.push(
						`<span class="creation-detail-description-meta-label">Server</span> <span class="creation-detail-description-meta-value">${escapeHtml(serverName)}</span>`
					);
				}
				if (methodName && methodName !== 'Replicate') {
					metaItems.push(
						`<span class="creation-detail-description-meta-label">Method</span> <span class="creation-detail-description-meta-value">${escapeHtml(methodName)}</span>`
					);
				}
				if (displayModel) {
					metaItems.push(
						`<span class="creation-detail-description-meta-label">Model</span> <span class="creation-detail-description-meta-value">${escapeHtml(displayModel)}</span>`
					);
				}
				if (durationStr) {
					metaItems.push(
						`<span class="creation-detail-description-meta-label">Duration</span> <span class="creation-detail-description-meta-value">${escapeHtml(durationStr)}</span>`
					);
				}
				if (metaItems.length > 0) {
					serverMethodMetaLine = `<div class="creation-detail-description-meta-line creation-detail-lineage-modal-server-meta">${metaItems.join(' • ')}</div>`;
				}
			}
			const styleMeta = m.style && typeof m.style === 'object' ? m.style : null;
			const styleLabel = styleMeta && typeof styleMeta.label === 'string' ? styleMeta.label.trim() : '';
			const styleModifiers = styleMeta && typeof styleMeta.modifiers === 'string' ? styleMeta.modifiers.trim() : '';
			const styleSection =
				styleLabel.length > 0
					? `<div class="creation-detail-lineage-modal-copy"><div class="creation-detail-prompt-label-row"><span class="creation-detail-prompt-label">Style</span></div><div class="creation-detail-description creation-detail-lineage-modal-prose">${escapeHtml(styleLabel)}${styleModifiers ? `<div class="creation-detail-style-modifiers">${escapeHtml(styleModifiers)}</div>` : ''}</div></div>`
					: '';
			const createdRaw = c.created_at ? new Date(c.created_at) : null;
			const createdOk = createdRaw instanceof Date && Number.isFinite(createdRaw.valueOf());
			const createdRel =
				createdOk ? escapeHtml(formatRelativeTime(createdRaw) || formatDateTime(createdRaw)) : '';
			const creationHref = `/creations/${escapeHtml(String(c.id))}`;
			const stepIdNum = Number(c.id);
			const pageCreationIdNum = Number(creationId);
			const isCurrentCreation =
				Number.isFinite(stepIdNum) &&
				stepIdNum > 0 &&
				Number.isFinite(pageCreationIdNum) &&
				pageCreationIdNum > 0 &&
				stepIdNum === pageCreationIdNum;
			const openLinkSvg = `<svg class="creation-detail-lineage-modal-creation-link-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>`;
			const publishedCta = pub && !isCurrentCreation
				? `<p class="creation-detail-lineage-modal-published"><span class="creation-detail-lineage-modal-published-label">Published</span><a class="creation-detail-lineage-modal-creation-link creation-detail-lineage-modal-creation-link--inline creation-detail-lineage-modal-creation-link--cta" href="${creationHref}" aria-label="View full creation">${openLinkSvg}<span class="creation-detail-lineage-modal-creation-link-text">View creation</span></a></p>`
				: '';
			const metaTitleAttr =
				createdOk ? ` title="${escapeHtml(formatDateTime(createdRaw))}"` : '';
			const avatarInnerCell = `<div class="creation-detail-author-avatar-slot">${avatarSlot}</div>`;
			const avatarCell = creatorProfileHref
				? `<a class="user-link user-avatar-link" href="${escapeHtml(creatorProfileHref)}" aria-label="View ${escapeHtml(creatorName)} profile">${avatarInnerCell}</a>`
				: `<div class="creation-detail-lineage-modal-avatar-wrap">${avatarInnerCell}</div>`;
			const currentBadge = isCurrentCreation
				? '<p class="creation-detail-lineage-modal-current">Current step</p>'
				: '';
			lineageModalBody.innerHTML = `
				<div class="creation-detail-lineage-modal-info">
					<div class="creation-detail-title-row">
						<div class="creation-detail-title${isUntitledHeadline ? ' creation-detail-title-untitled' : ''}">${escapeHtml(headlineTitle)}</div>
					</div>
					<div class="creation-detail-title-byline creation-detail-title-byline-mobile creation-detail-lineage-modal-byline">${bylineHtml}</div>
					${publishedCta}
					<div class="feed-card-footer-grid creation-detail-lineage-modal-footer">
						${avatarCell}
						<div class="feed-card-content">
							<div class="feed-card-title creation-detail-lineage-modal-creator-name${creatorPlan ? ' founder-name' : ''}">${escapeHtml(creatorName)}</div>
							<div class="feed-card-metadata creation-detail-lineage-modal-creation-meta"${metaTitleAttr}>
								<span>#${escapeHtml(String(c.id))}</span>${createdOk ? `<span class="creation-detail-lineage-modal-meta-sep" aria-hidden="true">·</span><span>${createdRel}</span>` : ''}
							</div>
						</div>
					</div>
					${currentBadge}
					${descSection}
					${promptSection}
				${styleSection}
				${serverMethodMetaLine}
				</div>
			`;
			try {
				if (lineageModalOverlay) {
					if (typeof hydrateRichUserTextEmbeds === 'function') {
						hydrateRichUserTextEmbeds(lineageModalOverlay);
					} else {
						hydrateUserTextLinks(lineageModalOverlay);
					}
				}
			} catch {
				// ignore
			}
			updateLineageNavControls();
		}

		async function loadLineageModalAtCurrentIndex() {
			const id = Number(lineageNavIds[lineageNavIndex]);
			if (!lineageModalOverlay || !lineageModalActiveMedia || !lineageModalBody) return;
			if (!Number.isFinite(id) || id <= 0) return;
			updateLineageNavControls();
			const cached = lineageModalCreationById.get(id);
			if (cached) {
				fillLineageModalFromCreation(cached, { skipMediaPlaceholder: true });
				return;
			}
			showLineageMediaPlaceholder();
			lineageModalBody.innerHTML = '<p class="creation-detail-lineage-modal-loading">Loading…</p>';
			try {
				const res = await fetch(`/api/create/images/${id}${lineageOfQuerySuffix}`, lineageFetchInit);
				if (!res.ok) {
					showLineageModalStepLoadFailed(res.status === 404 ? 'not_found' : 'http');
					return;
				}
				const c = await res.json().catch(() => null);
				if (!c) {
					showLineageModalStepLoadFailed('json');
					return;
				}
				lineageModalCreationById.set(id, c);
				await preloadLineageCreationMediaFromJson(c);
				fillLineageModalFromCreation(c, { skipMediaPlaceholder: true });
			} catch {
				showLineageModalStepLoadFailed('network');
			}
		}

		async function openLineageModal(ancestorId) {
			if (!lineageModalOverlay || !lineageModalActiveMedia || !lineageModalBody) return;
			const idNum = Number(ancestorId);
			lineageModalCreationById.clear();
			lineageNavIds =
				lineageModalChainIdsOrdered.length > 0
					? [...lineageModalChainIdsOrdered]
					: (Number.isFinite(idNum) && idNum > 0 ? [idNum] : []);
			let idx = lineageNavIds.indexOf(idNum);
			if (idx < 0 && Number.isFinite(idNum) && idNum > 0) {
				lineageNavIds = [idNum];
				idx = 0;
			}
			lineageNavIndex = idx >= 0 ? idx : 0;
			showLineageMediaPlaceholder();
			lineageModalBody.innerHTML = '<p class="creation-detail-lineage-modal-loading">Loading…</p>';
			lineageModalOverlay.classList.add('open');
			lineageModalOverlay.removeAttribute('aria-hidden');
			document.body.classList.add('modal-open');
			lineageModalEscHandler = (e) => {
				if (e.key === 'Escape') {
					closeLineageModal();
					return;
				}
				if (e.key === 'ArrowLeft' && lineageNavIndex > 0) {
					e.preventDefault();
					lineageNavIndex -= 1;
					void loadLineageModalAtCurrentIndex();
					return;
				}
				if (e.key === 'ArrowRight' && lineageNavIndex < lineageNavIds.length - 1) {
					e.preventDefault();
					lineageNavIndex += 1;
					void loadLineageModalAtCurrentIndex();
				}
			};
			document.addEventListener('keydown', lineageModalEscHandler);
			try {
				await prefetchLineageModalCreationsAndMedia(lineageNavIds);
			} catch {
				// still try to show current step from network
			}
			await loadLineageModalAtCurrentIndex();
		}

		const historyRootForLineage = detailContent.querySelector('[data-creation-history]');
		if (historyRootForLineage) {
			historyRootForLineage.addEventListener('click', (e) => {
				const btn = e.target.closest('[data-lineage-ancestor-open]');
				if (!btn || !historyRootForLineage.contains(btn)) return;
				e.preventDefault();
				const raw = btn.getAttribute('data-lineage-ancestor-open');
				const id = Number(raw);
				if (!Number.isFinite(id) || id <= 0) return;
				void openLineageModal(id);
			});
			historyRootForLineage.addEventListener(
				'error',
				(e) => {
					const t = e.target;
					if (!(t instanceof HTMLImageElement) || !t.classList.contains('creation-detail-history-thumb')) return;
					if (!historyRootForLineage.contains(t)) return;
					t.style.display = 'none';
					const fb = t.closest('button')?.querySelector('[data-history-fallback]');
					if (fb instanceof HTMLElement) fb.style.removeProperty('display');
				},
				true
			);
		}

		lineageModalDismissers.forEach((el) => {
			if (el instanceof HTMLElement) el.addEventListener('click', () => closeLineageModal());
		});
		if (lineageModalOverlay) {
			lineageModalOverlay.addEventListener('click', (e) => {
				if (e.target === lineageModalOverlay) {
					closeLineageModal();
					return;
				}
				if (e.target.closest('[data-lineage-modal-prev]')) {
					e.preventDefault();
					if (lineageNavIndex > 0) {
						lineageNavIndex -= 1;
						void loadLineageModalAtCurrentIndex();
					}
					return;
				}
				if (e.target.closest('[data-lineage-modal-next]')) {
					e.preventDefault();
					if (lineageNavIndex < lineageNavIds.length - 1) {
						lineageNavIndex += 1;
						void loadLineageModalAtCurrentIndex();
					}
				}
			});
		}

		const lineageVideoPlaylistBtn = detailContent.querySelector('[data-lineage-video-playlist-btn]');
		if (lineageVideoPlaylistBtn instanceof HTMLButtonElement && lineageModalChainIdsOrdered.length >= 2) {
			lineageVideoPlaylistBtn.addEventListener('click', (e) => {
				e.preventDefault();
				void openLineageVideoPlaylist();
			});
			void (async () => {
				const slides = await collectLineageVideoSlidesOldestFirst();
				if (slides.length >= 2) lineageVideoPlaylistBtn.hidden = false;
			})();
		}

		// Hydrate ancestor thumbnails when the slot had no thumb URL (rare): fill img[data-history-img] inside lineage buttons.
		if (historyIds.length > 0) {
			const historyRoot = detailContent.querySelector('[data-creation-history]');
			if (historyRoot) {
				const needThumb = Array.from(
					historyRoot.querySelectorAll('button[data-lineage-ancestor-open] img[data-history-img]')
				).filter((img) => img instanceof HTMLImageElement && !(img.getAttribute('src') || '').trim());
				if (needThumb.length > 0) {
					const results = await Promise.allSettled(
						needThumb.map((img) => {
							const btn = img.closest('button[data-lineage-ancestor-open]');
							const raw = btn && btn.getAttribute('data-lineage-ancestor-open');
							const id = raw != null ? Number(raw) : NaN;
							if (!Number.isFinite(id) || id <= 0) return Promise.resolve(null);
							return fetch(`/api/create/images/${id}${lineageOfQuerySuffix}`, lineageFetchInit)
								.then((r) => (r.ok ? r.json() : null))
								.then((c) => (c?.thumbnail_url || c?.url || '').trim() || null);
						})
					);
					for (let i = 0; i < needThumb.length; i++) {
						const img = needThumb[i];
						const r = results[i];
						const url = r.status === 'fulfilled' ? r.value : null;
						if (!url || !(img instanceof HTMLImageElement)) continue;
						img.src = url;
						img.style.display = '';
						const fallback = img.closest('button')?.querySelector('[data-history-fallback]');
						if (fallback instanceof HTMLElement) fallback.style.display = 'none';
					}
				}
			}
		}

		// Hydrate children thumbnails (URLs from API). NSFW blanks are spans with no img; for NSFW links add nsfw-revealed when showUnobscured.
		const childrenRoot = detailContent.querySelector('[data-creation-children]');
		if (childrenRoot) {
			const imgs = childrenRoot.querySelectorAll('img[data-child-img][data-bg-url]');
			for (const img of imgs) {
				if (!(img instanceof HTMLImageElement)) continue;
				const bgUrl = (img.getAttribute('data-bg-url') || '').trim();
				if (!bgUrl) continue;
				img.src = bgUrl;
				img.style.display = '';
				const link = img.closest('a');
				if (link && showUnobscured && link.classList.contains('nsfw')) {
					link.classList.add('nsfw-revealed');
				}
				const fallback = link?.querySelector('[data-child-fallback]');
				if (fallback instanceof HTMLElement) fallback.style.display = 'none';
			}
		}

		const likeButtons = detailContent.querySelectorAll('button[data-like-button]');
		if (!shareMountedPrivate) {
			likeButtons.forEach((btn) => initLikeButton(btn, creationWithLikes));
		} else {
			likeButtons.forEach((btn) => { btn.style.display = 'none'; });
		}

		const copyLinkBtn = detailContent.querySelector('button[data-copy-link-button]');
		const copyLinkLabel = detailContent.querySelector('[data-copy-link-label]');
		if (copyLinkBtn instanceof HTMLButtonElement) {
			if (shareMountedPrivate) {
				copyLinkBtn.style.display = 'none';
			}
			copyLinkBtn.addEventListener('click', async () => {
				const url = getPrimaryLinkUrl(creationId);
				const ok = await copyTextToClipboard(url);
				if (copyLinkLabel) {
					if (ok) {
						copyLinkLabel.textContent = 'Copied';
						showToast('Link copied');
					} else {
						copyLinkLabel.textContent = 'Copy failed';
						showToast('Copy failed');
					}
					window.setTimeout(() => {
						if (copyLinkLabel && copyLinkLabel.isConnected) {
							copyLinkLabel.textContent = 'Copy link';
						}
					}, 1500);
				} else if (ok) {
					showToast('Link copied');
				} else {
					showToast('Copy failed');
				}
			});
		}

		const setAvatarBtn = detailContent.querySelector('button[data-set-avatar-button]');
		const setAvatarLabel = detailContent.querySelector('[data-set-avatar-label]');
		const setAvatarModal = detailContent.querySelector('[data-set-avatar-modal]');
		const setAvatarModalCancel = detailContent.querySelector('[data-set-avatar-modal-cancel]');
		const setAvatarModalConfirm = detailContent.querySelector('[data-set-avatar-modal-confirm]');
		const setAvatarModalError = detailContent.querySelector('[data-set-avatar-modal-error]');

		function openSetAvatarModal() {
			if (setAvatarModal) {
				setAvatarModal.classList.add('open');
				setAvatarModal.removeAttribute('aria-hidden');
				document.body.classList.add('modal-open');
				setAvatarModalEscapeHandler = (e) => {
					if (e.key !== 'Escape') return;
					e.preventDefault();
					closeSetAvatarModal();
				};
				document.addEventListener('keydown', setAvatarModalEscapeHandler);
			}
			if (setAvatarModalError) {
				setAvatarModalError.textContent = '';
				setAvatarModalError.classList.remove('visible');
			}
			if (setAvatarModalConfirm) {
				setAvatarModalConfirm.disabled = false;
				setAvatarModalConfirm.classList.remove('is-loading');
			}
		}

		let setAvatarModalEscapeHandler = null;

		function closeSetAvatarModal() {
			if (setAvatarModal) {
				setAvatarModal.classList.remove('open');
				setAvatarModal.setAttribute('aria-hidden', 'true');
				document.body.classList.remove('modal-open');
				if (setAvatarModalEscapeHandler) {
					document.removeEventListener('keydown', setAvatarModalEscapeHandler);
					setAvatarModalEscapeHandler = null;
				}
			}
		}

		if (setAvatarBtn instanceof HTMLButtonElement) {
			setAvatarBtn.addEventListener('click', () => openSetAvatarModal());
		}

		if (setAvatarModalCancel) {
			setAvatarModalCancel.addEventListener('click', () => closeSetAvatarModal());
		}

		if (setAvatarModalConfirm) {
			setAvatarModalConfirm.addEventListener('click', async () => {
				if (setAvatarModalConfirm.classList.contains('is-loading')) return;
				if (setAvatarModalError) {
					setAvatarModalError.textContent = '';
					setAvatarModalError.classList.remove('visible');
				}
				setAvatarModalConfirm.disabled = true;
				setAvatarModalConfirm.classList.add('is-loading');
				try {
					const result = await fetchJsonWithStatusDeduped('/api/profile/avatar-from-creation', {
						method: 'POST',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ creation_id: creationId })
					}, { windowMs: 0 });
					if (result.ok) {
						window.location.reload();
						return;
					}
					const errMsg = result.data?.error || 'Failed to set profile picture';
					if (setAvatarModalError) {
						setAvatarModalError.textContent = errMsg;
						setAvatarModalError.classList.add('visible');
					}
				} catch {
					if (setAvatarModalError) {
						setAvatarModalError.textContent = 'Something went wrong. Please try again.';
						setAvatarModalError.classList.add('visible');
					}
				} finally {
					setAvatarModalConfirm.disabled = false;
					setAvatarModalConfirm.classList.remove('is-loading');
				}
			});
		}

		// Close set-avatar modal on overlay click
		if (setAvatarModal) {
			setAvatarModal.addEventListener('click', (e) => {
				if (e.target === setAvatarModal) closeSetAvatarModal();
			});
		}

		// Admin: add or replace video on completed creation
		const adminVideoForm = detailContent.querySelector('[data-admin-video-form]');
		if (adminVideoForm) {
			const adminVideoInput = detailContent.querySelector('[data-admin-video-input]');
			const adminVideoSubmit = detailContent.querySelector('[data-admin-video-submit]');
			const adminVideoError = detailContent.querySelector('[data-admin-video-error]');
			adminVideoForm.addEventListener('submit', async (e) => {
				e.preventDefault();
				if (!adminVideoInput?.files?.length) {
					if (adminVideoError) {
						adminVideoError.textContent = 'Please select a video file.';
						adminVideoError.style.display = '';
					}
					return;
				}
				if (adminVideoError) {
					adminVideoError.textContent = '';
					adminVideoError.style.display = 'none';
				}
				if (adminVideoSubmit) {
					adminVideoSubmit.disabled = true;
				}
				try {
					const formData = new FormData();
					formData.append('video', adminVideoInput.files[0]);
					const res = await fetch(`/api/create/images/${creationId}/admin-add-video`, {
						method: 'POST',
						credentials: 'include',
						body: formData
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) {
						if (adminVideoError) {
							adminVideoError.textContent = data?.message || data?.error || 'Upload failed.';
							adminVideoError.style.display = '';
						}
						return;
					}
					await loadCreation();
				} catch {
					if (adminVideoError) {
						adminVideoError.textContent = 'Upload failed. Please try again.';
						adminVideoError.style.display = '';
					}
				} finally {
					if (adminVideoSubmit) {
						adminVideoSubmit.disabled = false;
					}
				}
			});
		}

		const adminRestoreUserDeletedBtn = detailContent.querySelector('[data-admin-restore-user-deleted]');
		const adminRestoreUserDeletedErr = detailContent.querySelector('[data-admin-restore-user-deleted-error]');
		if (adminRestoreUserDeletedBtn instanceof HTMLButtonElement) {
			adminRestoreUserDeletedBtn.addEventListener('click', async () => {
				if (adminRestoreUserDeletedErr instanceof HTMLElement) {
					adminRestoreUserDeletedErr.hidden = true;
					adminRestoreUserDeletedErr.textContent = '';
				}
				adminRestoreUserDeletedBtn.disabled = true;
				try {
					const res = await fetch(`/api/create/images/${creationId}/admin-restore-user-delete`, {
						method: 'POST',
						credentials: 'include'
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) {
						if (adminRestoreUserDeletedErr instanceof HTMLElement) {
							adminRestoreUserDeletedErr.textContent =
								data?.error || data?.message || `Request failed (${res.status})`;
							adminRestoreUserDeletedErr.hidden = false;
						}
						return;
					}
					await loadCreation();
				} catch {
					if (adminRestoreUserDeletedErr instanceof HTMLElement) {
						adminRestoreUserDeletedErr.textContent = 'Request failed. Please try again.';
						adminRestoreUserDeletedErr.hidden = false;
					}
				} finally {
					adminRestoreUserDeletedBtn.disabled = false;
				}
			});
		}

		const adminProviderRepairBtn = detailContent.querySelector('[data-admin-provider-repair]');
		const adminProviderRepairStatus = detailContent.querySelector('[data-admin-provider-repair-status]');
		if (adminProviderRepairBtn instanceof HTMLButtonElement) {
			adminProviderRepairBtn.addEventListener('click', async () => {
				const adminVideoErrorEl = detailContent.querySelector('[data-admin-video-error]');
				if (adminProviderRepairStatus) {
					adminProviderRepairStatus.hidden = false;
					adminProviderRepairStatus.textContent = 'Contacting provider…';
				}
				adminProviderRepairBtn.disabled = true;
				if (adminVideoErrorEl) {
					adminVideoErrorEl.textContent = '';
					adminVideoErrorEl.style.display = 'none';
				}
				try {
					const res = await fetch(`/admin/creations/${creationId}/provider-async-video-recovery`, {
						method: 'POST',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ mode: 'repair' }),
					});
					const data = await res.json().catch(() => ({}));
					const repair = data.repair != null ? data.repair : data;
					const ok = res.ok && repair && repair.repaired === true;
					const detail =
						repair?.summary ||
						repair?.message ||
						(repair?.upload_error ? `Upload: ${repair.upload_error}` : '') ||
						data?.error ||
						(!res.ok ? `HTTP ${res.status}` : '');
					if (adminProviderRepairStatus) {
						adminProviderRepairStatus.textContent = ok
							? `${detail || 'Done.'} Reloading…`
							: detail || 'Could not recover video from provider.';
					}
					if (ok) {
						await loadCreation();
					} else if (adminVideoErrorEl && (detail || !res.ok)) {
						adminVideoErrorEl.textContent = adminProviderRepairStatus?.textContent || detail || 'Recovery failed';
						adminVideoErrorEl.style.display = '';
					}
				} catch (err) {
					if (adminProviderRepairStatus) {
						adminProviderRepairStatus.textContent = err?.message || 'Request failed';
					}
				} finally {
					adminProviderRepairBtn.disabled = false;
				}
			});
		}

		// Overflow indicators: left fade when scrolled, right fade when more content to scroll (fades are on outer strip so they stay fixed)
		const actionStrip = detailContent.querySelector('.creation-detail-action-strip');
		const actionStripScroll = detailContent.querySelector('.creation-detail-action-strip-scroll');
		const scrollEl = actionStripScroll || actionStrip;
		if (actionStrip && scrollEl) {
			const updateOverflowIndicator = () => {
				const hasOverflow = scrollEl.scrollWidth > scrollEl.clientWidth;
				const atStart = scrollEl.scrollLeft <= 2;
				const atEnd = scrollEl.scrollLeft >= scrollEl.scrollWidth - scrollEl.clientWidth - 2;
				actionStrip.classList.toggle('has-overflow-left', hasOverflow && !atStart);
				actionStrip.classList.toggle('has-overflow-right', hasOverflow && !atEnd);
			};
			updateOverflowIndicator();
			scrollEl.addEventListener('scroll', updateOverflowIndicator);
			const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateOverflowIndicator) : null;
			if (ro) ro.observe(scrollEl);
		}

		const tipCreatorBtn = detailContent.querySelector('button[data-tip-creator-button]');
		if (tipCreatorBtn instanceof HTMLButtonElement) {
			// Hide tip button for private shares, when viewer is the creator, or when credits are below threshold.
			const currentUserCredits = typeof currentUser?.credits === 'number' ? currentUser.credits : null;
			if (
				shareMountedPrivate ||
				currentUserId === creatorId ||
				(currentUserCredits !== null && currentUserCredits < TIP_MIN_VISIBLE_BALANCE)
			) {
				tipCreatorBtn.style.display = 'none';
			}
			tipCreatorBtn.addEventListener('click', () => {
				document.dispatchEvent(new CustomEvent('open-tip-creator-modal', {
					detail: {
						userId: creatorId,
						userName: creatorHandle || creatorName,
						createdImageId: creationId,
						viewerBalance: typeof currentUser?.credits === 'number' ? currentUser.credits : null
					}
				}));
			});
		}

		const detailsBtn = detailContent.querySelector('[data-creation-details-link]');
		const openDetailsModal = () => {
			document.dispatchEvent(new CustomEvent('open-creation-details-modal', {
				detail: {
					creationId,
					meta,
					description: descriptionText
				}
			}));
		};
		if (detailsBtn && meta && hasDetailsModalContent) {
			detailsBtn.addEventListener('click', openDetailsModal);
		}
		detailContent.querySelectorAll('[data-more-info-btn]').forEach((btn) => {
			if (btn instanceof HTMLButtonElement && meta) {
				btn.addEventListener('click', openDetailsModal);
			}
		});

		const followButtons = detailContent.querySelectorAll('[data-follow-button]');
		followButtons.forEach((followButton) => {
			if (!(followButton instanceof HTMLButtonElement)) return;
			let busy = false;

			followButton.addEventListener('click', async () => {
				if (busy) return;

				const targetIdRaw = followButton.getAttribute('data-follow-user-id') || '';
				const targetId = Number.parseInt(targetIdRaw, 10);
				if (!Number.isFinite(targetId) || targetId <= 0) return;

				busy = true;
				followButtons.forEach((btn) => { btn.disabled = true; });

				const result = await fetchJsonWithStatusDeduped(
					`/api/users/${targetId}/follow`,
					{
						method: 'POST',
						credentials: 'include'
					},
					{ windowMs: 0 }
				).catch(() => ({ ok: false, status: 0, data: null }));

				if (!result.ok) {
					busy = false;
					followButtons.forEach((btn) => { btn.disabled = false; });
					return;
				}

				// Once the viewer follows the creator, hide all follow buttons.
				followButtons.forEach((btn) => { btn.style.display = 'none'; });
			});
		});

		const challengeSubmitModal = detailContent.querySelector('[data-challenge-submit-modal]');
		const challengeSubmitModalDismiss = detailContent.querySelector('[data-challenge-submit-modal-dismiss]');
		const challengeSubmitModalCancel = detailContent.querySelector('[data-challenge-submit-modal-cancel]');
		const challengeSubmitModalConfirm = detailContent.querySelector('[data-challenge-submit-modal-confirm]');
		const challengeSubmitModalError = detailContent.querySelector('[data-challenge-submit-modal-error]');
		const challengeSubmitModalTitleSlot = detailContent.querySelector('[data-challenge-submit-modal-challenge-title]');
		const challengeSubmitModalDetailsSlot = detailContent.querySelector('[data-challenge-submit-modal-challenge-details]');

		let challengeSubmitModalEscapeHandler = null;

		function populateChallengeSubmitModal() {
			const ch = lastCreationMeta?.challenge_submit?.challenge;
			const safeTitle =
				typeof ch?.title === 'string' && ch.title.trim()
					? ch.title.trim()
					: 'Challenge';
			if (challengeSubmitModalTitleSlot) {
				challengeSubmitModalTitleSlot.textContent = safeTitle;
			}
			if (challengeSubmitModalDetailsSlot) {
				const d = typeof ch?.details === 'string' ? ch.details.trim() : '';
				if (d) {
					challengeSubmitModalDetailsSlot.innerHTML = processUserText(d);
					if (typeof hydrateRichUserTextEmbeds === 'function') {
						hydrateRichUserTextEmbeds(challengeSubmitModalDetailsSlot);
					} else {
						hydrateUserTextLinks(challengeSubmitModalDetailsSlot);
					}
				} else {
					challengeSubmitModalDetailsSlot.innerHTML =
						'<p class="creation-detail-challenge-submit-modal-no-details">No additional description was provided for this challenge.</p>';
				}
			}
		}

		function openChallengeSubmitModal() {
			if (!(challengeSubmitModal instanceof HTMLElement)) return;
			populateChallengeSubmitModal();
			if (challengeSubmitModalError instanceof HTMLElement) {
				challengeSubmitModalError.textContent = '';
				challengeSubmitModalError.hidden = true;
			}
			if (challengeSubmitModalConfirm instanceof HTMLButtonElement) {
				challengeSubmitModalConfirm.disabled = false;
				challengeSubmitModalConfirm.classList.remove('is-loading');
			}
			challengeSubmitModal.classList.add('open');
			challengeSubmitModal.removeAttribute('aria-hidden');
			document.body.classList.add('modal-open');
			challengeSubmitModalEscapeHandler = (e) => {
				if (e.key !== 'Escape') return;
				e.preventDefault();
				closeChallengeSubmitModal();
			};
			document.addEventListener('keydown', challengeSubmitModalEscapeHandler);
		}

		function closeChallengeSubmitModal() {
			if (!(challengeSubmitModal instanceof HTMLElement)) return;
			challengeSubmitModal.classList.remove('open');
			challengeSubmitModal.setAttribute('aria-hidden', 'true');
			document.body.classList.remove('modal-open');
			if (challengeSubmitModalEscapeHandler) {
				document.removeEventListener('keydown', challengeSubmitModalEscapeHandler);
				challengeSubmitModalEscapeHandler = null;
			}
			if (challengeSubmitModalConfirm instanceof HTMLButtonElement) {
				challengeSubmitModalConfirm.disabled = false;
				challengeSubmitModalConfirm.classList.remove('is-loading');
			}
		}

		async function runChallengeSubmitFromModalConfirm() {
			const btn = challengeSubmitModalConfirm;
			if (!(btn instanceof HTMLButtonElement) || btn.disabled || btn.classList.contains('is-loading')) return;
			if (challengeSubmitModalError instanceof HTMLElement) {
				challengeSubmitModalError.textContent = '';
				challengeSubmitModalError.hidden = true;
			}
			btn.disabled = true;
			btn.classList.add('is-loading');
			try {
				const v = getAssetVersionParam();
				const qs = getImportQuery(v);
				const ctxMod = await import(`/shared/challengeSubmitContext.js${qs}`);
				const fromApi = Number(lastCreationMeta?.challenge_submit?.thread_id);
				const fromCtx = Number(ctxMod.readChallengeSubmitContext?.()?.threadId);
				const tid =
					Number.isFinite(fromApi) && fromApi > 0
						? fromApi
						: Number.isFinite(fromCtx) && fromCtx > 0
							? fromCtx
							: NaN;
				if (!Number.isFinite(tid) || tid <= 0) {
					const msg = 'Could not resolve the Challenges channel. Open Chat → Challenges and try again.';
					if (challengeSubmitModalError instanceof HTMLElement) {
						challengeSubmitModalError.textContent = msg;
						challengeSubmitModalError.hidden = false;
					} else {
						showToast(msg);
					}
					return;
				}
				const res = await fetch(`/api/create/images/${creationId}/challenge-submit`, {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ thread_id: tid })
				});
				const data = await res.json().catch(() => ({}));
				if (!res.ok) {
					const errMsg = data?.error || data?.message || 'Could not submit to challenge';
					if (challengeSubmitModalError instanceof HTMLElement) {
						challengeSubmitModalError.textContent = errMsg;
						challengeSubmitModalError.hidden = false;
					} else {
						showToast(errMsg);
					}
					return;
				}
				closeChallengeSubmitModal();
				showToast('Submitted to challenge');
				loadCreation();
			} catch (err) {
				const msg = err?.message || 'Could not submit';
				if (challengeSubmitModalError instanceof HTMLElement) {
					challengeSubmitModalError.textContent = msg;
					challengeSubmitModalError.hidden = false;
				} else {
					showToast(msg);
				}
			} finally {
				if (btn instanceof HTMLButtonElement) {
					btn.disabled = false;
					btn.classList.remove('is-loading');
				}
			}
		}

		const challengeSubmitDetailBtn = detailContent.querySelector('[data-challenge-submit-detail-btn]');
		if (challengeSubmitDetailBtn instanceof HTMLButtonElement) {
			challengeSubmitDetailBtn.addEventListener('click', (e) => {
				e.preventDefault();
				openChallengeSubmitModal();
			});
		}

		const challengeWithdrawBtn = detailContent.querySelector('[data-challenge-withdraw-btn]');
		if (challengeWithdrawBtn instanceof HTMLButtonElement) {
			challengeWithdrawBtn.addEventListener('click', async () => {
				if (
					!window.confirm(
						'Remove this creation from the challenge? Your submission in the Challenges channel will be deleted.'
					)
				) {
					return;
				}
				challengeWithdrawBtn.disabled = true;
				try {
					const res = await fetch(`/api/create/images/${creationId}/challenge-withdraw`, {
						method: 'POST',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' }
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) {
						showToast(data?.error || data?.message || 'Could not remove from challenge');
						return;
					}
					showToast('Removed from challenge');
					loadCreation();
				} catch (err) {
					showToast(err?.message || 'Could not remove from challenge');
				} finally {
					challengeWithdrawBtn.disabled = false;
				}
			});
		}

		if (challengeSubmitModalDismiss instanceof HTMLButtonElement) {
			challengeSubmitModalDismiss.addEventListener('click', () => closeChallengeSubmitModal());
		}

		if (challengeSubmitModalCancel instanceof HTMLButtonElement) {
			challengeSubmitModalCancel.addEventListener('click', () => closeChallengeSubmitModal());
		}

		if (challengeSubmitModalConfirm instanceof HTMLButtonElement) {
			challengeSubmitModalConfirm.addEventListener('click', () => {
				void runChallengeSubmitFromModalConfirm();
			});
		}

		if (challengeSubmitModal instanceof HTMLElement) {
			challengeSubmitModal.addEventListener('click', (e) => {
				if (e.target === challengeSubmitModal) closeChallengeSubmitModal();
			});
		}

		// Mobile more button popup: open/close and trigger same actions as meta row
		const moreBtn = detailContent.querySelector('[data-creation-more-btn]');
		const moreMenu = detailContent.querySelector('[data-creation-more-menu]');
		if (moreBtn instanceof HTMLButtonElement && moreMenu instanceof HTMLElement) {
			const closeMobileMoreMenu = () => {
				moreMenu.setAttribute('aria-hidden', 'true');
				moreMenu.style.display = 'none';
				document.body.style.overflow = '';
				document.removeEventListener('click', onDocumentClick);
			};
			const onDocumentClick = (e) => {
				if (!moreMenu.contains(e.target) && !moreBtn.contains(e.target)) {
					closeMobileMoreMenu();
				}
			};
			moreBtn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const isOpen = moreMenu.getAttribute('aria-hidden') !== 'true';
				if (isOpen) {
					closeMobileMoreMenu();
					return;
				}
				const rect = moreBtn.getBoundingClientRect();
				const gap = 8;
				moreMenu.style.position = 'fixed';
				moreMenu.style.display = 'block';
				moreMenu.style.bottom = '';
				const menuW = moreMenu.offsetWidth || 200;
				const menuH = moreMenu.offsetHeight || 200;
				const spaceBelow = window.innerHeight - rect.bottom - gap;
				const openAbove = spaceBelow < menuH && rect.top >= menuH + gap;
				if (openAbove) {
					moreMenu.style.top = `${Math.max(gap, rect.top - menuH - 4)}px`;
				} else {
					moreMenu.style.top = `${Math.min(window.innerHeight - menuH - gap, rect.bottom + 4)}px`;
				}
				moreMenu.style.left = `${Math.max(gap, Math.min(rect.right - menuW, window.innerWidth - menuW - gap))}px`;
				moreMenu.setAttribute('aria-hidden', 'false');
				document.body.style.overflow = 'hidden';
				setTimeout(() => document.addEventListener('click', onDocumentClick), 0);
			});
			moreMenu.addEventListener('click', (e) => {
				const item = e.target?.closest?.('[data-creation-more-action]');
				if (!item) return;
				e.preventDefault();
				e.stopPropagation();
				const action = item.getAttribute('data-creation-more-action');
				const targets = {
					'more-info': () => detailContent.querySelector('[data-creation-details-link]')?.click(),
					'copy-link': () => detailContent.querySelector('[data-copy-link-button]')?.click(),
					'set-avatar': () => detailContent.querySelector('button[data-set-avatar-button]')?.click(),
					'landscape': () => { const b = detailContent.querySelector('[data-landscape-btn]'); if (b && !b.disabled) b.click(); },
					'unpublish': () => handleUnpublish(),
					'delete': () => handleDelete(actionsContext?.deletePermanent),
					'queue-for-later': () => {
						if (!showQueueForLater || !normalizedImageUrlForQueue) return;
						const sourceId = Number(creationId);
						const labelEl = item.querySelector('[data-queue-for-later-label]');
						const currentlyQueued = loadMutateQueue().some((q) => {
							const sid = Number(q?.sourceId);
							const url = typeof q?.imageUrl === 'string' ? q.imageUrl : '';
							return (Number.isFinite(sid) && sid === sourceId) || url === normalizedImageUrlForQueue || normalizeImageUrlForQueue(url) === normalizedImageUrlForQueue;
						});
						if (currentlyQueued) {
							try {
								removeFromMutateQueueByImageUrl(normalizedImageUrlForQueue);
								if (labelEl) labelEl.textContent = 'Queue for later';
								showToast('Removed from queue');
							} catch {
								// ignore storage errors
							}
						} else {
							try {
								addToMutateQueue({ sourceId, imageUrl: normalizedImageUrlForQueue, published: isPublished });
								if (labelEl) labelEl.textContent = 'Remove from queue';
								showToast('Added to queue');
							} catch {
								// ignore storage errors
							}
						}
					},
					'queue-from-frame': async () => {
						if (!showQueueFromFrame || !creation.video_url) return;
						closeMobileMoreMenu();
						await loadDeps();
						if (typeof openQueueFromFrameModal !== 'function') return;
						openQueueFromFrameModal({
							videoUrl: String(creation.video_url),
							sourceId: Number(creationId),
							published: isPublished,
							uploadImageFile,
							addToMutateQueue,
							showToast,
						});
					},
				};
				if (typeof targets[action] === 'function') targets[action]();
				closeMobileMoreMenu();
			});
		}

		// Admin: upload video to creation
		const adminUploadSection = detailContent.querySelector('[data-admin-upload-video]');
		if (adminUploadSection) {
			const form = adminUploadSection.querySelector('[data-admin-upload-video-form]');
			const fileInput = adminUploadSection.querySelector('[data-admin-upload-video-input]');
			const submitBtn = adminUploadSection.querySelector('[data-admin-upload-video-btn]');
			const errorEl = adminUploadSection.querySelector('[data-admin-upload-video-error]');
			if (fileInput) {
				fileInput.addEventListener('change', () => {
					if (submitBtn) submitBtn.disabled = !(fileInput.files && fileInput.files.length > 0);
					if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }
				});
			}
			if (form && submitBtn) {
				form.addEventListener('submit', async (e) => {
					e.preventDefault();
					if (!fileInput?.files?.length) return;
					const file = fileInput.files[0];
					if (!file || !file.type.startsWith('video/')) {
						if (errorEl) { errorEl.textContent = 'Please choose a video file.'; errorEl.style.display = 'block'; }
						return;
					}
					submitBtn.disabled = true;
					if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }
					try {
						const fd = new FormData();
						fd.append('video', file);
						const res = await fetch(`/admin/creations/${creationId}/upload-video`, {
							method: 'POST',
							credentials: 'include',
							body: fd
						});
						const data = await res.json().catch(() => ({}));
						if (!res.ok) {
							if (errorEl) {
								errorEl.textContent = data?.error || data?.message || `Upload failed (${res.status})`;
								errorEl.style.display = 'block';
							}
							submitBtn.disabled = false;
							return;
						}
						fileInput.value = '';
						submitBtn.disabled = true;
						loadCreation();
					} catch (err) {
						if (errorEl) {
							errorEl.textContent = err?.message || 'Upload failed';
							errorEl.style.display = 'block';
						}
						submitBtn.disabled = false;
					}
				});
			}
		}

		if (!shareMountedPrivate) {
			enableLikeButtons(detailContent);
		}

		if (isGroupCreation && groupSources.length > 0) {
			const sourceById = new Map(groupSources.map((source) => [Number(source.id), source]));
			const orderedSourceIds = groupSources.map((source) => Number(source.id)).filter((id) => Number.isFinite(id) && id > 0);
			const sourceIndexById = new Map(orderedSourceIds.map((id, index) => [id, index]));
			const groupThumbButtons = Array.from(detailContent.querySelectorAll('[data-group-source-thumb]'));
			const setCoverBtn = detailContent.querySelector('[data-group-set-cover-btn]');
			const titleEl = detailContent.querySelector('.creation-detail-title');
			const mainDescriptionEl = detailContent.querySelector('[data-description]');
			const mainMetaLineEl = detailContent.querySelector('.creation-detail-description-meta-line');
			let selectedGroupSourceId = Number(groupSources[0]?.id);
			const currentCoverId = Number(groupSources[0]?.id);
			let groupCarouselEnabled = false;

			function syncSetCoverButton() {
				if (!(setCoverBtn instanceof HTMLButtonElement)) return;
				const canSetCover =
					Number.isFinite(selectedGroupSourceId) &&
					selectedGroupSourceId > 0 &&
					selectedGroupSourceId !== currentCoverId;
				setCoverBtn.disabled = !canSetCover;
			}

			function setActiveGroupSource(sourceId, options = {}) {
				const shouldUpdateMedia = options.updateMedia !== false;
				const source = sourceById.get(Number(sourceId));
				if (!source) return;
				selectedGroupSourceId = Number(source.id);
				for (const btn of groupThumbButtons) {
					const isActive = Number(btn.getAttribute('data-group-source-thumb')) === Number(source.id);
					btn.classList.toggle('is-active', isActive);
				}
				syncSetCoverButton();
				if (titleEl) {
					titleEl.textContent = source.title || 'Untitled';
				}
				if (mainDescriptionEl) {
					const descriptionParts = [];
					if (source.description) {
						descriptionParts.push(processUserText(source.description, { messageMarkdown: true }));
					}
					if (source.prompt) {
						if (descriptionParts.length > 0) descriptionParts.push('<br><br>');
						descriptionParts.push('<div class="creation-detail-prompt-label">Prompt</div>');
						descriptionParts.push(processUserText(source.prompt));
					}
					mainDescriptionEl.innerHTML = descriptionParts.join('');
					if (typeof hydrateRichUserTextEmbeds === 'function') {
						hydrateRichUserTextEmbeds(mainDescriptionEl);
					} else if (typeof hydrateUserTextLinks === 'function') {
						hydrateUserTextLinks(mainDescriptionEl);
					}
				}
				if (mainMetaLineEl) {
					mainMetaLineEl.textContent = source.generationInfo || '';
				}

				if (shouldUpdateMedia) {
					if (source.filePath) {
						if (!groupCarouselEnabled || !setGroupHeroCarouselActive(source.id)) {
							showHeroImage(source.filePath);
						}
					}
				}
			}

			function stepGroupSource(direction) {
				if (orderedSourceIds.length <= 1) return;
				const currentIndex = sourceIndexById.get(Number(selectedGroupSourceId)) ?? 0;
				const normalizedDirection = direction >= 0 ? 1 : -1;
				const nextIndex = (currentIndex + normalizedDirection + orderedSourceIds.length) % orderedSourceIds.length;
				const nextId = orderedSourceIds[nextIndex];
				setActiveGroupSource(nextId);
			}

			for (const btn of groupThumbButtons) {
				btn.addEventListener('click', (e) => {
					e.preventDefault();
					const sourceId = Number(btn.getAttribute('data-group-source-thumb'));
					if (!Number.isFinite(sourceId)) return;
					setActiveGroupSource(sourceId);
				});
			}
			if (hasGroupHeroNavigation && groupHeroPrevBtn instanceof HTMLButtonElement) {
				groupHeroPrevBtn.onclick = (e) => {
					e.preventDefault();
					stepGroupSource(-1);
				};
			}
			if (hasGroupHeroNavigation && groupHeroNextBtn instanceof HTMLButtonElement) {
				groupHeroNextBtn.onclick = (e) => {
					e.preventDefault();
					stepGroupSource(1);
				};
			}

			// Strict carousel behavior:
			// 1) Cover image must load successfully.
			// 2) Then load remaining images.
			// 3) Show controls only after all are loaded.
			// 4) Navigation only changes stacking (no src swaps).
			void (async () => {
				if (!isCurrentLoad()) return;
				const cover = groupSources[0];
				const coverUrl = typeof cover?.filePath === 'string' ? cover.filePath.trim() : '';
				if (!coverUrl) return;
				const coverLoaded = await preloadHeroImageUrl(coverUrl);
				if (!isCurrentLoad() || !coverLoaded?.ok) return;

				const mounted = mountGroupHeroCarousel(groupSources, Number(cover.id));
				groupCarouselEnabled = mounted;
				if (!mounted) return;

				const remainingUrls = groupSources
					.slice(1)
					.map((source) => (typeof source?.filePath === 'string' ? source.filePath.trim() : ''))
					.filter(Boolean);
				if (remainingUrls.length > 0) {
					await Promise.allSettled(remainingUrls.map((url) => preloadHeroImageUrl(url)));
				}
				if (!isCurrentLoad()) return;
				if (hasGroupHeroNavigation && groupHeroPrevBtn instanceof HTMLButtonElement && groupHeroNextBtn instanceof HTMLButtonElement) {
					groupHeroPrevBtn.hidden = false;
					groupHeroNextBtn.hidden = false;
					groupHeroPrevBtn.disabled = false;
					groupHeroNextBtn.disabled = false;
				}
			})();
			if (setCoverBtn instanceof HTMLButtonElement) {
				setCoverBtn.addEventListener('click', async () => {
					if (!Number.isFinite(selectedGroupSourceId) || selectedGroupSourceId <= 0) return;
					setCoverBtn.disabled = true;
					try {
						const res = await fetch(`/api/create/images/${creationId}/group-cover`, {
							method: 'POST',
							credentials: 'include',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ source_id: selectedGroupSourceId })
						});
						const data = await res.json().catch(() => ({}));
						if (!res.ok) {
							alert(data?.error || 'Failed to set cover');
							syncSetCoverButton();
							return;
						}
						await loadCreation();
					} catch (err) {
						alert(err?.message || 'Failed to set cover');
						syncSetCoverButton();
					}
				});
			}
			// Keep the cover media from the main load path as-is to avoid reloading and flicker.
			setActiveGroupSource(groupSources[0].id, { updateMedia: false });
		}

		const ungroupBtn = detailContent.querySelector('[data-ungroup-btn]');
		if (ungroupBtn instanceof HTMLButtonElement) {
			ungroupBtn.addEventListener('click', async () => {
				if (!window.confirm('Ungroup this creation and restore the original creations?')) return;
				ungroupBtn.disabled = true;
				try {
					const res = await fetch(`/api/create/images/${creationId}/ungroup`, {
						method: 'POST',
						credentials: 'include'
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) {
						const msg = typeof data?.error === 'string' ? data.error : 'Failed to ungroup creation';
						alert(msg);
						ungroupBtn.disabled = false;
						return;
					}
					window.location.href = '/chat/c/creations';
				} catch (err) {
					alert(err?.message || 'Failed to ungroup creation');
					ungroupBtn.disabled = false;
				}
			});
		}

		const commentsHost = detailContent.querySelector('[data-creation-comments-host]');
		if (commentsHost instanceof HTMLElement) {
			const threadQs = getImportQuery(getAssetVersionParam());
			const threadMod = await import(`/shared/creationCommentsThread.js${threadQs}`);
			await threadMod.mountCreationCommentsThread(commentsHost, {
				createdImageId: creationId,
				viewer: {
					id: currentUserId,
					userName: viewerUserName,
					displayName: viewerDisplayName,
					avatarUrl: viewerAvatarUrl,
					plan: viewerPlan ? 'founder' : null,
					color: viewerColor,
					initial: viewerInitial,
				},
				isAdmin,
				autoScrollOnHash: true,
			});
		}

		// Related section and transition recording: only when creation is published and not failed.
		if (isPublished && !isFailed) {
			recordTransitionFromQuery(creationId);
			const query = new URLSearchParams(window.location.search);
			const debugRelated = query.get('debug_related') === '1';
			const showRecsysDebug = isAdmin && debugRelated;
			initRelatedSection(detailContent.parentElement, creationId, { showRecsysDebug });
		}

	} catch (error) {
		console.error("Error loading creation detail:", error);
		detailContent.innerHTML = renderEmptyState({
			title: 'Unable to load creation',
			message: 'An error occurred while loading the creation.',
		});
	}
}

let currentCreationId = null;
let lastCreationMeta = null;
let loadCreationSequence = 0;

/**
 * Video creations cannot use Vynly share (server + client). Mirrors api_routes/utils/vynlyShareFromCreation.js.
 * @returns {boolean}
 */
function isCurrentCreationVideoForVynly() {
	const c = lastCreationMeta;
	if (!c || typeof c !== 'object') return false;
	let meta = c.meta;
	if (typeof meta === 'string') {
		try {
			meta = JSON.parse(meta);
		} catch {
			meta = null;
		}
	}
	if (meta && typeof meta === 'object') {
		if (meta.video && typeof meta.video === 'object') return true;
		const fp = typeof meta.file_path === 'string' ? meta.file_path.trim() : '';
		if (fp.startsWith('/api/videos/created/')) return true;
		const vf = typeof meta.video_filename === 'string' ? meta.video_filename : '';
		if (vf.startsWith('video/')) return true;
		if (typeof meta.media_type === 'string' && meta.media_type === 'video') return true;
	}
	const mediaType = typeof c.media_type === 'string' ? c.media_type : 'image';
	return mediaType === 'video';
}

async function checkAndLoadCreation() {
	await loadDeps();
	const creationId = getCreationId();
	// console.log('checkAndLoadCreation called, creationId:', creationId, 'currentCreationId:', currentCreationId);
	// Only reload if the creation ID has changed
	if (creationId && creationId !== currentCreationId) {
		// console.log('Creation ID changed, loading new creation');
		currentCreationId = creationId;
		loadCreation();
		// Reset scroll to top
		window.scrollTo(0, 0);
	} else if (!creationId && currentCreationId !== null) {
		// If we're no longer on a creation detail page, reset
		// console.log('No longer on creation detail page');
		currentCreationId = null;
	}
}

// Set up modal event listeners
document.addEventListener('DOMContentLoaded', () => {
	checkAndLoadCreation();
});

// Open modal when publish button is clicked
document.addEventListener('click', (e) => {
	const publishBtn = e.target.closest('[data-publish-btn]');
	if (publishBtn && !publishBtn.disabled) {
		e.preventDefault();
		const creationId = getCreationId();
		document.dispatchEvent(new CustomEvent('open-publish-modal', {
			detail: { creationId }
		}));
	}
});

// Delete button handler
document.addEventListener('click', (e) => {
	const deleteBtn = e.target.closest('[data-delete-btn]');
	if (deleteBtn && !deleteBtn.disabled) {
		e.preventDefault();
		handleDelete();
	}
});

// Edit button handler
document.addEventListener('click', (e) => {
	const editBtn = e.target.closest('[data-edit-btn]');
	if (editBtn && !editBtn.disabled) {
		e.preventDefault();
		const creationId = getCreationId();
		document.dispatchEvent(new CustomEvent('open-edit-modal', {
			detail: { creationId }
		}));
	}
});

// Un-publish button handler
document.addEventListener('click', (e) => {
	const unpublishBtn = e.target.closest('[data-unpublish-btn]');
	if (unpublishBtn && !unpublishBtn.disabled) {
		e.preventDefault();
		handleUnpublish();
	}
});

// Retry button handler
document.addEventListener('click', (e) => {
	const retryBtn = e.target.closest('[data-retry-btn]');
	if (retryBtn && !retryBtn.disabled) {
		e.preventDefault();
		handleRetry();
	}
});

// Mutate button handler
document.addEventListener('click', (e) => {
	const mutateBtn = e.target.closest('[data-mutate-btn]');
	if (mutateBtn && !mutateBtn.disabled) {
		e.preventDefault();
		const creationId = getCreationId();
		if (!creationId) return;
		window.location.href = `/creations/${creationId}/mutate`;
	}
});

// Share button handler — prefetch Vynly status so the share modal can show the Vynly row before it opens.
document.addEventListener('click', async (e) => {
	const shareBtn = e.target.closest('[data-share-btn]');
	if (shareBtn && !shareBtn.disabled) {
		e.preventDefault();
		const creationId = getCreationId();
		if (!creationId) return;
		const vynlyShareEligible = !isCurrentCreationVideoForVynly();
		let vynlyConfigured = false;
		if (vynlyShareEligible) {
			try {
				const res = await fetch('/api/vynly/status', { credentials: 'include' });
				if (res.ok) {
					const data = await res.json().catch(() => null);
					vynlyConfigured = Boolean(data?.configured);
				}
			} catch {
				// leave false
			}
		}
		document.dispatchEvent(new CustomEvent('open-share-modal', {
			detail: {
				creationId,
				vynlyShareEligible,
				vynlyConfigured
			}
		}));
	}
});

// Landscape: single modal — opens with placeholder or image; cost query only when user clicks Generate/Re-generate
const landscapeModal = document.querySelector('[data-landscape-modal]');
const landscapeGeneratePrompt = document.querySelector('[data-landscape-generate-prompt]');
const landscapePlaceholder = document.querySelector('[data-landscape-placeholder]');
const landscapePlaceholderSpinner = document.querySelector('[data-landscape-placeholder-spinner]');
const landscapeImage = document.querySelector('[data-landscape-image]');
const landscapeErrorEl = document.querySelector('[data-landscape-error]');
const landscapeCostDialog = document.querySelector('[data-landscape-cost-dialog]');
const landscapeCostDialogMessage = document.querySelector('[data-landscape-cost-dialog-message]');
const landscapeCostCancel = document.querySelector('[data-landscape-cost-cancel]');
const landscapeCostContinue = document.querySelector('[data-landscape-cost-continue]');
const landscapePrimaryBtn = document.querySelector('[data-landscape-primary-btn]');
const landscapePrimaryBtnText = document.querySelector('[data-landscape-btn-text]');
const landscapePrimaryBtnSpinner = document.querySelector('[data-landscape-btn-spinner]');
const landscapeRemoveBtn = document.querySelector('[data-landscape-remove-btn]');
const landscapeCloseBtn = document.querySelector('[data-landscape-close-btn]');
const landscapeCopyDebugBtn = document.querySelector('[data-landscape-copy-debug]');
const debugCopiedModal = document.querySelector('[data-debug-copied-modal]');
const debugCopiedMessage = document.querySelector('[data-debug-copied-message]');
const debugCopiedSummary = document.querySelector('[data-debug-copied-summary]');
const debugCopiedStatus = document.querySelector('[data-debug-copied-status]');
const debugCopiedCancel = document.querySelector('[data-debug-copied-cancel]');
const debugCopiedSend = document.querySelector('[data-debug-copied-send]');

let landscapeModalCreationId = null;
let landscapeModalIsOwner = false;
let landscapePendingCost = null;
/** Last modal open state, for "Copy debug info" (remote troubleshooting without DevTools). */
let lastLandscapeDiagnostic = null;

function setLandscapePrimaryButtonLoading(loading) {
	if (!landscapePrimaryBtn) return;
	landscapePrimaryBtn.classList.toggle('is-loading', !!loading);
	landscapePrimaryBtn.disabled = !!loading;
	if (landscapePrimaryBtnSpinner) landscapePrimaryBtnSpinner.style.display = loading ? 'block' : 'none';
	if (landscapePrimaryBtnText) landscapePrimaryBtnText.style.visibility = loading ? 'hidden' : '';
}

function openLandscapeModal(creationId, { landscapeUrl, isOwner, isLoading, errorMsg } = {}) {
	landscapeModalCreationId = creationId;
	landscapeModalIsOwner = isOwner;
	landscapePendingCost = null;
	setLandscapePrimaryButtonLoading(false);

	const hasImage = typeof landscapeUrl === 'string' && (landscapeUrl.startsWith('http') || landscapeUrl.startsWith('/'));
	const showPlaceholder = !hasImage || isLoading;
	const showSpinner = isLoading;

	lastLandscapeDiagnostic = { creationId, isOwner: !!isOwner, hasImage, isLoading: !!isLoading, errorMsg: errorMsg || null };
	if (typeof console !== 'undefined' && console.debug) {
		console.debug('[Landscape modal]', { ...lastLandscapeDiagnostic, generateButtonShown: lastLandscapeDiagnostic.isOwner });
	}

	if (landscapeGeneratePrompt) {
		landscapeGeneratePrompt.style.display = !hasImage && !showSpinner && !errorMsg ? 'block' : 'none';
	}
	if (landscapePlaceholder) {
		landscapePlaceholder.style.display = showPlaceholder ? 'flex' : 'none';
		landscapePlaceholder.classList.toggle('is-loading', !!showSpinner);
	}
	if (landscapePlaceholderSpinner) {
		landscapePlaceholderSpinner.style.display = showSpinner ? 'block' : 'none';
	}
	if (landscapeImage) {
		landscapeImage.style.display = hasImage && !showSpinner ? 'block' : 'none';
		if (hasImage && landscapeUrl) landscapeImage.src = landscapeUrl;
	}
	if (landscapeErrorEl) {
		landscapeErrorEl.style.display = errorMsg ? 'block' : 'none';
		landscapeErrorEl.textContent = errorMsg || '';
	}

	if (landscapePrimaryBtn) {
		landscapePrimaryBtn.style.display = isOwner ? '' : 'none';
		landscapePrimaryBtn.disabled = !!isLoading;
		if (landscapePrimaryBtnText) landscapePrimaryBtnText.textContent = hasImage ? 'Re-generate' : 'Generate';
	}
	if (landscapeRemoveBtn) {
		landscapeRemoveBtn.style.display = isOwner && hasImage ? '' : 'none';
		landscapeRemoveBtn.disabled = !!isLoading;
	}
	if (landscapeCloseBtn) {
		landscapeCloseBtn.onclick = () => landscapeModal?.close();
	}

	document.body.classList.add('modal-open');
	landscapeModal?.showModal();
}

function buildSupportReportPayload() {
	const d = lastLandscapeDiagnostic || (() => {
		const creationId = getCreationId();
		const meta = lastCreationMeta?.meta || {};
		const lurl = meta.landscapeUrl;
		const hasImage = typeof lurl === 'string' && (lurl.startsWith('http') || lurl.startsWith('/'));
		const isLoading = lurl === 'loading';
		const errorMsg = typeof lurl === 'string' && lurl.startsWith('error:') ? lurl.slice(6).trim() : null;
		return { creationId: creationId || 0, isOwner: !!landscapeModalIsOwner, hasImage, isLoading, errorMsg };
	})();
	const genBtnExists = !!landscapePrimaryBtn;
	const genBtnDisplay = genBtnExists && typeof getComputedStyle === 'function'
		? getComputedStyle(landscapePrimaryBtn).display
		: (genBtnExists ? (landscapePrimaryBtn.style.display || '') || 'inline-block' : 'n/a');
	const genBtnVisible = genBtnExists && genBtnDisplay !== 'none' && !landscapePrimaryBtn.disabled;
	const genPromptDisplay = landscapeGeneratePrompt && typeof getComputedStyle === 'function'
		? getComputedStyle(landscapeGeneratePrompt).display
		: (landscapeGeneratePrompt ? (landscapeGeneratePrompt.style.display || '') : 'n/a');
	const placeholderDisplay = landscapePlaceholder && typeof getComputedStyle === 'function'
		? getComputedStyle(landscapePlaceholder).display
		: (landscapePlaceholder ? (landscapePlaceholder.style.display || '') : 'n/a');
	const errorDisplay = landscapeErrorEl && typeof getComputedStyle === 'function'
		? getComputedStyle(landscapeErrorEl).display
		: (landscapeErrorEl ? (landscapeErrorEl.style.display || '') : 'n/a');

	const landscape = {
		creationId: d.creationId,
		isOwner: d.isOwner,
		hasImage: d.hasImage,
		loading: d.isLoading,
		errorMsg: d.errorMsg || null,
		genBtnExists,
		genBtnVisible,
		genBtnDisplay,
		genPromptDisplay,
		placeholderDisplay,
		errorElDisplay: errorDisplay
	};

	const domSummary = {};
	if (landscapeModal) {
		try {
			const cs = typeof getComputedStyle === 'function' ? getComputedStyle(landscapeModal) : null;
			domSummary.modalDisplay = cs ? cs.display : (landscapeModal.style?.display || '');
			domSummary.modalOpen = landscapeModal.open;
		} catch (e) {
			domSummary.modalError = String(e?.message || e);
		}
		if (landscapePlaceholder) {
			try {
				domSummary.placeholderDisplay = typeof getComputedStyle === 'function'
					? getComputedStyle(landscapePlaceholder).display : landscapePlaceholder.style?.display;
				domSummary.placeholderVisible = landscapePlaceholder.offsetParent != null;
			} catch (e) {
				domSummary.placeholderError = String(e?.message || e);
			}
		}
		if (landscapePrimaryBtn) {
			try {
				domSummary.primaryBtnDisplay = typeof getComputedStyle === 'function'
					? getComputedStyle(landscapePrimaryBtn).display : landscapePrimaryBtn.style?.display;
				domSummary.primaryBtnVisible = landscapePrimaryBtn.offsetParent != null;
				domSummary.primaryBtnDisabled = landscapePrimaryBtn.disabled;
			} catch (e) {
				domSummary.primaryBtnError = String(e?.message || e);
			}
		}
		// Truncated HTML snippet of modal content for deep debugging (no user content)
		try {
			const content = landscapeModal.querySelector('[data-landscape-content]');
			if (content) {
				const raw = content.innerHTML.replace(/\s+/g, ' ').trim();
				domSummary.modalContentLength = raw.length;
				domSummary.modalContentSnippet = raw.slice(0, 800) + (raw.length > 800 ? '…' : '');
			}
		} catch (e) {
			domSummary.contentError = String(e?.message || e);
		}
	}

	const context = {
		url: typeof window?.location?.href === 'string' ? window.location.href : '',
		viewportWidth: typeof window?.innerWidth === 'number' ? window.innerWidth : null,
		viewportHeight: typeof window?.innerHeight === 'number' ? window.innerHeight : null,
		screenWidth: typeof window?.screen?.width === 'number' ? window.screen.width : null,
		screenHeight: typeof window?.screen?.height === 'number' ? window.screen.height : null,
		devicePixelRatio: typeof window?.devicePixelRatio === 'number' ? window.devicePixelRatio : null
	};

	return {
		creationId: d.creationId,
		landscape,
		domSummary,
		context
	};
}

function openSupportReportModal() {
	if (debugCopiedStatus) debugCopiedStatus.textContent = '';
	if (debugCopiedSend) debugCopiedSend.disabled = false;
	debugCopiedModal?.showModal();
}

async function sendSupportReport() {
	if (!debugCopiedSend) return;
	debugCopiedSend.disabled = true;
	if (debugCopiedStatus) debugCopiedStatus.textContent = 'Sending…';
	const report = buildSupportReportPayload();
	const userSummary = debugCopiedSummary?.value?.trim() ?? '';
	if (userSummary) report.userSummary = userSummary;
	try {
		const res = await fetch('/api/support-report', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ report })
		});
		const data = await res.json().catch(() => ({}));
		if (res.ok && data?.ok) {
			if (debugCopiedStatus) debugCopiedStatus.textContent = 'Report sent.';
			if (debugCopiedSummary) debugCopiedSummary.value = '';
			setTimeout(() => {
				debugCopiedModal?.close();
				if (debugCopiedStatus) debugCopiedStatus.textContent = '';
				if (debugCopiedSend) debugCopiedSend.disabled = false;
			}, 1500);
		} else {
			if (debugCopiedStatus) debugCopiedStatus.textContent = data?.error || 'Failed to send report.';
			debugCopiedSend.disabled = false;
		}
	} catch (err) {
		if (debugCopiedStatus) debugCopiedStatus.textContent = err?.message || 'Failed to send report.';
		debugCopiedSend.disabled = false;
	}
}

async function landscapePollUntilDone(creationId) {
	const pollMs = 2500;
	const maxPolls = 120;
	for (let i = 0; i < maxPolls; i++) {
		await new Promise(r => setTimeout(r, pollMs));
		const res = await fetch(`/api/create/images/${creationId}`, { credentials: 'include' });
		if (!res.ok) continue;
		const creation = await res.json();
		const meta = creation?.meta || {};
		const lurl = meta.landscapeUrl;
		if (typeof lurl === 'string' && lurl.startsWith('error:')) {
			const msg = lurl.slice(6).trim() || 'The image failed to generate.';
			openLandscapeModal(creationId, { landscapeUrl: null, isOwner: landscapeModalIsOwner, isLoading: false, errorMsg: msg });
			return;
		}
		if (typeof lurl === 'string' && (lurl.startsWith('http') || lurl.startsWith('/'))) {
			lastCreationMeta = creation;
			openLandscapeModal(creationId, { landscapeUrl: lurl, isOwner: landscapeModalIsOwner, isLoading: false });
			loadCreation();
			return;
		}
	}
	openLandscapeModal(creationId, { landscapeUrl: null, isOwner: landscapeModalIsOwner, isLoading: false, errorMsg: 'Taking longer than usual. You can close and check back later.' });
}

function landscapeStartGenerate(creationId, cost) {
	landscapePendingCost = null;
	openLandscapeModal(creationId, { landscapeUrl: null, isOwner: landscapeModalIsOwner, isLoading: true });
	fetch('/api/create/landscape', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ creation_id: creationId, credit_cost: cost })
	})
		.then(async (res) => {
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				openLandscapeModal(creationId, { landscapeUrl: null, isOwner: landscapeModalIsOwner, isLoading: false, errorMsg: data?.message || data?.error || 'Failed to start' });
				return;
			}
			landscapePollUntilDone(creationId);
		})
		.catch((err) => {
			openLandscapeModal(creationId, { landscapeUrl: null, isOwner: landscapeModalIsOwner, isLoading: false, errorMsg: err?.message || 'Failed to start landscape' });
		});
}

// Prevent background scroll when landscape or cost dialog is open (same as other modals)
if (landscapeModal) {
	landscapeModal.addEventListener('close', () => document.body.classList.remove('modal-open'));
}
if (landscapeCostDialog) {
	landscapeCostDialog.addEventListener('close', () => document.body.classList.remove('modal-open'));
}

if (landscapeCostCancel) {
	landscapeCostCancel.addEventListener('click', () => {
		landscapePendingCost = null;
		landscapeCostDialog?.close();
		const meta = lastCreationMeta?.meta || {};
		const lurl = meta?.landscapeUrl;
		const hasImage = typeof lurl === 'string' && (lurl.startsWith('http') || lurl.startsWith('/'));
		openLandscapeModal(landscapeModalCreationId, { landscapeUrl: hasImage ? lurl : null, isOwner: landscapeModalIsOwner, isLoading: false });
	});
}

if (landscapeCostContinue) {
	landscapeCostContinue.addEventListener('click', () => {
		if (!landscapePendingCost) return;
		const { creationId, cost } = landscapePendingCost;
		landscapePendingCost = null;
		landscapeCostDialog?.close();
		landscapeStartGenerate(creationId, cost);
	});
}

if (landscapePrimaryBtn) {
	landscapePrimaryBtn.addEventListener('click', async () => {
		const creationId = landscapeModalCreationId;
		if (!creationId || !landscapeModalIsOwner) return;
		landscapePendingCost = null;
		setLandscapePrimaryButtonLoading(true);
		try {
			const queryRes = await fetch('/api/create/landscape/query', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ creation_id: creationId })
			});
			const queryData = await queryRes.json().catch(() => ({}));
			const meta = lastCreationMeta?.meta || {};
			const lurl = meta?.landscapeUrl;
			const hasImage = typeof lurl === 'string' && (lurl.startsWith('http') || lurl.startsWith('/'));
			if (!queryRes.ok) {
				setLandscapePrimaryButtonLoading(false);
				openLandscapeModal(creationId, { landscapeUrl: hasImage ? lurl : null, isOwner: true, isLoading: false, errorMsg: queryData?.message || queryData?.error || 'Failed to query' });
				return;
			}
			const supported = queryData?.supported === true || queryData?.supported === 'true';
			const cost = typeof queryData.cost === 'number' ? queryData.cost : Number(queryData.cost);
			if (!supported || !Number.isFinite(cost) || cost <= 0) {
				setLandscapePrimaryButtonLoading(false);
				openLandscapeModal(creationId, { landscapeUrl: hasImage ? lurl : null, isOwner: true, isLoading: false, errorMsg: 'This server does not support landscape for this creation.' });
				return;
			}
			landscapePendingCost = { creationId, cost };
			setLandscapePrimaryButtonLoading(false);
			if (landscapeCostDialogMessage) landscapeCostDialogMessage.textContent = `This will cost ${cost} credit${cost === 1 ? '' : 's'}.`;
			document.body.classList.add('modal-open');
			landscapeCostDialog?.showModal();
		} catch (err) {
			setLandscapePrimaryButtonLoading(false);
			openLandscapeModal(creationId, { landscapeUrl: null, isOwner: true, isLoading: false, errorMsg: err?.message || 'Failed to query' });
		}
	});
}

if (landscapeRemoveBtn) {
	landscapeRemoveBtn.addEventListener('click', async () => {
		const creationId = landscapeModalCreationId;
		if (!creationId || !landscapeModalIsOwner) return;
		landscapeRemoveBtn.disabled = true;
		try {
			const res = await fetch(`/api/create/images/${creationId}/landscape`, { method: 'DELETE', credentials: 'include' });
			if (!res.ok) throw new Error('Failed to remove');
			landscapeModal?.close();
			loadCreation();
		} catch (err) {
			alert(err?.message || 'Failed to remove landscape');
		} finally {
			landscapeRemoveBtn.disabled = false;
		}
	});
}

if (landscapeCopyDebugBtn) {
	landscapeCopyDebugBtn.addEventListener('click', openSupportReportModal);
}

if (debugCopiedCancel) {
	debugCopiedCancel.addEventListener('click', () => debugCopiedModal?.close());
}

if (debugCopiedSend) {
	debugCopiedSend.addEventListener('click', () => void sendSupportReport());
}

document.addEventListener('click', (e) => {
	const landscapeBtn = e.target.closest('[data-landscape-btn]');
	if (!landscapeBtn || landscapeBtn.disabled) return;
	e.preventDefault();
	const creationId = getCreationId();
	if (!creationId) return;
	const isOwner = landscapeBtn.dataset.landscapeIsSelf === '1';
	const hasUrl = landscapeBtn.dataset.landscapeHasUrl === '1';
	// Diagnostic: button state when opening modal (helps troubleshoot Brave/Windows "no Generate" reports).
	if (typeof console !== 'undefined' && console.debug) {
		console.debug('[Landscape click]', {
			creationId,
			'data-landscape-is-self': landscapeBtn.dataset.landscapeIsSelf,
			'data-landscape-has-url': landscapeBtn.dataset.landscapeHasUrl,
			derivedIsOwner: isOwner,
			derivedHasUrl: hasUrl
		});
	}
	const meta = lastCreationMeta?.meta || {};
	const landscapeUrl = meta.landscapeUrl;
	const isLoading = landscapeUrl === 'loading';
	const hasImage = typeof landscapeUrl === 'string' && (landscapeUrl.startsWith('http') || landscapeUrl.startsWith('/'));
	const errorMsg = typeof landscapeUrl === 'string' && landscapeUrl.startsWith('error:') ? landscapeUrl.slice(6).trim() : null;

	openLandscapeModal(creationId, {
		landscapeUrl: hasImage ? landscapeUrl : null,
		isOwner,
		isLoading,
		errorMsg: errorMsg || null
	});
});

/**
 * @param {boolean} [isPermanent] - When true, permanent delete (admin). When omitted, derived from a [data-delete-btn][data-permanent-delete] in the DOM if present.
 */
async function handleDelete(isPermanent) {
	const creationId = getCreationId();
	if (!creationId) {
		alert('Invalid creation ID');
		return;
	}

	const deleteBtn = document.querySelector('[data-delete-btn]');
	const resolvedPermanent = typeof isPermanent === 'boolean' ? isPermanent : (deleteBtn?.dataset?.permanentDelete === '1');

	if (!confirm(resolvedPermanent
		? 'Permanently delete this creation? This cannot be undone.'
		: 'Are you sure you want to delete this creation? This action cannot be undone.')) {
		return;
	}

	if (deleteBtn) {
		deleteBtn.disabled = true;
	}

	const deleteUrl = resolvedPermanent ? `/api/create/images/${creationId}?permanent=1` : `/api/create/images/${creationId}`;
	try {
		const response = await fetch(deleteUrl, {
			method: 'DELETE',
			credentials: 'include'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to delete creation');
		}

		// Success: after permanent delete (admin), go back to that user's profile; otherwise creations list
		if (resolvedPermanent && lastCreationMeta?.user_id) {
			const profilePath = buildProfilePath({
				userName: lastCreationMeta?.creator?.user_name || lastCreationMeta?.user_name || null,
				userId: lastCreationMeta.user_id
			});
			window.location.href = profilePath || `/user/${lastCreationMeta.user_id}`;
		} else {
			window.location.href = '/creations';
		}
	} catch (error) {
		// console.error('Error deleting creation:', error);
		alert(error.message || 'Failed to delete creation. Please try again.');

		if (deleteBtn) {
			deleteBtn.disabled = false;
		}
	}
}

async function handleRetry() {
	const creationId = getCreationId();
	if (!creationId) {
		alert('Invalid creation ID');
		return;
	}

	const meta = lastCreationMeta && lastCreationMeta.meta ? lastCreationMeta.meta : null;
	const serverId = meta && meta.server_id;
	const method = meta && meta.method;
	const args = (meta && meta.args) ? meta.args : {};

	if (!serverId || !method) {
		alert('Cannot retry this creation because server or method information is missing.');
		return;
	}

	const retryBtn = document.querySelector('[data-retry-btn]');
	if (retryBtn) {
		retryBtn.disabled = true;
	}

	const creationToken = `crt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

	try {
		const response = await fetch("/api/create", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			credentials: "include",
			body: JSON.stringify({
				server_id: serverId,
				method,
				args: args || {},
				creation_token: creationToken,
				retry_of_id: Number(creationId)
			})
		});

		if (!response.ok) {
			const error = await response.json();
			if (response.status === 402) {
				document.dispatchEvent(new CustomEvent('credits-updated', {
					detail: { count: error.current ?? 0 }
				}));
				alert(error.message || "Insufficient credits");
				return;
			}
			throw new Error(error.error || "Failed to retry creation");
		}

		const data = await response.json();
		if (typeof data.credits_remaining === 'number') {
			document.dispatchEvent(new CustomEvent('credits-updated', {
				detail: { count: data.credits_remaining }
			}));
		}

		// Same creation row is now "creating"; navigate and refresh list
		const creationsRoute = document.querySelector("app-route-creations");
		if (creationsRoute && typeof creationsRoute.loadCreations === "function") {
			await creationsRoute.loadCreations({ force: true, background: false });
		}
		const header = document.querySelector('app-navigation');
		if (header && typeof header.navigateToRoute === 'function') {
			header.navigateToRoute('creations');
		} else {
			window.location.href = '/creations';
		}
	} catch (error) {
		alert(error.message || 'Failed to retry creation. Please try again.');
	} finally {
		if (retryBtn) {
			retryBtn.disabled = false;
		}
	}
}


async function handleUnpublish() {
	const creationId = getCreationId();
	if (!creationId) {
		alert('Invalid creation ID');
		return;
	}

	// Confirm unpublishing
	if (!confirm('Are you sure you want to un-publish this creation? It will be removed from the feed and no longer visible to other users. You will also lose all likes and comments.')) {
		return;
	}

	const unpublishBtn = document.querySelector('[data-unpublish-btn]');
	if (unpublishBtn) {
		unpublishBtn.disabled = true;
	}

	try {
		const response = await fetch(`/api/create/images/${creationId}/unpublish`, {
			method: 'POST',
			credentials: 'include'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to unpublish creation');
		}

		// Success - reload the page to show updated state
		window.location.reload();
	} catch (error) {
		// console.error('Error unpublishing creation:', error);
		alert(error.message || 'Failed to unpublish creation. Please try again.');

		if (unpublishBtn) {
			unpublishBtn.disabled = false;
		}
	}
}

// Listen for URL changes (browser back/forward navigation)
// Use capture phase to ensure we get the event before header handles it
window.addEventListener('popstate', (e) => {
	// console.log('popstate event fired', window.location.pathname);
	if (creationDetailInlineLightboxMod?.closeChatInlineImageLightboxFromPopstateIfOpen?.()) {
		return;
	}
	// Check if we're still on a creation detail page
	const creationId = getCreationId();
	if (creationId) {
		checkAndLoadCreation();
	}
}, true);

// Override pushState and replaceState to detect programmatic navigation
history.pushState = function (...args) {
	// console.log('pushState called', args);
	originalPushState(...args);
	// Check if URL changed to a different creation
	setTimeout(() => {
		const creationId = getCreationId();
		// console.log('After pushState, creationId:', creationId);
		if (creationId) {
			checkAndLoadCreation();
		}
	}, 0);
};

history.replaceState = function (...args) {
	// console.log('replaceState called', args);
	originalReplaceState(...args);
	setTimeout(() => {
		const creationId = getCreationId();
		// console.log('After replaceState, creationId:', creationId);
		if (creationId) {
			checkAndLoadCreation();
		}
	}, 0);
};

// Listen for the route-change event from the header component
document.addEventListener('route-change', (e) => {
	// console.log('route-change event fired', e.detail?.route);
	const route = e.detail?.route;
	if (route && route.startsWith('creations/')) {
		checkAndLoadCreation();
	}
});

// Also monitor pathname changes directly as a fallback
let lastPathname = window.location.pathname;
const pathnameCheck = setInterval(() => {
	const currentPathname = window.location.pathname;
	if (currentPathname !== lastPathname) {
		lastPathname = currentPathname;
		const creationId = getCreationId();
		if (creationId) {
			checkAndLoadCreation();
		} else {
			// If we're no longer on a creation detail page, clear interval
			clearInterval(pathnameCheck);
		}
	}
}, 100);

