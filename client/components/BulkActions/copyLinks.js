import { showToast } from '../../shared/toast.js';

export async function copyBulkLinks(links) {
 const values = links.filter(Boolean);
 if (!values.length) return;
 let copied = false;
 try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(values.join('\n')); copied = true; } } catch { /* WWW falls back to execCommand. */ }
 if (!copied) {
  const textarea = document.createElement('textarea');
  textarea.value = values.join('\n'); textarea.style.position = 'fixed'; textarea.style.opacity = '0';
  document.body.append(textarea);
  try { textarea.select(); copied = document.execCommand('copy'); } finally { textarea.remove(); }
 }
 showToast(copied ? values.length === 1 ? 'Link copied' : `${values.length} links copied` : 'Copy failed');
}
