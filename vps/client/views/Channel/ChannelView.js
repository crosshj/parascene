import { createConversationChrome } from '../../components/Messages/ConversationChrome.js';
import { bindMessageComposer } from '../../components/Messages/Composer.js';
import { mountMessages } from '../../components/Messages/Messages.js';
import { createChannelController } from './ChannelController.js';
import { buildChatThreadRowAvatarHtml } from '../../shared/chatSidebarRoster.js';
import { serverChannelTagFromServerName } from '../../shared/serverChatTag.js';
import { getAvatarColor } from '../../shared/avatar.js';
import { renderCommentAvatarHtml } from '../../shared/commentItem.js';

export const ChannelView = Object.freeze({
	mount({ outlet, services, slug = '', threadId, title = '', composer, setConversationIdentity, setHeaderMenu, setHeaderAccessories, rightSidebar, actions }) {
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
			const server = [...(inbox.servers || [])].sort((a, b) => Number(a.id) - Number(b.id)).find(row => serverChannelTagFromServerName(row.name) === String(thread.channel_slug || '').toLowerCase());
			const meta = server?.avatar_url?.trim() ? { ...thread, server_avatar_url: server.avatar_url.trim() } : thread;
			setConversationIdentity?.({ title: thread.title, avatarHtml: buildChatThreadRowAvatarHtml(meta, { getAvatarColor, renderCommentAvatarHtml }) });
		};
		controller = createChannelController({ view, services, slug: slug || "feedback", threadId });
		chrome.connect(controller);
		view.refreshChrome = () => chrome.refresh();
		document.title = title ? `${title} - parascene beta` : 'parascene beta';
		return { destroy() { chrome.destroy(); controller.destroy(); binding.destroy(); view.destroy(); } };
	},
});
