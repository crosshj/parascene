// Session placeholders are scoped to the viewer; the mounted grid owns their presentation.
export function createPendingCreationsStore(viewerId) {
 const key = `prsn-vps-pending-creations:${viewerId || 'anonymous'}`;
 function read() {
  try { const value = JSON.parse(sessionStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
 }
 function write(items) { try { sessionStorage.setItem(key, JSON.stringify(items)); } catch {} }
 function reconcile(rows) {
  const ids = new Set(rows.map(row => String(row.id ?? row.created_image_id)));
  const tokens = new Set(rows.map(row => {
   let meta = row.meta;
   if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = null; } }
   return meta?.creation_token;
  }).filter(Boolean));
  const items = read().filter(item => !ids.has(String(item.id)) && !tokens.has(item.creation_token) && Date.now() - Date.parse(item.created_at) < 60 * 60 * 1000);
  write(items);
  return items.map(item => ({ ...item, __optimistic: true }));
 }
 return { key, read, reconcile, clear() { try { sessionStorage.removeItem(key); } catch {} } };
}
