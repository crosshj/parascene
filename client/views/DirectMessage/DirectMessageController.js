import { createConversationController } from '../../components/Messages/ConversationController.js';

export function createDirectMessageController({ view, services, slug }) {
	return createConversationController({ view, provider: services.providers.threads, viewerId: services.providers.viewerId, getViewer: () => services.session.user,
		route: { kind: 'dm', slug }, onUnauthorized: services.session.redirectToLogin });
}
