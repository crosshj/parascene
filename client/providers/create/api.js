import { fetchJsonWithStatusDeduped } from '../../shared/api.js';

// Preserve native Response contracts while keeping Create HTTP transport in its domain.
export function requestCreate(path, options = {}) {
 if (path !== '/api/create' && !path.startsWith('/api/create/')) throw new TypeError('Invalid Create API path');
 return fetch(path, { credentials: 'include', ...options });
}

export function createCreateApi() {
 return {
  request: requestCreate,
  servers() {
   return fetchJsonWithStatusDeduped('/api/servers', { credentials: 'include' }, { windowMs: 2000 });
  },
 };
}
