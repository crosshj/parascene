import { reportSubmissionError } from './SubmissionFeedback.js';
// Work owned by a mounted Create workflow; never touches global browser methods.
export function createWorkflowLifetime() {
 const abort = new AbortController();
 const cleanups = new Set();
 const timers = new Set();
 const frames = new Set();
 let active = true;
 return {
  get active() { return active; },
  get signal() { return abort.signal; },
  listen(target, type, callback, options = {}) {
   if (!active || !target) return;
   const ownedCallback = typeof callback === 'function' ? function(event) {
    try {
     const result = callback.call(this, event);
     if (result?.then) result.catch(error => reportSubmissionError(error, active));
    } catch (error) { reportSubmissionError(error, active); }
   } : callback;
   target.addEventListener(type, ownedCallback, { ...(typeof options === 'boolean' ? { capture: options } : options), signal: abort.signal });
  },
  defer(callback, delay) {
   if (!active) return 0;
   const id = setTimeout(() => { timers.delete(id); if (active) callback(); }, delay);
   timers.add(id);
   return id;
  },
  frame(callback) {
   if (!active) return 0;
   const id = requestAnimationFrame(() => { frames.delete(id); if (active) callback(); });
   frames.add(id);
   return id;
  },
  own(cleanup) { if (typeof cleanup !== 'function') return; if (active) cleanups.add(cleanup); else cleanup(); },
  destroy() {
   if (!active) return;
   active = false;
   abort.abort();
   for (const id of timers) clearTimeout(id);
   for (const id of frames) cancelAnimationFrame(id);
   for (const cleanup of cleanups) cleanup();
   cleanups.clear(); timers.clear(); frames.clear();
  },
 };
}
