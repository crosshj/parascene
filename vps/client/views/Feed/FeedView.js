import markup from './FeedView.html';
import './FeedView.css';
import { createTemplateFactory } from '../../utils/dom.js';

const clone = createTemplateFactory(markup);

export const FeedView = Object.freeze({
 mount({ outlet }) {
  const root = clone('feed-overview');
  outlet.replaceChildren(root);
  document.title = 'Feed · Parascene beta';
  return { destroy() { root.remove(); } };
 },
});
