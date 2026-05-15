/**
 * Mountable comments thread for a single created image.
 *
 * Renders composer + activity list (tips + comments) with interactive reactions,
 * inline replies, edit/delete, image upload, and sticker quick-send. Used by:
 *   - /creations/:id (creation-detail page)
 *   - Chat doom-scroll comments bottom sheet
 *
 * Owns its own DOM inside the provided container. Reuses the global comment
 * CSS (`.comment-input`, `.comment-item`, `.comment-reaction-*`, etc.) so visual
 * parity is automatic anywhere global.css is loaded.
 */

const _qs = (() => {
	const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
	return v ? `?v=${encodeURIComponent(v)}` : '';
})();

/** Lazy single-flight dep loader so both hosts share one resolved bundle. */
let _depsPromise = null;
function loadDeps() {
	if (_depsPromise) return _depsPromise;
	_depsPromise = (async () => {
		const [
			datetimeMod,
			commentsMod,
			replyUiMod,
			userTextMod,
			autogrowMod,
			suggestMod,
			profileLinksMod,
			iconsMod,
			replyPreviewMod,
			emptyStateMod,
			commentItemMod,
			createSubmitMod,
			avatarMod,
		] = await Promise.all([
			import(`/shared/datetime.js${_qs}`),
			import(`/shared/comments.js${_qs}`),
			import(`/shared/replyIndicatorUi.js${_qs}`),
			import(`/shared/userText.js${_qs}`),
			import(`/shared/autogrow.js${_qs}`),
			import(`/shared/triggeredSuggest.js${_qs}`),
			import(`/shared/profileLinks.js${_qs}`),
			import(`/icons/svg-strings.js${_qs}`),
			import(`/shared/plainTextReplyPreview.js${_qs}`),
			import(`/shared/emptyState.js${_qs}`),
			import(`/shared/commentItem.js${_qs}`),
			import(`/shared/createSubmit.js${_qs}`),
			import(`/shared/avatar.js${_qs}`),
		]);
		return {
			formatDateTime: datetimeMod.formatDateTime,
			formatRelativeTime: datetimeMod.formatRelativeTime,
			fetchCreatedImageActivity: commentsMod.fetchCreatedImageActivity,
			postCreatedImageComment: commentsMod.postCreatedImageComment,
			toggleCommentReaction: commentsMod.toggleCommentReaction,
			deleteCreatedImageComment: commentsMod.deleteCreatedImageComment,
			updateCreatedImageComment: commentsMod.updateCreatedImageComment,
			createReplyIndicatorElement: replyUiMod.createReplyIndicatorElement,
			processUserText: userTextMod.processUserText,
			hydrateRichUserTextEmbeds: userTextMod.hydrateRichUserTextEmbeds,
			hydrateUserTextLinks: userTextMod.hydrateUserTextLinks,
			attachAutoGrowTextarea: autogrowMod.attachAutoGrowTextarea,
			attachMentionSuggest: suggestMod.attachMentionSuggest,
			isTriggeredSuggestPopupOpen: suggestMod.isTriggeredSuggestPopupOpen,
			addPageUsers: suggestMod.addPageUsers,
			buildProfilePath: profileLinksMod.buildProfilePath,
			creditIcon: iconsMod.creditIcon,
			sendIcon: iconsMod.sendIcon,
			plusIcon: iconsMod.plusIcon,
			smileIcon: iconsMod.smileIcon,
			replyTurnIcon: iconsMod.replyTurnIcon,
			REACTION_ORDER: iconsMod.REACTION_ORDER,
			REACTION_ICONS: iconsMod.REACTION_ICONS,
			plainTextReplyPreview: replyPreviewMod.plainTextReplyPreview,
			renderEmptyState: emptyStateMod.renderEmptyState,
			renderCommentAvatarHtml: commentItemMod.renderCommentAvatarHtml,
			uploadImageFile: createSubmitMod.uploadImageFile,
			getAvatarColor: avatarMod.getAvatarColor,
		};
	})();
	return _depsPromise;
}

function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

const DEFAULT_PLACEHOLDER = 'What do you like about this creation?';

/**
 * @typedef {object} ThreadViewer
 * @property {number | null} id
 * @property {string} userName
 * @property {string} displayName
 * @property {string} avatarUrl
 * @property {string} [plan] - 'founder' triggers founder flair
 * @property {string} [color] - background color when no avatar; computed from getAvatarColor if absent
 * @property {string} [initial] - upper-case initial letter; computed from name if absent
 */

/**
 * @typedef {object} MountOptions
 * @property {number} createdImageId Target creation for activity feed + post API.
 * @property {ThreadViewer} viewer Composer avatar + admin/moderator checks.
 * @property {boolean} [isAdmin] Hides composer (admins read-only) and lets admin moderate.
 * @property {string} [placeholder] Composer textarea placeholder.
 * @property {boolean} [autoScrollOnHash] If true, scrolls to `#comments` on initial load + hashchange.
 * @property {(count: number) => void} [onCommentCountChange] Notified when comment count updates.
 * @property {(loading: boolean) => void} [onCommentsLoadingChange] When skeleton loading UI is shown/hidden (e.g. lock sheet scroll).
 */

/**
 * @param {HTMLElement} container
 * @param {MountOptions} options
 * @returns {Promise<{ teardown: () => void, refresh: () => Promise<void> }>}
 */
export async function mountCreationCommentsThread(container, options) {
	if (!(container instanceof HTMLElement)) {
		throw new TypeError('mountCreationCommentsThread: container must be an HTMLElement');
	}
	const opts = options || {};
	const creationId = Number(opts.createdImageId);
	if (!Number.isFinite(creationId) || creationId <= 0) {
		throw new Error('mountCreationCommentsThread: createdImageId required');
	}

	const deps = await loadDeps();
	const {
		formatDateTime,
		formatRelativeTime,
		fetchCreatedImageActivity,
		postCreatedImageComment,
		toggleCommentReaction,
		deleteCreatedImageComment,
		updateCreatedImageComment,
		createReplyIndicatorElement,
		processUserText,
		hydrateRichUserTextEmbeds,
		hydrateUserTextLinks,
		attachAutoGrowTextarea,
		attachMentionSuggest,
		isTriggeredSuggestPopupOpen,
		addPageUsers,
		buildProfilePath,
		creditIcon,
		sendIcon,
		plusIcon,
		smileIcon,
		replyTurnIcon,
		REACTION_ORDER,
		REACTION_ICONS,
		plainTextReplyPreview,
		renderEmptyState,
		renderCommentAvatarHtml,
		uploadImageFile,
		getAvatarColor,
	} = deps;

	const viewerRaw = opts.viewer || {};
	const currentUserId = Number(viewerRaw.id);
	const viewerUserName = typeof viewerRaw.userName === 'string' ? viewerRaw.userName.trim() : '';
	const viewerDisplayName = typeof viewerRaw.displayName === 'string' ? viewerRaw.displayName.trim() : '';
	const viewerAvatarUrl = typeof viewerRaw.avatarUrl === 'string' ? viewerRaw.avatarUrl.trim() : '';
	const viewerPlan = viewerRaw.plan === 'founder';
	const viewerName = viewerDisplayName || viewerUserName || 'You';
	const viewerInitial = typeof viewerRaw.initial === 'string' && viewerRaw.initial
		? viewerRaw.initial
		: (viewerName.charAt(0).toUpperCase() || 'Y');
	const viewerColor = typeof viewerRaw.color === 'string' && viewerRaw.color
		? viewerRaw.color
		: getAvatarColor(viewerUserName || String(Number.isFinite(currentUserId) ? currentUserId : '') || viewerName);
	const isAdmin = Boolean(opts.isAdmin);
	const placeholderText = typeof opts.placeholder === 'string' && opts.placeholder
		? opts.placeholder
		: DEFAULT_PLACEHOLDER;
	const autoScrollOnHash = Boolean(opts.autoScrollOnHash);

	const showComposer = !isAdmin && Number.isFinite(currentUserId) && currentUserId > 0;

	container.innerHTML = `
		<div class="creation-comments-thread" data-creation-comments-thread>
			${showComposer ? `
			<div class="comment-input" data-comment-input>
				<div class="comment-avatar" ${!viewerPlan ? `style="background: ${escapeHtml(viewerColor)};"` : ''}>
					${viewerPlan
						? `<div class="avatar-with-founder-flair avatar-with-founder-flair--sm">
							<div class="founder-flair-avatar-ring">
								<div class="founder-flair-avatar-inner" data-founder-flair-avatar-bg aria-hidden="true">
									${viewerAvatarUrl ? `<img class="comment-avatar-img" src="${escapeHtml(viewerAvatarUrl)}" alt="">` : escapeHtml(viewerInitial)}
								</div>
							</div>
						</div>`
						: (viewerAvatarUrl ? `<img class="comment-avatar-img" src="${escapeHtml(viewerAvatarUrl)}" alt="">` : escapeHtml(viewerInitial))}
				</div>
				<div class="comment-input-body">
					<div class="comment-composer-row">
						<button type="button" class="comment-input-attach" data-comment-attach aria-label="Attach image">
							${typeof plusIcon === 'function' ? plusIcon('comment-input-attach-icon') : '+'}
						</button>
						<textarea class="comment-textarea comment-textarea--composer" rows="1" placeholder="${escapeHtml(placeholderText)}" maxlength="4000" data-comment-textarea></textarea>
						<button class="comment-submit-btn comment-submit-btn--composer" type="button" data-comment-submit>
							<span class="comment-action-btn-label comment-action-btn-label--arrow" aria-hidden="true">${typeof sendIcon === 'function' ? sendIcon('comment-send-icon') : '➤'}</span>
							<span class="comment-action-btn-spinner" aria-hidden="true"></span>
						</button>
						<input type="file" hidden accept="image/*" data-comment-attach-input />
					</div>
					<span class="comment-input-attach-status" data-comment-attach-status aria-live="polite"></span>
				</div>
			</div>
			` : ''}
			<div class="creation-detail-comments-section" data-comments-section style="display: none;">
				<div class="comments-toolbar">
					<h3 class="comments-heading"><span data-comment-count>0 Comments</span></h3>
					<div class="comments-sort">
						<label class="comments-sort-label" for="comments-sort-${creationId}">Sort by</label>
						<select class="comments-sort-select" id="comments-sort-${creationId}" data-comments-sort>
							<option value="asc">Oldest</option>
							<option value="desc">Most recent</option>
						</select>
					</div>
				</div>
				<div id="comments" data-comments-anchor></div>
				<div class="comment-list" data-comment-list></div>
			</div>
		</div>
	`;

	const root = container.querySelector('[data-creation-comments-thread]');
	if (!(root instanceof HTMLElement)) {
		throw new Error('mountCreationCommentsThread: failed to render root');
	}

	function scrollToComments() {
		const el = root.querySelector('[data-comments-anchor]');
		if (!el) return;
		el.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	let commentsDidInitialHashScroll = false;

	const commentsState = {
		order: 'asc',
		activity: [],
		commentCount: 0,
	};
	let commentEditingId = null;
	let commentEditDraft = '';
	let commentEditBusy = false;
	let commentEditMinHeightPx = 0;

	const commentCountEl = root.querySelector('[data-comment-count]');
	const commentListEl = root.querySelector('[data-comment-list]');
	const commentsSortEl = root.querySelector('[data-comments-sort]');
	const commentsToolbarEl = root.querySelector('.comments-toolbar');
	const commentComposerRow = root.querySelector('.comment-composer-row');
	const commentTextarea = root.querySelector('[data-comment-textarea]');
	const commentSubmitBtn = root.querySelector('[data-comment-submit]');
	const commentAttachBtn = root.querySelector('[data-comment-attach]');
	const commentAttachInput = root.querySelector('[data-comment-attach-input]');
	const commentAttachStatus = root.querySelector('[data-comment-attach-status]');

	function setCommentsLoading(loading) {
		const on = Boolean(loading);
		if (root instanceof HTMLElement) {
			if (on) {
				root.dataset.creationCommentsLoading = '1';
			} else {
				delete root.dataset.creationCommentsLoading;
			}
		}
		if (commentsSortEl instanceof HTMLSelectElement) {
			commentsSortEl.disabled = on;
		}
		if (typeof opts.onCommentsLoadingChange === 'function') {
			try {
				opts.onCommentsLoadingChange(on);
			} catch {
				/* host callback errors are non-fatal */
			}
		}
	}

	function renderCommentsLoadingSkeleton() {
		const row = `
			<div class="creation-comments-skeleton-row">
				<div class="skeleton skeleton-circle" style="width:32px;height:32px;border-radius:50%"></div>
				<div class="creation-comments-skeleton-body">
					<div class="skeleton skeleton-line skeleton-line--short"></div>
					<div class="skeleton skeleton-line skeleton-line--medium"></div>
					<div class="skeleton skeleton-line" style="max-width:72%"></div>
				</div>
			</div>
		`;
		return `<div class="creation-comments-loading" role="status" aria-live="polite" aria-busy="true">${row}${row}${row}</div>`;
	}

	const isMobileCommentInputMode = () => {
		try {
			return window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 768;
		} catch {
			return typeof window.innerWidth === 'number' && window.innerWidth <= 768;
		}
	};

	const setCommentActionButtonLoading = (btn, loading) => {
		if (!(btn instanceof HTMLButtonElement)) return;
		btn.classList.toggle('is-loading', Boolean(loading));
	};

	let commentQuickSubmitInFlight = false;
	let commentComposerBusyPlaceholderPrev = '';
	let commentInlineReplyParentId = null;
	let commentInlineReplyFocusPending = false;

	function syncInlineReplySubmitUi(textarea) {
		if (!(textarea instanceof HTMLTextAreaElement) || !commentListEl) return;
		const cid = textarea.getAttribute('data-comment-inline-textarea');
		if (!cid) return;
		const row = textarea.closest('.comment-composer-row');
		if (row instanceof HTMLElement) {
			const max = Number(textarea.maxLength);
			const atLimit =
				Number.isFinite(max) && max > 0 && String(textarea.value || '').length >= max;
			row.classList.toggle('is-at-limit', atLimit);
		}
		const btn = commentListEl.querySelector(`[data-comment-inline-submit="${cid}"]`);
		if (!(btn instanceof HTMLButtonElement)) return;
		const hasText = textarea.value.trim().length > 0;
		btn.hidden = !hasText;
		btn.disabled = !hasText || commentQuickSubmitInFlight;
		const attachBtn = commentListEl.querySelector(`[data-comment-inline-attach="${cid}"]`);
		if (attachBtn instanceof HTMLButtonElement) {
			attachBtn.disabled = commentQuickSubmitInFlight;
			attachBtn.classList.toggle('comment-input-attach--text-disabled', hasText);
		}
	}

	function hydrateOpenInlineReplyComposer() {
		if (!(commentListEl instanceof HTMLElement) || commentInlineReplyParentId == null) return;
		const pid = String(commentInlineReplyParentId);
		const ta = commentListEl.querySelector(`[data-comment-inline-textarea="${pid}"]`);
		if (!(ta instanceof HTMLTextAreaElement)) return;
		if (ta.dataset.inlineComposerHydrated !== '1') {
			attachMentionSuggest(ta);
			const miniRefresh = attachAutoGrowTextarea(ta);
			miniRefresh();
			ta.dataset.inlineComposerHydrated = '1';
		}
		syncInlineReplySubmitUi(ta);
		if (!commentInlineReplyFocusPending) return;
		commentInlineReplyFocusPending = false;
		requestAnimationFrame(() => {
			try {
				ta.focus({ preventScroll: true });
				ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			} catch {
				try {
					ta.focus();
				} catch {
					/* ignore */
				}
			}
		});
	}

	function syncInlineReplyOpenState() {
		if (!(commentListEl instanceof HTMLElement)) return;
		const list = Array.isArray(commentsState.activity) ? commentsState.activity : [];
		if (
			commentInlineReplyParentId != null &&
			!list.some((it) => it.type === 'comment' && Number(it?.id) === Number(commentInlineReplyParentId))
		) {
			commentInlineReplyParentId = null;
		}
		for (const el of commentListEl.querySelectorAll('.comment-inline-reply[data-comment-inline-reply-root]')) {
			const rid = el.getAttribute('data-comment-inline-reply-root');
			const open =
				commentInlineReplyParentId != null &&
				rid != null &&
				String(commentInlineReplyParentId) === String(rid);
			if (open) {
				el.removeAttribute('hidden');
			} else {
				el.setAttribute('hidden', '');
			}
		}
		hydrateOpenInlineReplyComposer();
	}

	function setCommentCount(nextCount) {
		const n = Number(nextCount ?? 0);
		commentsState.commentCount = Number.isFinite(n) ? Math.max(0, n) : 0;
		if (commentCountEl) {
			const c = commentsState.commentCount;
			commentCountEl.textContent = c === 1 ? '1 Comment' : `${c} Comments`;
		}
		if (typeof opts.onCommentCountChange === 'function') {
			try {
				opts.onCommentCountChange(commentsState.commentCount);
			} catch {
				/* host callback errors are non-fatal */
			}
		}
	}

	function mountCommentReplyIndicators() {
		if (!(commentListEl instanceof HTMLElement)) return;
		if (typeof createReplyIndicatorElement !== 'function') return;
		for (const row of commentListEl.querySelectorAll('.comment-item[data-comment-id]')) {
			const cid = Number(row.getAttribute('data-comment-id'));
			if (!Number.isFinite(cid) || cid <= 0) continue;
			const body = row.querySelector('.comment-body');
			const top = row.querySelector('.comment-top');
			if (!(body instanceof HTMLElement) || !(top instanceof HTMLElement)) continue;
			for (const old of row.querySelectorAll('.msg-reply-indicator')) {
				old.remove();
			}
			const c = commentsState.activity.find(
				(it) => it.type === 'comment' && Number(it?.id) === cid
			);
			if (!c) continue;
			const reply = c.meta && typeof c.meta === 'object' ? c.meta.reply : null;
			if (!reply || typeof reply !== 'object') continue;
			const refId = reply.referenced_id != null ? Number(reply.referenced_id) : NaN;
			if (!Number.isFinite(refId) || refId <= 0) continue;
			const reachable = c.reply_parent_exists !== false;
			const el = createReplyIndicatorElement(reply, reachable, {
				kind: 'comment',
				omitAvatar: true,
			});
			top.insertAdjacentElement('beforebegin', el);
		}
	}

	function viewerAllowsCommentReplyUiNow() {
		return (
			commentTextarea instanceof HTMLTextAreaElement &&
			Number(currentUserId) > 0 &&
			typeof replyTurnIcon === 'function'
		);
	}

	/** Build the reactions cluster markup for one comment. */
	function buildCommentReactionMarkup(c) {
		const reactions = c?.reactions && typeof c.reactions === 'object' ? c.reactions : {};
		const viewerReactions = Array.isArray(c?.viewer_reactions) ? c.viewer_reactions : [];
		const commentId = c?.id != null ? String(c.id) : '';
		const getCount = (arr) => {
			if (!Array.isArray(arr) || arr.length === 0) return 0;
			const last = arr[arr.length - 1];
			const others = typeof last === 'number' ? last : 0;
			const strings = typeof last === 'number' ? arr.slice(0, -1) : arr;
			return strings.filter((s) => typeof s === 'string').length + others;
		};
		const keysWithReactions = REACTION_ORDER.filter((key) => getCount(reactions[key]) > 0);
		const hasAnyReactions = keysWithReactions.length > 0;
		const hasUnusedReactions = REACTION_ORDER.some((key) => getCount(reactions[key]) === 0);
		const reactionPills = hasAnyReactions
			? keysWithReactions.map((key) => {
				const arr = Array.isArray(reactions[key]) ? reactions[key] : [];
				const last = arr[arr.length - 1];
				const others = typeof last === 'number' ? last : 0;
				const strings = (typeof last === 'number' ? arr.slice(0, -1) : arr).filter((s) => typeof s === 'string');
				const count = strings.length + others;
				const countLabel = count > 99 ? '99+' : String(count);
				const hasViewer = viewerReactions.includes(key);
				const iconFn = REACTION_ICONS[key];
				const iconHtml = iconFn ? iconFn('comment-reaction-icon') : '';
				const actionLabel = hasViewer ? `Remove ${key}` : `Add ${key}`;
				const tooltip = strings.length > 0 || others > 0
					? [...strings, others > 0 ? `and ${others} ${others === 1 ? 'other' : 'others'}` : ''].filter(Boolean).join(', ')
					: '';
				const tooltipAttr = tooltip ? ` data-tooltip="${escapeHtml(tooltip)}"` : '';
				return `<button type="button" class="comment-reaction-pill${hasViewer ? ' is-viewer' : ''}" data-emoji-key="${escapeHtml(key)}" data-comment-id="${escapeHtml(commentId)}" aria-label="${escapeHtml(actionLabel)}" title="${escapeHtml(actionLabel)}"${tooltipAttr}><span class="comment-reaction-icon-wrap" aria-hidden="true">${iconHtml}</span><span class="comment-reaction-count">${escapeHtml(countLabel)}</span></button>`;
			}).join('')
			: '';
		const addReactionBtn = hasUnusedReactions ? `<button type="button" class="comment-reaction-add" data-comment-id="${escapeHtml(commentId)}" aria-label="Add reaction" title="Add reaction"><span class="comment-reaction-icon-wrap" aria-hidden="true">${smileIcon('comment-reaction-add-icon')}</span></button>` : '';
		const canReplyToCommentRow = Boolean(commentId) && viewerAllowsCommentReplyUiNow();
		const replyToCommentHtml = canReplyToCommentRow
			? `<button type="button" class="comment-reaction-reply" data-comment-reply="${escapeHtml(commentId)}"
						aria-label="Reply" title="Reply"><span class="comment-reaction-icon-wrap" aria-hidden="true">${replyTurnIcon('comment-reaction-reply-icon')}</span></button>`
			: '';
		const reactionInnerMarkup = `${reactionPills}${addReactionBtn}${replyToCommentHtml}`;
		const reactionPillsRow = reactionInnerMarkup.trim() !== ''
			? `<div class="comment-reaction-pills"><div class="comment-reaction-pills-inner">${reactionInnerMarkup}</div></div>`
			: '';
		const useFullWidthReactionRow = keysWithReactions.length > 1;
		return { reactionPillsRow, useFullWidthReactionRow };
	}

	/** Replace only the reactions cluster of a single comment instead of re-rendering the list. */
	function patchCommentReactionsDom(commentId) {
		if (!(commentListEl instanceof HTMLElement)) return;
		const c = commentsState.activity.find(
			(it) => it.type === 'comment' && Number(it?.id) === Number(commentId)
		);
		if (!c) return;
		const row = commentListEl.querySelector(`.comment-item[data-comment-id="${CSS.escape(String(commentId))}"]`);
		if (!(row instanceof HTMLElement)) return;
		const metaRow = row.querySelector('.comment-meta-row');
		if (!(metaRow instanceof HTMLElement)) {
			// Comment is in edit mode (no meta row); fall back to full render so state stays consistent.
			renderComments();
			return;
		}
		const metaRight = metaRow.querySelector('.comment-meta-right');
		let fullWidthRow = metaRow.querySelector('.comment-meta-reactions-row');
		const { reactionPillsRow, useFullWidthReactionRow } = buildCommentReactionMarkup(c);
		if (useFullWidthReactionRow) {
			if (metaRight instanceof HTMLElement) metaRight.innerHTML = '';
			if (!fullWidthRow) {
				fullWidthRow = document.createElement('div');
				fullWidthRow.className = 'comment-meta-reactions-row';
				metaRow.appendChild(fullWidthRow);
			}
			fullWidthRow.innerHTML = reactionPillsRow;
		} else {
			if (fullWidthRow instanceof HTMLElement) fullWidthRow.remove();
			if (metaRight instanceof HTMLElement) metaRight.innerHTML = reactionPillsRow;
		}
	}

	function renderComments() {
		if (!commentListEl) return;

		const list = Array.isArray(commentsState.activity) ? commentsState.activity : [];
		if (list.length === 0) {
			commentInlineReplyParentId = null;
			if (commentsToolbarEl instanceof HTMLElement) {
				commentsToolbarEl.style.display = 'none';
			}
			if (isAdmin) {
				commentListEl.innerHTML = renderEmptyState({
					className: 'comments-empty',
					title: 'No comments',
				});
			} else {
				commentListEl.innerHTML = renderEmptyState({
					className: 'comments-empty',
					title: 'No comments yet',
					message: 'Be the first to say something.',
				});
			}
			return;
		}

		if (commentsToolbarEl instanceof HTMLElement) {
			commentsToolbarEl.style.display = '';
		}

		const viewerAllowsCommentReplyUi = viewerAllowsCommentReplyUiNow();

		const viewerInlineReplyAvatarHtml = viewerAllowsCommentReplyUi
			? `<div class="comment-avatar comment-inline-reply-avatar"${
					!viewerPlan ? ` style="background: ${escapeHtml(viewerColor)};"` : ''
				}>${
					viewerPlan
						? `<div class="avatar-with-founder-flair avatar-with-founder-flair--sm">
							<div class="founder-flair-avatar-ring">
								<div class="founder-flair-avatar-inner" data-founder-flair-avatar-bg aria-hidden="true">
									${viewerAvatarUrl ? `<img class="comment-avatar-img" src="${escapeHtml(viewerAvatarUrl)}" alt="">` : `${escapeHtml(viewerInitial)}`}
								</div>
							</div>
						</div>`
						: viewerAvatarUrl
							? `<img class="comment-avatar-img" src="${escapeHtml(viewerAvatarUrl)}" alt="">`
							: `${escapeHtml(viewerInitial)}`
				}</div>`
			: '';

		if (
			commentInlineReplyParentId != null &&
			!list.some(
				(it) => it.type === 'comment' && Number(it?.id) === Number(commentInlineReplyParentId)
			)
		) {
			commentInlineReplyParentId = null;
		}

		commentListEl.innerHTML = list.map((item) => {
			if (item?.type === 'tip') {
				const t = item;
				const userName = typeof t?.user_name === 'string' ? t.user_name.trim() : '';
				const displayName = typeof t?.display_name === 'string' ? t.display_name.trim() : '';
				const fallbackName = userName ? userName : 'User';
				const name = displayName || fallbackName;
				const handle = userName ? `@${userName}` : '';
				const avatarUrl = typeof t?.avatar_url === 'string' ? t.avatar_url.trim() : '';
				const tipperId = Number(t?.user_id ?? 0);
				const profileHref = buildProfilePath({ userName, userId: tipperId });
				const seed = userName || String(t?.user_id ?? '') || name;
				const color = getAvatarColor(seed);
				const date = t?.created_at ? new Date(t.created_at) : null;
				const timeAgo = date ? (formatRelativeTime(date) || '') : '';
				const timeTitle = date ? formatDateTime(date) : '';
				const amount = Number(t?.amount ?? 0);
				const safeMessage = t?.message ? processUserText(String(t.message)) : '';
				const amountLabel = `${amount.toFixed(1)} credits`;
				const isFounder = t?.plan === 'founder';
				const tipAvatarHtml = renderCommentAvatarHtml({
					avatarUrl,
					displayName: name,
					color,
					href: profileHref,
					isFounder,
					flairSize: 'sm',
				});

				return `
					<div class="comment-item comment-item-tip">
						${tipAvatarHtml}
						<div class="comment-body">
							<div class="comment-top">
								${profileHref ? `
									<a class="user-link comment-top-left comment-author-link" href="${profileHref}">
										<span class="comment-author-name${isFounder ? ' founder-name' : ''}">${escapeHtml(name)}</span>
										${handle ? `<span class="comment-author-handle${isFounder ? ' founder-name' : ''}">${escapeHtml(handle)}</span>` : ''}
									</a>
								` : `
									<div class="comment-top-left">
										<span class="comment-author-name${isFounder ? ' founder-name' : ''}">${escapeHtml(name)}</span>
										${handle ? `<span class="comment-author-handle${isFounder ? ' founder-name' : ''}">${escapeHtml(handle)}</span>` : ''}
									</div>
								`}
							</div>
							<div class="comment-text comment-tip-text">
								<div class="comment-tip-row">
									<span class="comment-tip-icon">${creditIcon('comment-tip-icon-svg')}</span>
									<span class="comment-tip-label">AMT:</span>
									<span class="comment-tip-value">${escapeHtml(amountLabel)}</span>
								</div>
								${safeMessage ? `
								<div class="comment-tip-row">
									<span class="comment-tip-icon">${creditIcon('comment-tip-icon-svg')}</span>
									<span class="comment-tip-label">MSG:</span>
									<span class="comment-tip-value">${safeMessage}</span>
								</div>
								` : ''}
							</div>
							${timeAgo ? `<div class="comment-time-row"><span class="comment-time" title="${escapeHtml(timeTitle)}">${escapeHtml(timeAgo)}</span></div>` : ''}
						</div>
					</div>
				`;
			}

			const c = item;
			const userName = typeof c?.user_name === 'string' ? c.user_name.trim() : '';
			const displayName = typeof c?.display_name === 'string' ? c.display_name.trim() : '';
			const fallbackName = userName ? userName : 'User';
			const name = displayName || fallbackName;
			const handle = userName ? `@${userName}` : '';
			const avatarUrl = typeof c?.avatar_url === 'string' ? c.avatar_url.trim() : '';
			const commenterId = Number(c?.user_id ?? 0);
			const profileHref = buildProfilePath({ userName, userId: commenterId });
			const seed = userName || String(c?.user_id ?? '') || name;
			const color = getAvatarColor(seed);
			const date = c?.created_at ? new Date(c.created_at) : null;
			const timeAgo = date ? (formatRelativeTime(date) || '') : '';
			const timeTitle = date ? formatDateTime(date) : '';
			const safeText = processUserText(c?.text ?? '', { messageMarkdown: true });
			const createdMs = c?.created_at ? Date.parse(String(c.created_at)) : NaN;
			const updatedMs = c?.updated_at ? Date.parse(String(c.updated_at)) : NaN;
			const isEditedComment =
				Number.isFinite(createdMs) &&
				Number.isFinite(updatedMs) &&
				updatedMs - createdMs >= 1000;
			const isEditing = Number(commentEditingId) === Number(c?.id);
			const isFounder = c?.plan === 'founder';
			const commentAvatarHtml = renderCommentAvatarHtml({
				avatarUrl,
				displayName: name,
				color,
				href: profileHref,
				isFounder,
				flairSize: 'sm',
			});
			const commentId = c?.id != null ? String(c.id) : '';
			const { reactionPillsRow, useFullWidthReactionRow } = buildCommentReactionMarkup(c);
			const canModerateComment = Boolean(commentId) && (isAdmin || (Number(commenterId) > 0 && Number(commenterId) === Number(currentUserId)));
			const commentActionControls = canModerateComment
				? `<span class="comment-time-actions" data-comment-time-actions="${escapeHtml(commentId)}">
					&nbsp;·&nbsp;<button type="button" class="comment-time-action" data-comment-edit="${escapeHtml(commentId)}">${isEditing ? 'cancel' : 'edit'}</button>
					&nbsp;·&nbsp;<button type="button" class="comment-time-action" data-comment-delete="${escapeHtml(commentId)}">delete</button>
				</span>`
				: '';
			const metaRowHtml = isEditing ? '' : `<div class="comment-meta-row">
				<div class="comment-meta-top">
					${timeAgo ? `<span class="comment-time" title="${escapeHtml(timeTitle)}">${escapeHtml(timeAgo)}${commentActionControls}</span>` : `${commentActionControls}`}
					<div class="comment-meta-right">
						${useFullWidthReactionRow ? '' : reactionPillsRow}
					</div>
				</div>
				${useFullWidthReactionRow && reactionPillsRow ? `<div class="comment-meta-reactions-row">${reactionPillsRow}</div>` : ''}
			</div>`;
			const inlineSlotOpen =
				viewerAllowsCommentReplyUi &&
				!isEditing &&
				Number(commentInlineReplyParentId) === Number(c?.id);
			const inlineReplyHtml =
				viewerAllowsCommentReplyUi && !isEditing
					? `<div class="comment-inline-reply"${
							inlineSlotOpen ? '' : ' hidden'
						} data-comment-inline-reply-root="${escapeHtml(commentId)}">
				<div class="comment-input comment-inline-reply-shell">
					${viewerInlineReplyAvatarHtml}
					<div class="comment-input-body comment-inline-reply-input-body">
						<div class="comment-composer-row comment-inline-reply-composer">
							<button type="button" class="comment-input-attach" data-comment-inline-attach="${escapeHtml(commentId)}"
								aria-label="Attach image">
								${typeof plusIcon === 'function' ? plusIcon('comment-input-attach-icon') : '+'}
							</button>
							<textarea class="comment-textarea comment-textarea--composer comment-inline-reply-field" rows="1" maxlength="4000" data-comment-inline-textarea="${escapeHtml(
								commentId
							)}" placeholder="Write a reply…" aria-label="Reply to comment"></textarea>
							<button type="button" class="comment-submit-btn comment-submit-btn--composer" data-comment-inline-submit="${escapeHtml(
								commentId
							)}" aria-label="Send reply" hidden>
								<span class="comment-action-btn-label comment-action-btn-label--arrow" aria-hidden="true">${
									typeof sendIcon === 'function' ? sendIcon('comment-inline-send-icon') : '➤'
								}</span>
								<span class="comment-action-btn-spinner" aria-hidden="true"></span>
							</button>
							<input type="file" hidden accept="image/*" data-comment-inline-attach-input="${escapeHtml(commentId)}" />
						</div>
						<span class="comment-input-attach-status" data-comment-inline-attach-status="${escapeHtml(commentId)}"
							aria-live="polite"></span>
						<button type="button" class="comment-inline-reply-cancel" data-comment-inline-cancel="${escapeHtml(
							commentId
						)}">Cancel</button>
					</div>
				</div>
			</div>`
					: '';
			const commentBodyHtml = isEditing
				? `<div class="comment-edit-wrap" data-comment-edit-wrap="${escapeHtml(commentId)}">
					<textarea class="comment-edit-input" data-comment-edit-input="${escapeHtml(commentId)}" rows="3" maxlength="4000"${commentEditMinHeightPx > 0 ? ` style="min-height: ${Number(commentEditMinHeightPx)}px;"` : ''}>${escapeHtml(commentEditDraft || (c?.text ?? ''))}</textarea>
					<div class="comment-edit-actions">
						<button type="button" class="comment-edit-cancel" data-comment-edit-cancel="${escapeHtml(commentId)}"${commentEditBusy ? ' disabled' : ''}>Cancel</button>
						<button type="button" class="comment-edit-save btn-primary" data-comment-edit-save="${escapeHtml(commentId)}"${commentEditBusy ? ' disabled' : ''}>
							<span class="comment-action-btn-label">Save</span>
							<span class="comment-action-btn-spinner" aria-hidden="true"></span>
						</button>
					</div>
				</div>`
				: `<div class="comment-text">${safeText}${isEditedComment ? '<span class="comment-text-edited-inline"> (edited)</span>' : ''}</div>`;

			return `
				<div class="comment-item" data-comment-id="${escapeHtml(commentId)}">
					${commentAvatarHtml}
					<div class="comment-body">
						<div class="comment-top">
							${profileHref ? `
								<a class="user-link comment-top-left comment-author-link" href="${profileHref}">
									<span class="comment-author-name${isFounder ? ' founder-name' : ''}">${escapeHtml(name)}</span>
									${handle ? `<span class="comment-author-handle${isFounder ? ' founder-name' : ''}">${escapeHtml(handle)}</span>` : ''}
								</a>
							` : `
								<div class="comment-top-left">
									<span class="comment-author-name${isFounder ? ' founder-name' : ''}">${escapeHtml(name)}</span>
									${handle ? `<span class="comment-author-handle${isFounder ? ' founder-name' : ''}">${escapeHtml(handle)}</span>` : ''}
								</div>
							`}
						</div>
						${commentBodyHtml}
						${metaRowHtml}
						${inlineReplyHtml}
					</div>
				</div>
			`;
		}).join('');

		// Comments were re-rendered; run full chat-style rich hydration so uploaded
		// images, creation/share links, YouTube URLs, and inline videos render inline.
		if (typeof hydrateRichUserTextEmbeds === 'function') {
			hydrateRichUserTextEmbeds(commentListEl);
		} else {
			hydrateUserTextLinks(commentListEl);
		}
		mountCommentReplyIndicators();
		hydrateOpenInlineReplyComposer();
	}

	let activeReactionPicker = null;

	function closeReactionPicker() {
		if (activeReactionPicker && activeReactionPicker.parentNode) {
			activeReactionPicker.parentNode.removeChild(activeReactionPicker);
			document.removeEventListener('click', activeReactionPicker._outsideClick);
			activeReactionPicker = null;
		}
	}

	function showReactionPicker(anchor, commentId, unusedKeys, onApplied) {
		closeReactionPicker();
		const panel = document.createElement('div');
		panel.className = 'comment-reaction-picker';
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', 'Add reaction');

		const grid = document.createElement('div');
		grid.className = 'comment-reaction-picker-grid';
		for (const key of unusedKeys) {
			const iconFn = REACTION_ICONS[key];
			const iconHtml = iconFn ? iconFn('comment-reaction-icon') : '';
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'comment-reaction-picker-item';
			btn.dataset.emojiKey = key;
			btn.dataset.commentId = String(commentId);
			btn.innerHTML = `<span class="comment-reaction-icon-wrap" aria-hidden="true">${iconHtml}</span>`;
			btn.setAttribute('aria-label', `Add ${key}`);
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				const emojiKey = btn.dataset.emojiKey;
				onApplied(commentId, emojiKey);
				closeReactionPicker();
			});
			grid.appendChild(btn);
		}
		panel.appendChild(grid);

		document.body.appendChild(panel);

		const rect = anchor.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const pad = 8;
		const pickerW = 200;
		const pickerH = Math.min(180, 36 * Math.ceil(unusedKeys.length / 5) + 24);

		let top = rect.bottom + pad;
		let left = rect.left;
		const preferAbove = rect.top > vh / 2;
		const preferLeft = rect.right > vw - pickerW - pad;

		if (preferAbove && rect.top - pickerH - pad >= 0) {
			top = rect.top - pickerH - pad;
		} else if (!preferAbove && rect.bottom + pickerH + pad <= vh) {
			top = rect.bottom + pad;
		} else if (rect.top >= pickerH + pad) {
			top = rect.top - pickerH - pad;
		}

		if (preferLeft && rect.right - pickerW >= pad) {
			left = rect.right - pickerW;
		} else if (!preferLeft && rect.left + pickerW <= vw - pad) {
			left = rect.left;
		} else {
			left = Math.max(pad, Math.min(vw - pickerW - pad, rect.left));
		}

		panel.style.top = `${top}px`;
		panel.style.left = `${left}px`;

		const panelRect = panel.getBoundingClientRect();
		let adjLeft = parseFloat(panel.style.left) || left;
		let adjTop = parseFloat(panel.style.top) || top;
		if (panelRect.right > vw - pad) adjLeft = vw - panelRect.width - pad;
		if (panelRect.left < pad) adjLeft = pad;
		if (panelRect.bottom > vh - pad) adjTop = vh - panelRect.height - pad;
		if (panelRect.top < pad) adjTop = pad;
		panel.style.left = `${adjLeft}px`;
		panel.style.top = `${adjTop}px`;

		const outsideClick = (e) => {
			if (!panel.contains(e.target) && !anchor.contains(e.target)) {
				closeReactionPicker();
			}
		};
		panel._outsideClick = outsideClick;
		requestAnimationFrame(() => document.addEventListener('click', outsideClick));

		activeReactionPicker = panel;
	}

	const viewerReactionLabel = (viewerUserName || viewerDisplayName) ? `@${viewerUserName || viewerDisplayName}` : null;

	function applyReactionChange(commentId, emojiKey, added) {
		const item = commentsState.activity.find((it) => it.type === 'comment' && Number(it.id) === commentId);
		if (!item) return;
		item.reactions = item.reactions && typeof item.reactions === 'object' ? { ...item.reactions } : {};
		item.reactions[emojiKey] = Array.isArray(item.reactions[emojiKey]) ? [...item.reactions[emojiKey]] : [];
		item.viewer_reactions = Array.isArray(item.viewer_reactions) ? [...item.viewer_reactions] : [];
		const arr = item.reactions[emojiKey];
		const last = arr[arr.length - 1];
		const others = typeof last === 'number' ? last : 0;
		if (added) {
			item.viewer_reactions.push(emojiKey);
			if (typeof last === 'number') {
				arr[arr.length - 1] = others + 1;
			} else if (arr.length === 0) {
				arr.push(viewerReactionLabel ?? 1);
			} else {
				arr.push(viewerReactionLabel ?? 1);
			}
		} else {
			item.viewer_reactions = item.viewer_reactions.filter((k) => k !== emojiKey);
			if (typeof last === 'number') {
				if (others > 1) arr[arr.length - 1] = others - 1;
				else arr.pop();
			} else if (arr.length > 0) {
				arr.pop();
			}
			if (arr.length === 0) delete item.reactions[emojiKey];
		}
		patchCommentReactionsDom(commentId);
	}

	const onCommentListClick = async (e) => {
		const replyToBtn = e.target?.closest?.('[data-comment-reply]');
		if (replyToBtn && replyToBtn instanceof HTMLElement) {
			e.preventDefault();
			e.stopPropagation();
			if (!(Number(currentUserId) > 0)) return;
			const cid = Number(replyToBtn.getAttribute('data-comment-reply'));
			if (!Number.isFinite(cid)) return;
			const item = commentsState.activity.find((it) => it.type === 'comment' && Number(it.id) === cid);
			if (!item) return;
			closeReactionPicker();
			commentInlineReplyParentId = cid;
			commentInlineReplyFocusPending = true;
			syncInlineReplyOpenState();
			return;
		}

		const inlineCancel = e.target?.closest?.('[data-comment-inline-cancel]');
		if (inlineCancel && inlineCancel instanceof HTMLElement) {
			e.preventDefault();
			e.stopPropagation();
			commentInlineReplyParentId = null;
			syncInlineReplyOpenState();
			return;
		}

		const inlineAttachBtn = e.target?.closest?.('[data-comment-inline-attach]');
		if (inlineAttachBtn instanceof HTMLButtonElement) {
			e.preventDefault();
			e.stopPropagation();
			if (inlineAttachBtn.disabled) return;
			const cid = Number(inlineAttachBtn.getAttribute('data-comment-inline-attach'));
			if (!Number.isFinite(cid) || cid <= 0) return;
			commentAttachContext = { kind: 'inline', referencedCommentId: cid };
			if (commentAttachChoiceModal instanceof HTMLElement) {
				closeCommentAttachChoiceModal();
				return;
			}
			const pop = ensureCommentAttachChoiceModal();
			const rect = inlineAttachBtn.getBoundingClientRect();
			const width = 240;
			const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
			const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
			pop.style.left = `${left}px`;
			pop.style.top = `${Math.round(rect.top - 8)}px`;
			pop.style.transform = 'translateY(-100%)';
			return;
		}

		const inlineSubmitBtn = e.target?.closest?.('[data-comment-inline-submit]');
		if (inlineSubmitBtn instanceof HTMLButtonElement) {
			e.preventDefault();
			e.stopPropagation();
			const cid = Number(inlineSubmitBtn.getAttribute('data-comment-inline-submit'));
			if (!Number.isFinite(cid) || inlineSubmitBtn.disabled || commentQuickSubmitInFlight) return;
			void (async () => {
				inlineSubmitBtn.disabled = true;
				setCommentActionButtonLoading(inlineSubmitBtn, true);
				const ta = commentListEl.querySelector(`[data-comment-inline-textarea="${cid}"]`);
				const body = ta instanceof HTMLTextAreaElement ? String(ta.value || '').trim() : '';
				if (!body) {
					inlineSubmitBtn.disabled = false;
					setCommentActionButtonLoading(inlineSubmitBtn, false);
					return;
				}
				try {
					await submitCommentText(body, { referencedCommentId: cid });
					if (ta instanceof HTMLTextAreaElement) {
						ta.value = '';
						syncInlineReplySubmitUi(ta);
					}
				} catch (err) {
					alert(err?.message || 'Failed to post comment');
				} finally {
					inlineSubmitBtn.disabled = false;
					setCommentActionButtonLoading(inlineSubmitBtn, false);
				}
			})();
			return;
		}

		const delBtn = e.target?.closest?.('[data-comment-delete]');
		if (delBtn && delBtn instanceof HTMLElement) {
			e.preventDefault();
			e.stopPropagation();
			const cid = Number(delBtn.getAttribute('data-comment-delete'));
			if (!Number.isFinite(cid)) return;
			const item = commentsState.activity.find((it) => it.type === 'comment' && Number(it.id) === cid);
			const canModerateComment = isAdmin || (Number(item?.user_id) > 0 && Number(item.user_id) === Number(currentUserId));
			if (!canModerateComment) return;
			if (!window.confirm('Delete this comment? This cannot be undone.')) return;
			if (delBtn instanceof HTMLButtonElement) delBtn.disabled = true;
			try {
				const res = await deleteCreatedImageComment(cid);
				if (!res?.ok) {
					const msg = typeof res?.data?.error === 'string' ? res.data.error : 'Failed to delete comment';
					alert(msg);
					return;
				}
				await loadComments({ scrollIfHash: false, showSkeleton: false });
			} finally {
				if (delBtn instanceof HTMLButtonElement) delBtn.disabled = false;
			}
			return;
		}

		const editToggleBtn = e.target?.closest?.('[data-comment-edit]');
		if (editToggleBtn && editToggleBtn instanceof HTMLElement) {
			e.preventDefault();
			e.stopPropagation();
			const cid = Number(editToggleBtn.getAttribute('data-comment-edit'));
			if (!Number.isFinite(cid)) return;
			const item = commentsState.activity.find((it) => it.type === 'comment' && Number(it.id) === cid);
			const canModerateComment = isAdmin || (Number(item?.user_id) > 0 && Number(item.user_id) === Number(currentUserId));
			if (!canModerateComment) return;
			if (Number(commentEditingId) === cid) {
				commentEditingId = null;
				commentEditDraft = '';
				commentEditBusy = false;
				renderComments();
				return;
			}
			commentInlineReplyParentId = null;
			commentEditingId = cid;
			commentEditDraft = item?.text != null ? String(item.text) : '';
			const textWrap = commentListEl.querySelector(`.comment-item[data-comment-id="${cid}"] .comment-text`);
			const measuredHeight =
				textWrap instanceof HTMLElement
					? Math.ceil(textWrap.getBoundingClientRect().height)
					: 0;
			commentEditMinHeightPx = Math.max(92, measuredHeight + 14);
			commentEditBusy = false;
			renderComments();
			const input = commentListEl.querySelector(`[data-comment-edit-input="${cid}"]`);
			if (input instanceof HTMLTextAreaElement) {
				input.focus();
				const end = String(input.value || '').length;
				input.setSelectionRange(end, end);
				syncCommentEditInputUi(input);
			}
			return;
		}

		const editCancelBtn = e.target?.closest?.('[data-comment-edit-cancel]');
		if (editCancelBtn && editCancelBtn instanceof HTMLElement) {
			e.preventDefault();
			e.stopPropagation();
			commentEditingId = null;
			commentEditDraft = '';
			commentEditBusy = false;
			commentEditMinHeightPx = 0;
			renderComments();
			return;
		}

		const editSaveBtn = e.target?.closest?.('[data-comment-edit-save]');
		if (editSaveBtn && editSaveBtn instanceof HTMLElement) {
			e.preventDefault();
			e.stopPropagation();
			const cid = Number(editSaveBtn.getAttribute('data-comment-edit-save'));
			if (!Number.isFinite(cid) || commentEditBusy) return;
			const input = commentListEl.querySelector(`[data-comment-edit-input="${cid}"]`);
			const nextText = input instanceof HTMLTextAreaElement
				? String(input.value || '').trim()
				: String(commentEditDraft || '').trim();
			if (!nextText) {
				alert('Comment text is required');
				return;
			}
			const item = commentsState.activity.find((it) => it.type === 'comment' && Number(it.id) === cid);
			const canModerateComment = isAdmin || (Number(item?.user_id) > 0 && Number(item.user_id) === Number(currentUserId));
			if (!canModerateComment) return;
			commentEditBusy = true;
			if (editSaveBtn instanceof HTMLButtonElement) {
				editSaveBtn.disabled = true;
				setCommentActionButtonLoading(editSaveBtn, true);
			}
			try {
				const res = await updateCreatedImageComment(cid, nextText);
				if (!res?.ok) {
					const msg = typeof res?.data?.error === 'string' ? res.data.error : 'Failed to update comment';
					alert(msg);
					return;
				}
				const idx = commentsState.activity.findIndex((it) => it.type === 'comment' && Number(it.id) === cid);
				if (idx >= 0) {
					commentsState.activity[idx] = {
						...commentsState.activity[idx],
						text: nextText,
						updated_at: new Date().toISOString(),
					};
				}
				commentEditingId = null;
				commentEditDraft = '';
				commentEditBusy = false;
				commentEditMinHeightPx = 0;
				renderComments();
			} finally {
				commentEditBusy = false;
				if (editSaveBtn instanceof HTMLButtonElement) {
					editSaveBtn.disabled = false;
					setCommentActionButtonLoading(editSaveBtn, false);
				}
			}
			return;
		}

		const pill = e.target?.closest?.('.comment-reaction-pill[data-emoji-key][data-comment-id]');
		if (pill && pill instanceof HTMLElement) {
			const commentId = Number(pill.dataset.commentId);
			const emojiKey = pill.dataset.emojiKey;
			if (!Number.isFinite(commentId) || !emojiKey) return;
			const item = commentsState.activity.find((it) => it.type === 'comment' && Number(it.id) === commentId);
			const currentlyAdded = Array.isArray(item?.viewer_reactions) && item.viewer_reactions.includes(emojiKey);
			const optimisticAdded = !currentlyAdded;
			applyReactionChange(commentId, emojiKey, optimisticAdded);
			const res = await toggleCommentReaction(commentId, emojiKey);
			if (!res?.ok || res.data == null) {
				applyReactionChange(commentId, emojiKey, currentlyAdded);
			}
			return;
		}

		const addBtn = e.target?.closest?.('.comment-reaction-add[data-comment-id]');
		if (addBtn && addBtn instanceof HTMLElement) {
			e.preventDefault();
			e.stopPropagation();
			const commentId = Number(addBtn.dataset.commentId);
			if (!Number.isFinite(commentId)) return;
			const item = commentsState.activity.find((it) => it.type === 'comment' && Number(it.id) === commentId);
			const reactions = item?.reactions && typeof item.reactions === 'object' ? item.reactions : {};
			const getCount = (arr) => {
				if (!Array.isArray(arr) || arr.length === 0) return 0;
				const last = arr[arr.length - 1];
				const others = typeof last === 'number' ? last : 0;
				return (typeof last === 'number' ? arr.slice(0, -1) : arr).filter((s) => typeof s === 'string').length + others;
			};
			const unusedKeys = REACTION_ORDER.filter((key) => getCount(reactions[key]) === 0);
			if (unusedKeys.length === 0) return;
			showReactionPicker(addBtn, commentId, unusedKeys, (pickedCommentId, pickedEmojiKey) => {
				applyReactionChange(pickedCommentId, pickedEmojiKey, true);
				toggleCommentReaction(pickedCommentId, pickedEmojiKey).then((res) => {
					if (!res?.ok || res.data == null) {
						applyReactionChange(pickedCommentId, pickedEmojiKey, false);
					}
				});
			});
		}
	};

	const onCommentListInput = (e) => {
		const inlineTa = e.target?.closest?.('[data-comment-inline-textarea]');
		if (inlineTa instanceof HTMLTextAreaElement) {
			syncInlineReplySubmitUi(inlineTa);
			return;
		}
		const input = e.target?.closest?.('[data-comment-edit-input]');
		if (!(input instanceof HTMLTextAreaElement)) return;
		commentEditDraft = input.value;
		syncCommentEditInputUi(input);
	};

	const onCommentListPaste = (e) => {
		const inlineTa = e.target?.closest?.('[data-comment-inline-textarea]');
		if (inlineTa instanceof HTMLTextAreaElement) {
			const cid = Number(inlineTa.getAttribute('data-comment-inline-textarea'));
			if (!Number.isFinite(cid) || cid <= 0) return;
			void handleCommentComposerPaste(
				e,
				{ kind: 'inline', referencedCommentId: cid },
				inlineTa,
			);
		}
	};

	const onCommentListChange = async (e) => {
		const inlineAttachInput = e.target?.closest?.('[data-comment-inline-attach-input]');
		if (!(inlineAttachInput instanceof HTMLInputElement)) return;
		const cid = Number(inlineAttachInput.getAttribute('data-comment-inline-attach-input'));
		if (!Number.isFinite(cid) || cid <= 0) return;
		const attachBtn = commentListEl.querySelector(`[data-comment-inline-attach="${cid}"]`);
		const file = inlineAttachInput.files?.[0];
		commentAttachContext = { kind: 'inline', referencedCommentId: cid };
		await handleCommentAttachInputChange(file, commentAttachContext, attachBtn, inlineAttachInput);
	};

	const onCommentListKeydown = (e) => {
		const inlineTa = e.target?.closest?.('[data-comment-inline-textarea]');
		if (inlineTa instanceof HTMLTextAreaElement) {
			const pid = inlineTa.getAttribute('data-comment-inline-textarea');
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				commentInlineReplyParentId = null;
				syncInlineReplyOpenState();
				return;
			}
			if (e.key === 'Enter' && !e.shiftKey) {
				if (
					typeof isTriggeredSuggestPopupOpen === 'function' &&
					isTriggeredSuggestPopupOpen(inlineTa)
				) {
					return;
				}
				if (isMobileCommentInputMode()) return;
				e.preventDefault();
				e.stopPropagation();
				const sb =
					pid && commentListEl instanceof HTMLElement
						? commentListEl.querySelector(`[data-comment-inline-submit="${pid}"]`)
						: null;
				if (sb instanceof HTMLButtonElement && !sb.disabled && !sb.hidden) {
					sb.click();
				}
			}
			return;
		}
		const input = e.target?.closest?.('[data-comment-edit-input]');
		if (!(input instanceof HTMLTextAreaElement)) return;
		const cid = input.getAttribute('data-comment-edit-input');
		if (!cid) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			commentEditingId = null;
			commentEditDraft = '';
			commentEditBusy = false;
			commentEditMinHeightPx = 0;
			renderComments();
			return;
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			if (isMobileCommentInputMode()) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			const saveBtn = commentListEl.querySelector(`[data-comment-edit-save="${cid}"]`);
			if (saveBtn instanceof HTMLButtonElement && !saveBtn.disabled) {
				saveBtn.click();
			}
		}
	};

	if (commentListEl instanceof HTMLElement) {
		commentListEl.addEventListener('click', onCommentListClick);
		commentListEl.addEventListener('input', onCommentListInput);
		commentListEl.addEventListener('paste', onCommentListPaste);
		commentListEl.addEventListener('change', onCommentListChange);
		commentListEl.addEventListener('keydown', onCommentListKeydown);
	}

	async function loadComments({ scrollIfHash = false, showSkeleton = true } = {}) {
		if (!commentListEl) return;

		const commentsSection = root.querySelector('[data-comments-section]');
		if (commentsSection instanceof HTMLElement) commentsSection.style.display = '';

		if (showSkeleton) {
			setCommentsLoading(true);
			commentListEl.innerHTML = renderCommentsLoadingSkeleton();
		}

		try {
			const res = await fetchCreatedImageActivity(creationId, { order: commentsState.order, limit: 50, offset: 0 })
				.catch(() => ({ ok: false, status: 0, data: null }));

			if (!res.ok) {
				if (commentsToolbarEl instanceof HTMLElement) commentsToolbarEl.style.display = 'none';
				commentListEl.innerHTML = renderEmptyState({ className: 'comments-empty', title: 'Unable to load comments' });
				return;
			}

			if (commentsToolbarEl instanceof HTMLElement) commentsToolbarEl.style.display = '';

			const items = Array.isArray(res.data?.items) ? res.data.items : [];
			const commentCount = Number(res.data?.comment_count ?? items.length);
			commentsState.activity = items;
			setCommentCount(commentCount);
			addPageUsers(items.map((c) => ({
				user_id: c?.user_id,
				user_name: c?.user_name,
				display_name: c?.display_name,
				avatar_url: c?.avatar_url,
			})));
			renderComments();

			if (autoScrollOnHash && scrollIfHash && window.location.hash === '#comments' && !commentsDidInitialHashScroll) {
				commentsDidInitialHashScroll = true;
				scrollToComments();
			}
		} finally {
			if (showSkeleton) {
				setCommentsLoading(false);
			}
		}
	}

	const onSortChange = () => {
		if (!(commentsSortEl instanceof HTMLSelectElement)) return;
		commentsState.order = commentsSortEl.value === 'desc' ? 'desc' : 'asc';
		void loadComments({ scrollIfHash: false });
	};
	if (commentsSortEl instanceof HTMLSelectElement) {
		commentsSortEl.value = commentsState.order;
		commentsSortEl.addEventListener('change', onSortChange);
	}

	function setSubmitVisibility() {
		if (!(commentTextarea instanceof HTMLTextAreaElement)) return;
		if (!(commentSubmitBtn instanceof HTMLButtonElement)) return;
		if (commentComposerRow instanceof HTMLElement) {
			const max = Number(commentTextarea.maxLength);
			const atLimit = Number.isFinite(max) && max > 0 && String(commentTextarea.value || '').length >= max;
			commentComposerRow.classList.toggle('is-at-limit', atLimit);
		}
		const hasText = commentTextarea.value.trim().length > 0;
		const isLoading = commentSubmitBtn.classList.contains('is-loading');
		const forceVisible = commentQuickSubmitInFlight || isLoading;
		commentSubmitBtn.hidden = !(hasText || forceVisible);
		if (!commentSubmitBtn.classList.contains('is-loading')) {
			commentSubmitBtn.disabled = !hasText;
		}
		if (commentAttachBtn instanceof HTMLButtonElement) {
			// Single-mode: typed text OR media/sticker quick-send.
			commentAttachBtn.hidden = false;
			commentAttachBtn.style.visibility = 'visible';
			commentAttachBtn.disabled = commentQuickSubmitInFlight;
			commentAttachBtn.classList.toggle('comment-input-attach--text-disabled', hasText);
			if (hasText) closeCommentAttachChoiceModal();
		}
	}

	const refreshCommentTextarea = commentTextarea instanceof HTMLTextAreaElement
		? attachAutoGrowTextarea(commentTextarea)
		: () => { };

	function syncCommentEditInputUi(input) {
		if (!(input instanceof HTMLTextAreaElement)) return;
		const wrap = input.closest('.comment-edit-wrap');
		const max = Number(input.maxLength);
		const atLimit = Number.isFinite(max) && max > 0 && String(input.value || '').length >= max;
		if (wrap instanceof HTMLElement) {
			wrap.classList.toggle('is-at-limit', atLimit);
		}
		const minHeightPx = Number.parseFloat(String(input.style.minHeight || '0')) || 0;
		input.style.height = 'auto';
		const next = Math.max(minHeightPx, Math.ceil(input.scrollHeight || 0));
		if (next > 0) input.style.height = `${next}px`;
	}

	function setCommentComposerBusy(busy, placeholderOverride = 'Posting...') {
		const on = Boolean(busy);
		if (commentTextarea instanceof HTMLTextAreaElement) {
			if (on) {
				commentComposerBusyPlaceholderPrev = String(commentTextarea.getAttribute('placeholder') || commentTextarea.placeholder || '');
				commentTextarea.disabled = true;
				commentTextarea.placeholder = placeholderOverride;
			} else {
				commentTextarea.disabled = false;
				commentTextarea.placeholder = commentComposerBusyPlaceholderPrev || placeholderText;
			}
		}
		if (commentSubmitBtn instanceof HTMLButtonElement) {
			commentSubmitBtn.hidden = false;
			commentSubmitBtn.disabled = on;
			setCommentActionButtonLoading(commentSubmitBtn, on);
		}
		setSubmitVisibility();
	}

	function extractCommentPostFailureMessage(res) {
		const d = res?.data;
		if (typeof d?.error === 'string' && d.error.trim()) return d.error.trim();
		if (typeof d?.message === 'string' && d.message.trim()) return d.message.trim();
		if (d && typeof d === 'object' && typeof d.detail === 'string' && d.detail.trim()) return d.detail.trim();
		if (typeof d === 'string' && d.trim()) {
			const t = d.trim();
			return t.length > 280 ? `${t.slice(0, 280)}…` : t;
		}
		if (!res?.status) return 'Network error';
		if (res.status === 401) return 'Unauthorized';
		if (res.status === 403) return 'Forbidden';
		return 'Failed to post comment';
	}

	async function submitCommentText(text, { referencedCommentId } = {}) {
		const body = typeof text === 'string' ? text.trim() : '';
		if (!body) return { ok: false, skipped: true };
		const extras = {};
		const refCid = Number(referencedCommentId);
		if (Number.isFinite(refCid) && refCid > 0) {
			extras.referenced_comment_id = refCid;
			if (typeof plainTextReplyPreview === 'function') {
				const refItem = commentsState.activity.find(
					(it) => it.type === 'comment' && Number(it.id) === refCid
				);
				const rawParent = refItem?.text != null ? String(refItem.text) : '';
				try {
					const rp = plainTextReplyPreview(rawParent);
					if (typeof rp === 'string' && rp.trim()) extras.reply_preview = rp.trim();
				} catch {
					/* omit reply_preview */
				}
			}
		}
		const res = await postCreatedImageComment(creationId, body, extras)
			.catch(() => ({ ok: false, status: 0, data: null }));
		if (!res.ok) {
			throw new Error(extractCommentPostFailureMessage(res));
		}
		if (Number.isFinite(refCid) && refCid > 0) {
			commentInlineReplyParentId = null;
		}
		await loadComments({ scrollIfHash: false, showSkeleton: false });
		return { ok: true };
	}

	const onComposerInput = () => {
		refreshCommentTextarea();
		setSubmitVisibility();
	};
	const onComposerKeydown = (e) => {
		if (e.key !== 'Enter' || e.shiftKey) return;
		if (isMobileCommentInputMode()) return;
		if (typeof isTriggeredSuggestPopupOpen === 'function' && isTriggeredSuggestPopupOpen(commentTextarea)) {
			return;
		}
		e.preventDefault();
		if (commentSubmitBtn instanceof HTMLButtonElement && !commentSubmitBtn.disabled) {
			commentSubmitBtn.click();
		}
	};
	const onComposerSubmit = async () => {
		if (!(commentTextarea instanceof HTMLTextAreaElement)) return;
		const text = commentTextarea.value.trim();
		if (!text) return;
		if (commentQuickSubmitInFlight) return;
		if (commentSubmitBtn instanceof HTMLButtonElement) {
			commentSubmitBtn.disabled = true;
			setCommentActionButtonLoading(commentSubmitBtn, true);
		}
		try {
			await submitCommentText(text);
			commentTextarea.value = '';
			refreshCommentTextarea();
			setSubmitVisibility();
		} catch (err) {
			alert(err?.message || 'Failed to post comment');
		} finally {
			if (commentSubmitBtn instanceof HTMLButtonElement) {
				commentSubmitBtn.disabled = false;
				setCommentActionButtonLoading(commentSubmitBtn, false);
			}
		}
	};

	const onComposerPaste = (e) => {
		if (!(commentTextarea instanceof HTMLTextAreaElement)) return;
		void handleCommentComposerPaste(e, { kind: 'main', referencedCommentId: null }, commentTextarea);
	};

	if (commentTextarea instanceof HTMLTextAreaElement) {
		attachMentionSuggest(commentTextarea);
		commentTextarea.addEventListener('input', onComposerInput);
		commentTextarea.addEventListener('keydown', onComposerKeydown);
		commentTextarea.addEventListener('paste', onComposerPaste);
	}
	if (commentSubmitBtn instanceof HTMLButtonElement && commentTextarea instanceof HTMLTextAreaElement) {
		commentSubmitBtn.addEventListener('click', onComposerSubmit);
	}

	/* Comment media/sticker attachments:
	 * - primary "+" opens a choice popup ("Upload an image" or "Use a sticker")
	 * - sticker picker loads/saves URLs in users.meta.comment_stickers
	 * - selecting any item inserts URL into comment text; renderer handles enrichment */
	function getInlineReplyComposerElements(referencedCommentId) {
		if (!(commentListEl instanceof HTMLElement)) return {};
		const cid = Number(referencedCommentId);
		if (!Number.isFinite(cid) || cid <= 0) return {};
		const textarea = commentListEl.querySelector(`[data-comment-inline-textarea="${cid}"]`);
		const submitBtn = commentListEl.querySelector(`[data-comment-inline-submit="${cid}"]`);
		const attachBtn = commentListEl.querySelector(`[data-comment-inline-attach="${cid}"]`);
		const attachInput = commentListEl.querySelector(`[data-comment-inline-attach-input="${cid}"]`);
		const statusEl = commentListEl.querySelector(`[data-comment-inline-attach-status="${cid}"]`);
		return { textarea, submitBtn, attachBtn, attachInput, statusEl };
	}

	let commentAttachContext = { kind: 'main', referencedCommentId: null };

	function resolveAttachTextarea(context = commentAttachContext) {
		if (context?.kind === 'inline') {
			const { textarea } = getInlineReplyComposerElements(context.referencedCommentId);
			return textarea instanceof HTMLTextAreaElement ? textarea : null;
		}
		return commentTextarea instanceof HTMLTextAreaElement ? commentTextarea : null;
	}

	function resolveAttachButton(context = commentAttachContext) {
		if (context?.kind === 'inline') {
			const { attachBtn } = getInlineReplyComposerElements(context.referencedCommentId);
			return attachBtn instanceof HTMLButtonElement ? attachBtn : null;
		}
		return commentAttachBtn instanceof HTMLButtonElement ? commentAttachBtn : null;
	}

	function resolveAttachInput(context = commentAttachContext) {
		if (context?.kind === 'inline') {
			const { attachInput } = getInlineReplyComposerElements(context.referencedCommentId);
			return attachInput instanceof HTMLInputElement ? attachInput : null;
		}
		return commentAttachInput instanceof HTMLInputElement ? commentAttachInput : null;
	}

	function setCommentAttachStatus(text, { tone, context } = {}) {
		const ctx = context && typeof context === 'object' ? context : commentAttachContext;
		let target = null;
		if (ctx?.kind === 'inline') {
			target = getInlineReplyComposerElements(ctx.referencedCommentId).statusEl;
		} else {
			target = commentAttachStatus;
		}
		if (!(target instanceof HTMLElement)) return;
		target.textContent = String(text || '');
		target.classList.toggle('is-error', tone === 'error');
	}

	let commentStickerUrls = null;
	let commentAttachChoiceModal = null;
	let commentStickerModal = null;
	let commentAttachChoiceOutsideClick = null;
	let commentAttachChoiceEscape = null;
	const COMMENT_STICKER_SLOT_LIMIT = 12;
	let commentStickerUploadSlotIndex = null;
	let commentStickerLoadingSlotIndex = null;
	let commentStickerModalBusy = false;

	async function fetchCommentStickerUrls() {
		if (Array.isArray(commentStickerUrls)) return commentStickerUrls;
		const res = await fetch('/api/profile/comment-stickers', {
			method: 'GET',
			credentials: 'include',
			headers: { Accept: 'application/json' },
		}).catch(() => null);
		if (!res || !res.ok) {
			commentStickerUrls = [];
			return commentStickerUrls;
		}
		const data = await res.json().catch(() => null);
		commentStickerUrls = Array.isArray(data?.stickers) ? data.stickers : [];
		return commentStickerUrls;
	}

	async function persistCommentStickerUrls(next) {
		const list = Array.isArray(next) ? next.slice(0, COMMENT_STICKER_SLOT_LIMIT) : [];
		const res = await fetch('/api/profile/comment-stickers', {
			method: 'PUT',
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify({ stickers: list }),
		}).catch(() => null);
		if (!res || !res.ok) {
			const payload = await res?.json?.().catch(() => null);
			throw new Error(payload?.message || payload?.error || 'Failed to save stickers');
		}
		const payload = await res.json().catch(() => null);
		commentStickerUrls = Array.isArray(payload?.stickers) ? payload.stickers : list;
		return commentStickerUrls;
	}

	function closeCommentAttachChoiceModal() {
		if (!(commentAttachChoiceModal instanceof HTMLElement)) return;
		commentAttachChoiceModal.remove();
		commentAttachChoiceModal = null;
		if (typeof commentAttachChoiceOutsideClick === 'function') {
			document.removeEventListener('pointerdown', commentAttachChoiceOutsideClick, true);
			commentAttachChoiceOutsideClick = null;
		}
		if (typeof commentAttachChoiceEscape === 'function') {
			document.removeEventListener('keydown', commentAttachChoiceEscape, true);
			commentAttachChoiceEscape = null;
		}
	}

	function closeCommentStickerModal() {
		if (!(commentStickerModal instanceof HTMLElement)) return;
		if (commentStickerModalBusy) return;
		commentStickerModal.classList.remove('open');
		commentStickerModal.setAttribute('aria-hidden', 'true');
	}

	function ensureCommentAttachChoiceModal() {
		if (commentAttachChoiceModal instanceof HTMLElement) return commentAttachChoiceModal;
		const pop = document.createElement('div');
		pop.className = 'comment-attach-popover';
		pop.setAttribute('role', 'menu');
		pop.setAttribute('aria-label', 'Add to comment');
		pop.innerHTML = `
			<button type="button" class="comment-attach-popover-item" data-comment-attach-choice-upload role="menuitem">
				<span class="comment-attach-popover-item-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"></path>
						<polyline points="7 9 12 4 17 9"></polyline>
						<line x1="12" y1="4" x2="12" y2="16"></line>
					</svg>
				</span>
				<span class="comment-attach-popover-item-label">Upload an Image</span>
			</button>
			<button type="button" class="comment-attach-popover-item" data-comment-attach-choice-sticker role="menuitem">
				<span class="comment-attach-popover-item-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<rect x="4" y="4" width="16" height="16" rx="3"></rect>
						<path d="M9 10h.01"></path>
						<path d="M15 10h.01"></path>
						<path d="M8 15c1 .9 2.3 1.4 4 1.4s3-.5 4-1.4"></path>
					</svg>
				</span>
				<span class="comment-attach-popover-item-label">Use a Sticker</span>
			</button>
		`;
		pop.querySelector('[data-comment-attach-choice-upload]')?.addEventListener('click', () => {
			closeCommentAttachChoiceModal();
			const input = resolveAttachInput(commentAttachContext);
			if (input instanceof HTMLInputElement) {
				input.value = '';
				input.click();
			}
		});
		pop.querySelector('[data-comment-attach-choice-sticker]')?.addEventListener('click', () => {
			closeCommentAttachChoiceModal();
			void openCommentStickerModal();
		});
		document.body.appendChild(pop);
		commentAttachChoiceModal = pop;
		commentAttachChoiceOutsideClick = (e) => {
			if (!(commentAttachChoiceModal instanceof HTMLElement)) return;
			if (commentAttachChoiceModal.contains(e.target)) return;
			const trigger = e.target instanceof HTMLElement
				? e.target.closest('[data-comment-attach], [data-comment-inline-attach]')
				: null;
			if (trigger) return;
			closeCommentAttachChoiceModal();
		};
		document.addEventListener('pointerdown', commentAttachChoiceOutsideClick, true);
		commentAttachChoiceEscape = (e) => {
			if (e.key !== 'Escape') return;
			closeCommentAttachChoiceModal();
		};
		document.addEventListener('keydown', commentAttachChoiceEscape, true);
		return pop;
	}

	function ensureCommentStickerModal() {
		if (commentStickerModal instanceof HTMLElement) return commentStickerModal;
		const overlay = document.createElement('div');
		overlay.className = 'comment-sticker-modal-overlay';
		overlay.setAttribute('aria-hidden', 'true');
		overlay.innerHTML = `
			<div class="comment-sticker-modal" role="dialog" aria-modal="true" aria-label="Choose sticker">
				<div class="comment-sticker-modal-head">
					<div class="comment-sticker-modal-title">Your Stickers</div>
					<button type="button" class="comment-sticker-modal-close" data-comment-sticker-close aria-label="Close">
						<svg class="comment-sticker-modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<line x1="18" y1="6" x2="6" y2="18"></line>
							<line x1="6" y1="6" x2="18" y2="18"></line>
						</svg>
					</button>
				</div>
				<input type="file" hidden accept="image/*" data-comment-sticker-upload-input />
				<div class="comment-sticker-grid" data-comment-sticker-grid></div>
				<span class="comment-sticker-modal-status" data-comment-sticker-status aria-live="polite"></span>
				<div class="comment-sticker-modal-busy" data-comment-sticker-busy hidden aria-hidden="true">
					<span class="comment-sticker-modal-busy-spinner"></span>
				</div>
			</div>
		`;
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) closeCommentStickerModal();
		});
		overlay.querySelector('[data-comment-sticker-close]')?.addEventListener('click', () => {
			closeCommentStickerModal();
		});
		document.body.appendChild(overlay);
		commentStickerModal = overlay;
		return overlay;
	}

	function normalizeCommentStickerSlotList(list) {
		if (!Array.isArray(list)) return [];
		const out = [];
		for (const item of list) {
			if (typeof item !== 'string') continue;
			const trimmed = item.trim();
			if (!trimmed || out.includes(trimmed)) continue;
			out.push(trimmed);
			if (out.length >= COMMENT_STICKER_SLOT_LIMIT) break;
		}
		return out;
	}

	function setStickerModalStatus(text, { tone } = {}) {
		const status = commentStickerModal?.querySelector?.('[data-comment-sticker-status]');
		if (!(status instanceof HTMLElement)) return;
		status.textContent = String(text || '');
		status.classList.toggle('is-error', tone === 'error');
	}

	function setCommentStickerModalBusy(isBusy) {
		commentStickerModalBusy = Boolean(isBusy);
		const modalCard = commentStickerModal?.querySelector?.('.comment-sticker-modal');
		if (!(modalCard instanceof HTMLElement)) return;
		modalCard.classList.toggle('is-busy', commentStickerModalBusy);
		const busyEl = modalCard.querySelector('[data-comment-sticker-busy]');
		if (busyEl instanceof HTMLElement) busyEl.hidden = !commentStickerModalBusy;
	}

	async function refreshStickerGrid() {
		const grid = commentStickerModal?.querySelector?.('[data-comment-sticker-grid]');
		if (!(grid instanceof HTMLElement)) return;
		grid.innerHTML = new Array(COMMENT_STICKER_SLOT_LIMIT).fill(0).map(() => `
			<div class="comment-sticker-slot comment-sticker-slot--loading" aria-hidden="true"></div>
		`).join('');
		const stickers = normalizeCommentStickerSlotList(await fetchCommentStickerUrls());
		commentStickerUrls = stickers;
		const slotCount = COMMENT_STICKER_SLOT_LIMIT;
		grid.innerHTML = new Array(slotCount).fill(0).map((_, idx) => {
			const url = stickers[idx];
			if (url) {
				return `
					<div class="comment-sticker-slot comment-sticker-slot--filled" data-comment-sticker-card="${idx}">
						<button type="button" class="comment-sticker-pick" data-comment-sticker-pick="${idx}" title="Use sticker">
							<img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" />
						</button>
						<button type="button" class="comment-sticker-slot-delete" data-comment-sticker-delete="${idx}" aria-label="Delete sticker" title="Delete sticker">×</button>
					</div>
				`;
			}
			return `
				<button type="button" class="comment-sticker-slot comment-sticker-slot--empty" data-comment-sticker-blank="${idx}" title="Upload sticker">
					${idx === commentStickerLoadingSlotIndex
						? '<span class="comment-sticker-slot-spinner" aria-hidden="true"></span>'
						: '<span class="comment-sticker-slot-plus" aria-hidden="true">+</span>'}
				</button>
			`;
		}).join('');
		grid.querySelectorAll('[data-comment-sticker-pick]').forEach((btn) => {
			btn.addEventListener('click', async () => {
				const i = Number(btn.getAttribute('data-comment-sticker-pick'));
				const list = Array.isArray(commentStickerUrls) ? [...commentStickerUrls] : [];
				const url = list[i];
				if (!url) return;
				if (commentQuickSubmitInFlight) return;
				commentQuickSubmitInFlight = true;
				setCommentStickerModalBusy(true);
				setCommentComposerBusy(true, 'Posting...');
				const attachBtn = resolveAttachButton(commentAttachContext);
				if (attachBtn instanceof HTMLButtonElement) attachBtn.disabled = true;
				try {
					if (commentAttachContext?.kind === 'inline') {
						await submitCommentText(url, {
							referencedCommentId: Number(commentAttachContext.referencedCommentId),
						});
					} else {
						await submitCommentText(url);
					}
				} catch (err) {
					setCommentAttachStatus(err?.message || 'Failed to post sticker', {
						tone: 'error',
						context: commentAttachContext,
					});
					return;
				} finally {
					setCommentStickerModalBusy(false);
					commentQuickSubmitInFlight = false;
					setCommentComposerBusy(false);
					if (attachBtn instanceof HTMLButtonElement) attachBtn.disabled = false;
					setSubmitVisibility();
				}
				// Keep "last used" stickers at the front.
				const reordered = [url, ...list.filter((x) => x !== url)];
				commentStickerUrls = reordered.slice(0, COMMENT_STICKER_SLOT_LIMIT);
				void persistCommentStickerUrls(commentStickerUrls).catch(() => {});
				closeCommentStickerModal();
				const ta = resolveAttachTextarea(commentAttachContext);
				if (ta instanceof HTMLTextAreaElement) ta.focus();
			});
		});
		grid.querySelectorAll('[data-comment-sticker-blank]').forEach((btn) => {
			btn.addEventListener('click', () => {
				if (commentStickerLoadingSlotIndex !== null) return;
				const uploadInput = commentStickerModal?.querySelector?.('[data-comment-sticker-upload-input]');
				if (!(uploadInput instanceof HTMLInputElement)) return;
				commentStickerUploadSlotIndex = Number(btn.getAttribute('data-comment-sticker-blank'));
				uploadInput.value = '';
				uploadInput.click();
			});
		});
		grid.querySelectorAll('[data-comment-sticker-delete]').forEach((btn) => {
			btn.addEventListener('click', async () => {
				const i = Number(btn.getAttribute('data-comment-sticker-delete'));
				const list = Array.isArray(commentStickerUrls) ? [...commentStickerUrls] : [];
				const url = list[i];
				if (!url) return;
				const ok = window.confirm('Delete this sticker forever?');
				if (!ok) return;
				const next = list.filter((x, idx) => idx !== i);
				commentStickerUrls = next;
				try {
					await persistCommentStickerUrls(next);
					await refreshStickerGrid();
					setStickerModalStatus('');
				} catch (err) {
					setStickerModalStatus(err?.message || 'Failed to delete sticker', { tone: 'error' });
				}
			});
		});
	}

	async function openCommentStickerModal() {
		const modal = ensureCommentStickerModal();
		modal.classList.add('open');
		modal.setAttribute('aria-hidden', 'false');
		setCommentStickerModalBusy(false);
		setStickerModalStatus('');
		await refreshStickerGrid();
		setStickerModalStatus('');
		const uploadInput = modal.querySelector('[data-comment-sticker-upload-input]');
		if (uploadInput instanceof HTMLInputElement && uploadInput.dataset.bound !== '1') {
			uploadInput.dataset.bound = '1';
			uploadInput.addEventListener('change', async () => {
				const file = uploadInput.files?.[0];
				if (!file) return;
				if (typeof uploadImageFile !== 'function') {
					setStickerModalStatus('Upload unavailable. Refresh and try again.', { tone: 'error' });
					return;
				}
				const pickedSlotIndex = Number.isInteger(commentStickerUploadSlotIndex) ? commentStickerUploadSlotIndex : null;
				commentStickerLoadingSlotIndex = pickedSlotIndex;
				await refreshStickerGrid();
				setStickerModalStatus('');
				try {
					const url = await uploadImageFile(file, { uploadKind: 'generic' });
					if (typeof url !== 'string' || !url) throw new Error('Upload returned no URL');
					const existing = normalizeCommentStickerSlotList(commentStickerUrls);
					const base = existing.filter((x) => x !== url);
					const next = [...base];
					const slotIndex = Number.isInteger(commentStickerUploadSlotIndex) ? commentStickerUploadSlotIndex : next.length;
					const insertAt = Math.max(0, Math.min(slotIndex, next.length));
					next.splice(insertAt, 0, url);
					await persistCommentStickerUrls(next);
					await refreshStickerGrid();
					setStickerModalStatus('');
				} catch (err) {
					setStickerModalStatus(err?.message || 'Upload failed', { tone: 'error' });
				} finally {
					commentStickerUploadSlotIndex = null;
					commentStickerLoadingSlotIndex = null;
					uploadInput.value = '';
					await refreshStickerGrid();
				}
			});
		}
	}

	function extractClipboardImageFiles(clipboardData) {
		if (!clipboardData) return [];
		const imageFiles = [];
		for (const it of clipboardData.items || []) {
			if (it.kind !== 'file') continue;
			const f = it.getAsFile();
			if (f) imageFiles.push(f);
		}
		if (imageFiles.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
			for (const f of clipboardData.files) {
				if (f) imageFiles.push(f);
			}
		}
		return imageFiles.filter((f) => String(f.type || '').startsWith('image/'));
	}

	async function handleCommentComposerPaste(ev, context, textarea) {
		if (!(textarea instanceof HTMLTextAreaElement) || textarea.disabled) return;
		if (commentQuickSubmitInFlight) return;
		if (String(textarea.value || '').trim().length > 0) return;
		const cd = ev.clipboardData;
		if (!cd) return;
		const imageFiles = extractClipboardImageFiles(cd);
		if (imageFiles.length === 0) return;
		ev.preventDefault();
		commentAttachContext = context;
		const attachBtn = resolveAttachButton(context);
		const attachInput = resolveAttachInput(context);
		await handleCommentAttachInputChange(imageFiles[0], context, attachBtn, attachInput);
	}

	async function handleCommentAttachInputChange(file, context, attachBtn, attachInput) {
		if (!file) return;
		if (typeof uploadImageFile !== 'function') {
			setCommentAttachStatus('Upload unavailable. Refresh and try again.', {
				tone: 'error',
				context,
			});
			return;
		}
		if (commentQuickSubmitInFlight) return;
		commentQuickSubmitInFlight = true;
		setCommentComposerBusy(true, 'Posting...');
		if (attachBtn instanceof HTMLButtonElement) {
			attachBtn.disabled = true;
			attachBtn.classList.add('is-loading');
		}
		try {
			const url = await uploadImageFile(file, { uploadKind: 'generic' });
			if (typeof url !== 'string' || !url) throw new Error('Upload returned no URL');
			if (context?.kind === 'inline') {
				await submitCommentText(url, { referencedCommentId: Number(context.referencedCommentId) });
			} else {
				await submitCommentText(url);
			}
		} catch (err) {
			setCommentAttachStatus(err?.message || 'Upload/post failed', { tone: 'error', context });
		} finally {
			commentQuickSubmitInFlight = false;
			setCommentComposerBusy(false);
			if (attachBtn instanceof HTMLButtonElement) {
				attachBtn.disabled = false;
				attachBtn.classList.remove('is-loading');
			}
			if (attachInput instanceof HTMLInputElement) {
				attachInput.value = '';
			}
			setSubmitVisibility();
		}
	}

	const onAttachBtnClick = () => {
		if (!(commentAttachBtn instanceof HTMLButtonElement)) return;
		if (commentAttachBtn.disabled) return;
		commentAttachContext = { kind: 'main', referencedCommentId: null };
		if (commentAttachChoiceModal instanceof HTMLElement) {
			closeCommentAttachChoiceModal();
			return;
		}
		const pop = ensureCommentAttachChoiceModal();
		const rect = commentAttachBtn.getBoundingClientRect();
		const width = 240;
		const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
		const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
		pop.style.left = `${left}px`;
		pop.style.top = `${Math.round(rect.top - 8)}px`;
		pop.style.transform = 'translateY(-100%)';
	};
	const onAttachInputChange = async () => {
		if (!(commentAttachInput instanceof HTMLInputElement)) return;
		const file = commentAttachInput.files?.[0];
		await handleCommentAttachInputChange(
			file,
			{ kind: 'main', referencedCommentId: null },
			commentAttachBtn,
			commentAttachInput,
		);
	};
	if (commentAttachBtn instanceof HTMLButtonElement && commentAttachInput instanceof HTMLInputElement) {
		commentAttachBtn.addEventListener('click', onAttachBtnClick);
		commentAttachInput.addEventListener('change', onAttachInputChange);
	}

	const onHashChange = () => {
		if (!autoScrollOnHash) return;
		if (window.location.hash === '#comments') {
			scrollToComments();
		}
	};
	if (autoScrollOnHash) {
		window.addEventListener('hashchange', onHashChange);
	}

	// Initial paint + load.
	refreshCommentTextarea();
	setSubmitVisibility();
	void loadComments({ scrollIfHash: autoScrollOnHash });

	let isTorn = false;
	function teardown() {
		if (isTorn) return;
		isTorn = true;
		setCommentsLoading(false);
		try { closeReactionPicker(); } catch { /* ignore */ }
		try { closeCommentAttachChoiceModal(); } catch { /* ignore */ }
		if (commentStickerModal instanceof HTMLElement) {
			try { commentStickerModal.remove(); } catch { /* ignore */ }
			commentStickerModal = null;
		}
		if (autoScrollOnHash) {
			window.removeEventListener('hashchange', onHashChange);
		}
		if (commentListEl instanceof HTMLElement) {
			commentListEl.removeEventListener('click', onCommentListClick);
			commentListEl.removeEventListener('input', onCommentListInput);
			commentListEl.removeEventListener('paste', onCommentListPaste);
			commentListEl.removeEventListener('change', onCommentListChange);
			commentListEl.removeEventListener('keydown', onCommentListKeydown);
		}
		if (commentsSortEl instanceof HTMLSelectElement) {
			commentsSortEl.removeEventListener('change', onSortChange);
		}
		if (commentTextarea instanceof HTMLTextAreaElement) {
			commentTextarea.removeEventListener('input', onComposerInput);
			commentTextarea.removeEventListener('keydown', onComposerKeydown);
			commentTextarea.removeEventListener('paste', onComposerPaste);
		}
		if (commentSubmitBtn instanceof HTMLButtonElement) {
			commentSubmitBtn.removeEventListener('click', onComposerSubmit);
		}
		if (commentAttachBtn instanceof HTMLButtonElement) {
			commentAttachBtn.removeEventListener('click', onAttachBtnClick);
		}
		if (commentAttachInput instanceof HTMLInputElement) {
			commentAttachInput.removeEventListener('change', onAttachInputChange);
		}
		try { container.innerHTML = ''; } catch { /* ignore */ }
	}

	return {
		teardown,
		refresh: () => loadComments({ scrollIfHash: false }),
	};
}
