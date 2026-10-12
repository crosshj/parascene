import './FeedCards.css';
import './FeedView.css';
import './feedChallengeCard.css';
import { createFeedController } from './FeedController.js';

export const FeedView = Object.freeze({
 mount(context) {
  const root = document.createElement('section'); root.className = 'feed-view';
  root.innerHTML = '<div class="feed-view__status" role="status" hidden></div><div data-feed-content></div><button class="feed-view__more btn-outlined" type="button" hidden>Load more</button>';
  context.outlet.replaceChildren(root); context.services.providers.document.setTitle('Feed · Parascene beta');
  const controller = createFeedController({ ...context, root });
  return { destroy() { controller.destroy(); root.remove(); } };
 }
});
