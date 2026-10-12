// Session placeholders are scoped to the viewer; the mounted grid owns their presentation.
export function createPendingCreationsStore(viewerId) {
 const key = `prsn-vps-pending-creations:${viewerId || 'anonymous'}`;
 function read() {
  try { const value = JSON.parse(sessionStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
 }
 function write(items) { try { sessionStorage.setItem(key, JSON.stringify(items)); } catch {} }
 function rowToken(row) {
  if (typeof row?.creation_token === 'string' && row.creation_token.trim()) return row.creation_token.trim();
  let meta = row?.meta;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = null; } }
  return typeof meta?.creation_token === 'string' ? meta.creation_token.trim() : '';
 }
 function reconcile(rows) {
  const visibleIds = new Set();
  const visibleTokens = new Set();
  const terminalIds = new Set();
  const terminalTokens = new Set();
  for (const row of rows) {
   const id = String(row?.id ?? row?.created_image_id ?? '');
   const token = rowToken(row);
   const status = String(row?.status || 'completed').toLowerCase();
   const terminal = status === 'completed' || status === 'failed' || status === 'cancelled';
   if (id) visibleIds.add(id);
   if (token) visibleTokens.add(token);
   if (!terminal) continue;
   if (id) terminalIds.add(id);
   if (token) terminalTokens.add(token);
  }
  const fresh = read().filter(item => Date.now() - Date.parse(item.created_at) < 60 * 60 * 1000);
  // Drop a placeholder only once its creation is finished. An in-flight list
  // snapshot can omit the new row; keeping the placeholder lets that render
  // show the same card instead of removing it and painting it again.
  const kept = fresh.filter(item => !terminalIds.has(String(item.id)) && !terminalTokens.has(item.creation_token));
  write(kept);
  return kept
   .filter(item => !visibleIds.has(String(item.id)) && !visibleTokens.has(item.creation_token))
   .map(item => ({ ...item, __optimistic: true }));
 }
 return { key, read, reconcile, clear() { try { sessionStorage.removeItem(key); } catch {} } };
}
