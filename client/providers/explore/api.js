import { requestJson } from '../../core/request.js';
export function fetchExplorePage({ q = '', semantic = false, limit = 50, offset = 0, signal } = {}) {
 const path = q ? `/api/explore/search${semantic ? '/semantic' : ''}` : '/api/explore';
 return requestJson(`${path}?${new URLSearchParams({ limit, offset, ...(q ? { q } : {}) })}`, { signal });
}
