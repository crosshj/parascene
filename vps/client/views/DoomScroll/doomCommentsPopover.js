import { mountCreationCommentsThread } from '../../shared/creationCommentsThread.js';
import './DoomCommentsPopover.css';
let active = null;
export function destroyDoomCommentsPopover() { active?.destroy(); active = null; }
export function openDoomCommentsPopover({ detailHref, viewer, createdImageId } = {}) {
 destroyDoomCommentsPopover();
 const id = Number(createdImageId || /\/creations\/(\d+)/.exec(detailHref || '')?.[1]);
 const root = document.createElement('dialog'); root.className = 'doom-comments-dialog';
 root.innerHTML = '<div class="chat-doom-comments-header"><h2>Comments</h2><button type="button" aria-label="Close comments">×</button></div><div class="chat-doom-comments-mount"></div>';
 document.body.append(root); document.documentElement.dataset.chatDoomCommentsOpen = '1';
 let alive = true, handle;
 const onHistoryDismiss = event => { if (event.detail?.key === 'doom-comments') record.destroy(); };
 document.addEventListener('parascene:dialog-dismiss', onHistoryDismiss);
 const record = { destroy() { if (!alive) return; alive = false; handle?.teardown?.(); document.removeEventListener('parascene:dialog-dismiss', onHistoryDismiss); document.dispatchEvent(new CustomEvent('parascene:dialog-history', {detail:{key:'doom-comments',open:false}})); delete document.documentElement.dataset.chatDoomCommentsOpen; root.close(); root.remove(); if (active===record) active=null; } }; active = record;
 root.querySelector('button').addEventListener('click',()=>record.destroy());
 root.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();record.destroy();});
 root.addEventListener('click',event=>{if(event.target===root)record.destroy();});
 root.showModal();
 document.dispatchEvent(new CustomEvent('parascene:dialog-history', {detail:{key:'doom-comments',open:true}}));
 void mountCreationCommentsThread(root.querySelector('.chat-doom-comments-mount'), { createdImageId:id, viewer:viewer || null, isAdmin:viewer?.role==='admin', autoScrollOnHash:false }).then(result=>{if(!alive)result?.teardown?.();else handle=result;}).catch(error=>{if(alive)root.querySelector('.chat-doom-comments-mount').textContent=error.message;});
 return record;
}
