// Scoped lifetime for WWW fragments that the active SPA hosts in overlays.
export function createFragmentLifetime(root) {
 const controller = new AbortController(), disposers = []; let active = true;
 return {
  get active() { return active; }, signal: controller.signal,
  async fetch(url, options = {}) {
   const response = await fetch(url, { ...options, signal: controller.signal });
   if (!active) throw new DOMException('View closed', 'AbortError');
   for(const method of ['json','text','blob']){const read=response[method].bind(response);response[method]=async()=>{const value=await read();if(!active)throw new DOMException('View closed','AbortError');return value;};}
   return response;
  },
  objectUrl(blob) { const url=URL.createObjectURL(blob);disposers.push(()=>URL.revokeObjectURL(url));return url; },
  delay(ms) { return new Promise((resolve,reject)=>{if(!active)return reject(new DOMException('View closed','AbortError'));const onAbort=()=>{clearTimeout(timer);reject(new DOMException('View closed','AbortError'))};const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',onAbort);resolve()},ms);controller.signal.addEventListener('abort',onAbort,{once:true});}); },
  listen(target, type, handler, options) { target.addEventListener(type, handler, options); disposers.push(() => target.removeEventListener(type, handler, options)); },
  own(dispose) { disposers.push(dispose); },
  destroy() { active = false; controller.abort(); for (const dispose of disposers.splice(0).reverse()) dispose(); root.querySelectorAll('audio,video').forEach(media => { media.pause(); media.removeAttribute('src'); media.load(); }); root.remove(); }
 };
}
