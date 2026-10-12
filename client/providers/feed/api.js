import { requestJson } from '../../core/request.js';

// Compatibility result shape for the ported WWW pagers.
export function createFeedRequest(signal) {
 return async (path, options = {}) => {
  const data = await requestJson(path, { ...options, signal });
  return { ok: true, status: 200, data };
 };
}
