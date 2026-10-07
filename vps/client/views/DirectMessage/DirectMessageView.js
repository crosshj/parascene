import { createConversationChrome } from '../../components/Messages/ConversationChrome.js';
import { bindMessageComposer } from '../../components/Messages/Composer.js';
import { mountMessages } from '../../components/Messages/Messages.js';
import { createDirectMessageController } from './DirectMessageController.js';
import { buildChatThreadRowAvatarHtml, isSelfDmThread } from '../../shared/chatSidebarRoster.js';
import { getAvatarColor } from '../../shared/avatar.js';
import { renderCommentAvatarHtml } from '../../shared/commentItem.js';
import { buildProfilePath } from '../../shared/profileLinks.js';
import { iconMarkup } from '../../components/Icon/Icon.js';

export const DirectMessageView = Object.freeze({
	mount({ outlet, services, slug = '', title = '', composer, setConversationIdentity, setHeaderMenu, setHeaderAccessories, setHeaderSwitcher, rightSidebar, actions }) {
		let controller;
		const chrome = createConversationChrome({ services, setHeaderMenu, setHeaderAccessories, setHeaderSwitcher, rightSidebar, actions });
		const view = mountMessages({
			outlet, viewerId: services.providers.viewerId,
			onLoadOlder: () => controller?.loadOlder(),
			onRetry: () => controller?.refresh(),
			onRetrySend: (id) => controller?.retrySend(id),
			onRead: (id) => controller?.markRead(id),
			onEdit: (id, body) => controller?.edit(id, body),
			onReply: (id) => controller?.reply(id),
			onReplyJump: (id) => controller?.jumpToReply(id),
			onReact: (id, emoji) => controller?.react(id, emoji),
			onDelete: (id) => controller?.remove(id),
		});
		const binding = bindMessageComposer({ form: composer, onSend: (body, reply) => controller?.send(body, reply) ?? false, onReplyChange: (id) => view.setReplyTarget(id) });
		view.setReady = (ready) => binding.setReady(ready);
		view.setReply = (reply) => binding.setReply(reply);
		view.setThread = (thread, inbox) => {
			chrome.setThread(thread, inbox);
			const isNotes = isSelfDmThread(thread, services.providers.viewerId);
			const otherUser = thread.other_user || {};
			const displayName = isNotes ? 'My Notes' : otherUser.display_name?.trim() || otherUser.user_name?.trim() || title || 'Direct message';
			const profileHref = !isNotes && Number(thread.other_user_id) !== Number(services.providers.viewerId)
				? buildProfilePath({ userName: otherUser.user_name, userId: thread.other_user_id })
				: null;
			setConversationIdentity?.({
				title: displayName,
				avatarHtml: isNotes ? iconMarkup('notes') : buildChatThreadRowAvatarHtml(thread, { getAvatarColor, renderCommentAvatarHtml }),
				href: profileHref,
			});
		};
		controller = createDirectMessageController({ view, services, slug: slug || "self" });
		chrome.connect(controller);
		view.refreshChrome = () => chrome.refresh();
		services.providers.document.setTitle(`${title} - parascene beta`);
		return { destroy() { chrome.destroy(); controller.destroy(); binding.destroy(); view.destroy(); } };
	},
});
