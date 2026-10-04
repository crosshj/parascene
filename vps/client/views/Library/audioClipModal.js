import '../../components/Modal/Modal.css';
import { createModalDismissButton } from '../../shared/modalDismiss.js';
import { AudioClipDetailView } from '../AudioClipDetail/AudioClipDetailView.js';

export function createAudioClipModal({ services, actions, onEdit, onDismiss }) {
 const dialog = document.createElement('dialog'); dialog.className = 'app-dialog library-audio-clip-modal'; dialog.setAttribute('aria-label', 'Audio clip');
 dialog.innerHTML = '<header class="app-dialog__header"><h2 class="app-dialog__title">Audio clip</h2></header><div class="app-dialog__body"></div><footer class="app-dialog__footer" hidden><button type="button" class="btn-secondary" data-edit-audio-clip>Edit clip</button></footer>';
 const body = dialog.querySelector('.app-dialog__body'); let mounted, destroyed = false, previousTitle, currentClip;
 const dismiss = createModalDismissButton(); dialog.querySelector('header').append(dismiss); document.body.append(dialog);
 function dispose() { const wasMounted = !!mounted; mounted?.destroy(); mounted = null; currentClip = null; body.replaceChildren(); if (previousTitle) document.title = previousTitle; if (wasMounted && !destroyed) onDismiss?.(); }
 function close() { if (dialog.open) dialog.close(); dispose(); }
 dismiss.addEventListener('click', close); dialog.addEventListener('close', () => { if (!dialog.open) dispose(); }); dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
 dialog.querySelector('[data-edit-audio-clip]').addEventListener('click', () => { const clip = currentClip; close(); if (clip) onEdit?.(clip); });
 return {
  open(clip) {
   if (destroyed || dialog.open) return; previousTitle = document.title; currentClip = clip;
   dialog.querySelector('footer').hidden = clip.can_edit !== true;
   dialog.showModal();
   mounted = AudioClipDetailView.mount({ outlet: body, services, url: `/audio-clips/${encodeURIComponent(clip.id)}`, modal: true, autoplay: true, onClipLoaded: detail => { if (!dialog.open || destroyed) return; currentClip = { ...clip, ...detail }; dialog.querySelector('footer').hidden = currentClip.can_edit !== true; }, actions: { ...actions, navigate(href) { close(); void actions.navigate(href); } } });
  },
  destroy() { destroyed = true; close(); dialog.remove(); },
 };
}
