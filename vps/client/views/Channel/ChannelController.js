import { createConversationController } from '../../components/Messages/ConversationController.js';

export function createChannelController({ view, services, slug, threadId }) {
	return createConversationController({ view, provider: services.providers.threads, viewerId: services.providers.viewerId, getViewer: () => services.session.user,
		route: { kind: 'channel', slug, threadId }, onUnauthorized: services.session.redirectToLogin });
}
