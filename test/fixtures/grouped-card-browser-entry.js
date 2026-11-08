import { setupFeedCardGroupCarousel } from '../../client/shared/feedCardBuild.js';
import { attachFeedCardCreationDragSource, PRSN_FEED_CREATION_DRAG_MIME } from '../../client/shared/creationComposerDrag.js';

const card = document.createElement('div');
card.className = 'feed-card';
card.dataset.imageId = '50';
card.dataset.imageUrlFull = '/cover.png';
card.dataset.groupCreation = '1';
const media = document.createElement('div');
media.className = 'feed-card-image';
card.append(media);
document.body.append(card);
const item = { id: 50, title: 'Group', meta: { group: { kind: 'group_creations', cover_source_id: 91, source_creations: [
 { id: 91, file_path: '/api/images/created/red.png', title: 'Red' },
 { id: 92, file_path: '/api/images/created/blue.png', title: 'Blue' },
] } } };
const mounted = setupFeedCardGroupCarousel(media, item);
attachFeedCardCreationDragSource(card);
media.querySelector('.feed-card-group-nav--next')?.click();
const transfer = new DataTransfer();
card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
const payload = JSON.parse(transfer.getData(PRSN_FEED_CREATION_DRAG_MIME));
document.body.dataset.result = JSON.stringify({ mounted, selectedId: card.dataset.selectedGroupSourceId,
 activeIndex: [...media.querySelectorAll('.feed-card-group-img')].findIndex(image => image.classList.contains('is-active')),
 payload });
