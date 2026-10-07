import '../../components/Modal/Modal.css';
import { createModalDismissButton } from '../../shared/modalDismiss.js';
import { StyleDetailView } from '../StyleDetail/StyleDetailView.js';

export function createStyleModal({ services, actions, onSaved, onDismiss }) {
 const dialog = document.createElement('dialog'); dialog.className = 'app-dialog library-style-modal'; dialog.setAttribute('aria-label', 'Add style');
 dialog.innerHTML = '<header class="app-dialog__header"><h2 class="app-dialog__title">Add style</h2></header><div class="app-dialog__body"></div><footer class="app-dialog__footer" hidden><span role="status"></span><button type="button" class="btn-secondary" data-copy-style-key>Copy style key</button></footer>';
 const body = dialog.querySelector('.app-dialog__body'); let mounted, destroyed = false, previousTitle, currentTag = '';
 const dismiss = createModalDismissButton(); dialog.querySelector('header').append(dismiss); document.body.append(dialog);
 function dispose() { const wasMounted = !!mounted; mounted?.destroy(); mounted = null; body.replaceChildren(); if (previousTitle != null) services.providers.document.setTitle(previousTitle); previousTitle = null; if (wasMounted && !destroyed) onDismiss?.(); }
 function close() { if (dialog.open) dialog.close(); dispose(); }
 dismiss.addEventListener('click', close); dialog.addEventListener('close', () => { if (!dialog.open) dispose(); }); dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
 dialog.querySelector('[data-copy-style-key]').addEventListener('click', async () => { const tag = currentTag; try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(tag); else window.prompt('Copy style key', tag); if (dialog.open && currentTag === tag) dialog.querySelector('[role="status"]').textContent = 'Copied'; } catch { if (dialog.open) dialog.querySelector('[role="status"]').textContent = 'Unable to copy'; } });
 return {
  open(style = null) {
   if (destroyed || dialog.open) return; previousTitle = services.providers.document.baseTitle; currentTag = style ? String(typeof style === 'string' ? style : style.tag).toLowerCase() : '';
   dialog.querySelector('h2').textContent = currentTag ? 'Style details' : 'Add style'; dialog.setAttribute('aria-label', currentTag ? 'Style details' : 'Add style');
   dialog.querySelector('footer').hidden = !currentTag; dialog.querySelector('[role="status"]').textContent = '';
   mounted = StyleDetailView.mount({ outlet: body, services, url: currentTag ? `/styles/${encodeURIComponent(currentTag)}` : '/styles/new', actions: { ...actions, navigate(href) {
    const saved = /^\/styles\/([^/#?]+)$/.exec(href); close(); if (saved && saved[1] !== 'new') onSaved?.(saved[1]);
    else if (!href.startsWith('/prompt-library') && !href.startsWith('/library')) void actions.navigate(href);
   } } }); dialog.showModal();
  },
  destroy() { destroyed = true; close(); dialog.remove(); },
 };
}
