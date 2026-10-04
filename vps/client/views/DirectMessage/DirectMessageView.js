import { createConversationChrome } from '../../components/Messages/ConversationChrome.js';
import { bindMessageComposer } from '../../components/Messages/Composer.js';
import { mountMessages } from '../../components/Messages/Messages.js';
import { createDirectMessageController } from './DirectMessageController.js';
import { buildChatThreadRowAvatarHtml } from '../../shared/chatSidebarRoster.js';
import { getAvatarColor } from '../../shared/avatar.js';
import { renderCommentAvatarHtml } from '../../shared/commentItem.js';
import { buildProfilePath } from '../../shared/profileLinks.js';

export const DirectMessageView = Object.freeze({
	mount({ outlet, services, slug = '', title = '', composer, setConversationIdentity, setHeaderMenu, setHeaderAccessories, rightSidebar, actions }) {
		let controller;
		const chrome = createConversationChrome({ services, setHeaderMenu, setHeaderAccessories, rightSidebar, actions });
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
			const otherUser = thread.other_user || {};
			const displayName = otherUser.display_name?.trim() || otherUser.user_name?.trim() || title || 'Direct message';
			const profileHref = Number(thread.other_user_id) !== Number(services.providers.viewerId)
				? buildProfilePath({ userName: otherUser.user_name, userId: thread.other_user_id })
				: null;
			setConversationIdentity?.({
				title: displayName,
				avatarHtml: buildChatThreadRowAvatarHtml(thread, { getAvatarColor, renderCommentAvatarHtml }),
				href: profileHref,
			});
		};
		controller = createDirectMessageController({ view, services, slug: slug || "self" });
		chrome.connect(controller);
		view.refreshChrome = () => chrome.refresh();
		document.title = `${title} - parascene beta`;
		return { destroy() { chrome.destroy(); controller.destroy(); binding.destroy(); view.destroy(); } };
	},
});
