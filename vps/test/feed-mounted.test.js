import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {JSDOM} from 'jsdom';
async function harness(url,fetcher,{mobile=false}={}){const dom=new JSDOM('<div class="beta-outlet__scroll"><div id="outlet"></div></div>',{url:'http://localhost'+url,pretendToBeVisual:true}),w=dom.window;w.HTMLElement.prototype.scrollTo=function(){};const observers=[];class Observer{constructor(callback,options){this.callback=callback;this.options=options;this.targets=new Set();this.disconnected=false;observers.push(this)}observe(target){this.targets.add(target)}unobserve(target){this.targets.delete(target)}disconnect(){this.disconnected=true}}w.matchMedia=()=>({matches:mobile,addEventListener(){},removeEventListener(){}});w.HTMLMediaElement.prototype.play=async function(){};w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};const names=['document','Document','HTMLElement','HTMLDivElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLButtonElement','HTMLAnchorElement','HTMLImageElement','HTMLTemplateElement','HTMLFormElement','HTMLMediaElement','HTMLAudioElement','HTMLVideoElement','Element','SVGElement','Node','Image','File','FormData','Event','CustomEvent','DOMException','AbortController','AbortSignal','customElements','localStorage','sessionStorage','navigator','location','MutationObserver'];const context=vm.createContext({...Object.fromEntries(names.map(n=>[n,w[n]])),window:w,innerWidth:w.innerWidth,innerHeight:w.innerHeight,matchMedia:w.matchMedia,console,URL,URLSearchParams,CSS:{escape:v=>v},getComputedStyle:w.getComputedStyle.bind(w),IntersectionObserver:Observer,ResizeObserver:Observer,requestAnimationFrame:w.requestAnimationFrame.bind(w),cancelAnimationFrame:w.cancelAnimationFrame.bind(w),setTimeout,clearTimeout,setInterval:w.setInterval.bind(w),clearInterval:w.clearInterval.bind(w),queueMicrotask,fetch:fetcher,alert(){},confirm:()=>true});const modules=new Map();function module(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);let code=fs.readFileSync(file,'utf8');if(file.endsWith('.css'))code='export default {}';if(file.endsWith('.html'))code='export default '+JSON.stringify(code);const mod=new vm.SourceTextModule(code,{identifier:file,context});modules.set(file,mod);return mod}async function load(file){const mod=module(path.resolve('client',file));if(mod.status==='unlinked')await mod.link((name,parent)=>module(path.resolve(path.dirname(parent.identifier),name)));if(mod.status!=='evaluated')await mod.evaluate();return mod.namespace}const navigations=[],actions={navigate:(...args)=>navigations.push(args),dismissOverlay(){}},services={session:{user:{id:1,role:'consumer',meta:{}},redirectToLogin(){throw Error('Unexpected auth redirect')},refresh:async()=>{}},providers:{document:{setTitle(){},get baseTitle(){return 'parascene'}}}};const searchComposer=(await load('components/SearchComposer/SearchComposer.js')).createSearchComposerElement();w.document.body.append(searchComposer);return {w,load,searchComposer,outlet:w.document.getElementById('outlet'),actions,services,navigations,observers,close:()=>dom.window.close()}}
const tick=()=>new Promise(resolve=>setImmediate(resolve)),response=data=>new Response(JSON.stringify(data),{headers:{"content-type":"application/json"}});

test('Creations metadata updates retain image visibility and request state', { skip: !vm.SourceTextModule }, async () => {
 const h = await harness('/creations', async () => response({}));
 let dispose;
 try {
  const { renderCreationsView } = await h.load('views/Creations/CreationsView.js');
  let publish;
  const item = { id: 32261, title: 'This Moment', url: '/api/creations/media/one.png', media_type: 'image', user_id: 26, published: false };
  const query = { subscribe(callback) { publish = callback; return () => {}; }, async loadIfNeeded() {} };
  let retainedUrls;
  dispose = renderCreationsView({ outlet: h.outlet, creationsQuery: query, creationsProvider: {
   thumbnails: { retain(urls) { retainedUrls = [...urls]; }, resolve(url) { return url; } },
  } });
  const update = (row) => publish({ data: { creations: [row], has_more: false } });
  update(item);
  const media = h.outlet.querySelector('.feed-card-image');
  const image = media.querySelector('img');
  assert.deepEqual(retainedUrls, [media.dataset.bgUrl]);
  assert.ok(image.getAttribute('src'));
  assert.ok(media.classList.contains('loading'));
  update({ ...item, title: 'Updated title' });
  assert.equal(h.outlet.querySelector('.feed-card-image'), media);
  assert.ok(media.classList.contains('loading'));
  image.dispatchEvent(new h.w.Event('load'));
  const loadedUrl = media.dataset.bgLoadedUrl;
  assert.ok(loadedUrl);
  update({ ...item, published: true });
  assert.equal(h.outlet.querySelector('.feed-card-img'), image);
  assert.equal(media.dataset.bgLoadedUrl, loadedUrl);
  assert.ok(media.classList.contains('loaded'), 'publication updates must keep the image visible');
  assert.ok(media.querySelector('.creation-published-badge'));
  update({ ...item, url: '/api/creations/media/two.png' });
  const replacement = h.outlet.querySelector('.feed-card-image');
  assert.notEqual(replacement, media);
  assert.ok(replacement.classList.contains('loading'));
  assert.equal(replacement.classList.contains('loaded'), false);
 } finally { dispose?.(); h.close(); }
});

test('Creations promotes offscreen thumbnails inside the scroll lookahead without replacing requests', { skip: !vm.SourceTextModule }, async () => {
 const h = await harness('/creations', async () => response({}));
 let dispose;
 try {
  const { renderCreationsView } = await h.load('views/Creations/CreationsView.js');
  let publish;
  dispose = renderCreationsView({ outlet: h.outlet, creationsQuery: {
   subscribe(callback) { publish = callback; return () => {}; }, async loadIfNeeded() {},
  } });
  publish({ data: { creations: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, url: `/api/creations/media/${i}.png` })), has_more: false } });
  const observer = h.observers.find(entry => entry.options.rootMargin === '2000px 0px');
  assert.ok(observer);
  assert.equal(observer.options.root, h.outlet.closest('.beta-outlet__scroll'));
  const media = [...h.outlet.querySelectorAll('.feed-card-image')];
  const image = media[16].querySelector('img'), src = image.getAttribute('src');
  assert.ok(src); assert.equal(image.loading, 'lazy');
  assert.ok(observer.targets.has(media[16]));
  observer.callback([{ target: media[16], isIntersecting: false }]);
  assert.equal(image.loading, 'lazy');
  observer.callback([{ target: media[16], isIntersecting: true }]);
  assert.equal(image.loading, 'eager'); assert.equal(image.getAttribute('src'), src);
  assert.equal(observer.targets.has(media[16]), false);
  assert.equal(media[17].querySelector('img').loading, 'lazy');
  dispose(); dispose = null;
  observer.callback([{ target: media[17], isIntersecting: true }]);
  assert.equal(media[17].querySelector('img').loading, 'lazy');
 } finally { dispose?.(); h.close(); }
});

test('creation media uses cached blobs, recovers decode failures, and ignores results after unmount', { skip: !vm.SourceTextModule }, async () => {
 const h = await harness('/creations', async () => response({}));
 let loader;
 try {
  const { createCreationMediaLoader, creationCardMarkup } = await h.load('shared/creationGrid.js');
  h.outlet.innerHTML = creationCardMarkup({ id: 1, url: '/api/creations/media/one.png' });
  let finish, invalidated;
  loader = createCreationMediaLoader(h.outlet, { thumbnails: {
   resolve: () => new Promise(resolve => { finish = resolve; }),
   invalidate: url => { invalidated = url; },
  } });
  loader.observe();
  const media = h.outlet.querySelector('.feed-card-image'), image = media.querySelector('img');
  assert.equal(image.hasAttribute('src'), false);
  finish('blob:cached'); await tick();
  assert.equal(image.getAttribute('src'), 'blob:cached');
  image.dispatchEvent(new h.w.Event('error'));
  assert.equal(invalidated, media.dataset.bgUrl);
  assert.equal(image.getAttribute('src'), media.dataset.bgUrl);
  image.dispatchEvent(new h.w.Event('load'));
  assert.ok(media.classList.contains('loaded'));
  assert.equal(media.dataset.bgLoadedUrl, media.dataset.bgUrl);
  h.outlet.innerHTML = creationCardMarkup({ id: 2, url: '/api/creations/media/two.png' });
  loader.observe(); const nextImage = h.outlet.querySelector('img');
  loader.disconnect(); finish('blob:late'); await tick();
  assert.equal(nextImage.hasAttribute('src'), false);
 } finally { loader?.disconnect(); h.close(); }
});

test('Feed marks empty and literal Untitled titles for thin italic styling', {skip:!vm.SourceTextModule}, async()=>{
 const titles=[null,'','  ','Untitled',' Untitled ','A real title'];
 const h=await harness('/feed',async url=>response(url.startsWith('/api/feed?')?{items:titles.map((title,index)=>({id:index+1,created_image_id:index+1,title,published:true,image_url:'/one.jpg',user_id:2})),hasMore:false}:{version:1,item:null}));
 try {
  const {FeedView}=await h.load('views/Feed/FeedView.js');const mounted=FeedView.mount(h);
  await tick();await tick();
  const labels=[...h.outlet.querySelectorAll('.feed-card-title')];assert.equal(labels.length,titles.length);
  labels.forEach((label,index)=>{assert.equal(label.classList.contains('feed-card-title--untitled'),index<5);assert.equal(label.textContent,index<5?'Untitled':'A real title')});
  mounted.destroy();
 } finally {h.close()}
});

test('mobile vertical video cards omit an Untitled title overlay', {skip:!vm.SourceTextModule}, async()=>{
 const h=await harness('/feed', async()=>response({}));
 try {
  const {createFeedSpotlightVideoTile}=await h.load('shared/feedCardBuild.js');
  const video={media_type:'video',video_url:'/v.mp4',image_url:'/one.jpg'};
  const untitled=createFeedSpotlightVideoTile({...video,id:1,created_image_id:1,title:'Untitled'},0);
  assert.equal(untitled.querySelector('.chat-feed-mobile-spotlight-overlay'),null);
  assert.equal(untitled.querySelector('a').getAttribute('aria-label'),'Open creation');
  const titled=createFeedSpotlightVideoTile({...video,id:2,created_image_id:2,title:'Night drive'},1);
  assert.equal(titled.querySelector('.chat-feed-mobile-spotlight-overlay-title').textContent,'Night drive');
 } finally {h.close()}
});

test('mobile Feed starts with four full creation-card skeletons and no inserted challenge placeholder', {skip:!vm.SourceTextModule}, async()=>{
 let release;
 const pending = new Promise(resolve => { release = resolve; });
 const h = await harness('/feed', () => pending, { mobile: true });
 let mounted;
 try {
  const { FeedView } = await h.load('views/Feed/FeedView.js');
  mounted = FeedView.mount(h);
  const cards = h.outlet.querySelectorAll('.skeleton-feed-card');
  assert.equal(cards.length, 4);
  assert.equal(h.outlet.querySelectorAll('.chat-feed-mobile-spotlight-cell--placeholder').length, 4);
  assert.equal(h.outlet.querySelector('.chat-feed-mobile-spotlight + .route-cards.feed-cards') !== null, true);
  assert.equal(h.outlet.querySelector('.feed-card--challenge-placeholder'), null);
 } finally { release?.(response({ items: [], hasMore: false })); mounted?.destroy(); h.close(); }
});

test('creation detail confirms temporary reveal on hero and group thumbnails without changing preferences', {skip:!vm.SourceTextModule}, async()=>{
 const h=await harness('/creations/42',async()=>response({}));
 try {
  const {bindNsfwClicks}=await h.load('shared/nsfwView.js');
  const lifetime=new h.w.AbortController();
  h.w.document.body.dataset.enableNsfw='1';
  h.outlet.innerHTML='<div class="creation-detail-image-wrapper nsfw"><img></div><div class="creation-detail-group-thumb-wrap nsfw"><button>Thumbnail</button></div>';
  const hero=h.outlet.querySelector('.creation-detail-image-wrapper'),thumb=h.outlet.querySelector('.creation-detail-group-thumb-wrap');
  let prompts=0,accepted=false,switches=0;
  h.w.confirm=message=>{assert.match(message,/temporarily reveal/);prompts++;return accepted};
  thumb.querySelector('button').addEventListener('click',()=>switches++);
  bindNsfwClicks(h.outlet,{signal:lifetime.signal});
  hero.querySelector('img').click();assert.equal(prompts,1);assert.equal(hero.classList.contains('nsfw-revealed'),false);
  accepted=true;thumb.querySelector('button').click();assert.equal(prompts,2);assert.equal(switches,0);
  assert.ok(hero.classList.contains('nsfw-revealed'));assert.ok(thumb.classList.contains('nsfw-revealed'));
  assert.equal(h.w.document.body.classList.contains('view-nsfw'),false);assert.equal(h.w.sessionStorage.getItem('viewNsfw'),null);
  thumb.querySelector('button').click();assert.equal(prompts,2);assert.equal(switches,1);
  hero.classList.remove('nsfw-revealed');lifetime.abort();hero.querySelector('img').click();assert.equal(prompts,2);
 } finally {h.close()}
});

test('blurred NSFW feed groups use one backend preview without loading carousel images', {skip:!vm.SourceTextModule}, async()=>{
 const h=await harness('/feed',async()=>response({}));
 try {
  const {createFeedItemCard,feedItemCardImageUrl}=await h.load('shared/feedCardBuild.js');
  const item={id:42,created_image_id:42,published:true,nsfw:true,image_url:'/api/images/created/cover.png',meta:{group:{kind:'group_creations',source_creations:[{id:1,file_path:'/api/images/created/one.png'},{id:2,file_path:'/api/images/created/two.png'}]}}};
  const card=createFeedItemCard(item,0,{nsfwIcon:true});
  assert.equal(card.querySelector('[data-feed-card-group-carousel]'),null);
  assert.equal(card.querySelector('.feed-card-group-nav'),null);
  assert.equal(card.querySelectorAll('.feed-card-image img').length,1);
  assert.ok(card.querySelector('.feed-card-image--nsfw-group > .creation-group-badge'));
  const preview=new URL(feedItemCardImageUrl(item),'http://localhost');
  assert.match(preview.pathname,/^\/api\/creations\/media\//);
  assert.equal(preview.searchParams.get('variant'),'blur');
  assert.equal(preview.searchParams.get('creation_id'),'42');
  card.__disposeFeedCard?.();
 } finally {h.close()}
});

test('Feed videos become visible and play muted only in view, pausing for overlays and hidden tabs', {skip:!vm.SourceTextModule}, async()=>{
 const h=await harness('/feed',async url=>response(url.startsWith('/api/feed?')?{items:[{id:42,created_image_id:42,title:'Video',media_type:'video',video_url:'/api/videos/created/video/clip.mp4?creation_id=42',image_url:'/cover.jpg'}],hasMore:false}:{version:1,item:null}));
 let stateChanged, plays=0, pauses=0, unsubscribed=false;
 h.services.state={subscribe(callback){stateChanged=callback;return()=>{unsubscribed=true}}};
 h.w.HTMLMediaElement.prototype.play=async function(){plays++};
 h.w.HTMLMediaElement.prototype.pause=function(){pauses++};
 try {
  const {FeedView}=await h.load('views/Feed/FeedView.js');const mounted=FeedView.mount(h);
  await tick();await tick();
  const video=h.outlet.querySelector('.feed-card-video');assert.ok(video);
  assert.equal(video.getAttribute('src'),null);assert.equal(video.muted,true);assert.equal(video.loop,true);assert.equal(video.playsInline,true);
  function intersect(ratio){for(const observer of h.observers)if(!observer.disconnected&&observer.targets.has(video))observer.callback([{target:video,isIntersecting:ratio>0,intersectionRatio:ratio}])}
  intersect(.25);assert.equal(plays,0);assert.equal(video.classList.contains('is-active'),false);
  intersect(.75);assert.equal(plays,1);assert.ok(video.classList.contains('is-active'));assert.match(video.src,/clip\.mp4/);
  stateChanged({navigation:{overlay:{}}});assert.equal(video.classList.contains('is-active'),false);assert.ok(pauses>0);
  intersect(.8);assert.equal(plays,1);
  video.muted=false;stateChanged({navigation:{overlay:null}});assert.equal(plays,2);assert.equal(video.muted,true);assert.ok(video.classList.contains('is-active'));
  Object.defineProperty(h.w.document,'hidden',{configurable:true,value:true});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
  assert.equal(video.classList.contains('is-active'),false);
  Object.defineProperty(h.w.document,'hidden',{configurable:true,value:false});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
  assert.equal(plays,3);assert.ok(video.classList.contains('is-active'));
  intersect(0);assert.equal(video.classList.contains('is-active'),false);
  mounted.destroy();intersect(.8);assert.equal(plays,3);assert.ok(unsubscribed);assert.ok(h.observers.every(observer=>observer.disconnected));
 } finally {h.close()}
});

test('Feed cursor paging retains existing cards and aborts on unmount', {skip:!vm.SourceTextModule}, async()=>{
 let page=0;const calls=[];const h=await harness('/feed',async(url,options)=>{calls.push({url,options});return response(url.startsWith('/api/feed?')?{items:[{id:++page,created_image_id:page,title:'Example',image_url:'/one.jpg',media_type:'image',user_id:2}],hasMore:true,feed_cursor:{after_image_created_at:'2026-10-01',after_image_id:5}}:url==='/api/feed/version'?{version:1}:{item:null});});
 try{const {FeedView}=await h.load('views/Feed/FeedView.js');const mounted=FeedView.mount(h);await tick();await tick();const first=h.outlet.querySelector('.feed-card');assert.ok(first,h.outlet.textContent);h.outlet.querySelector('.feed-view__more').click();await tick();await tick();assert.equal(h.outlet.querySelectorAll('.feed-card').length,2);assert.equal(h.outlet.querySelector('.feed-card'),first);const requests=calls.filter(c=>c.url.startsWith('/api/feed?'));assert.match(requests[1].url,/feed_after_image_id=5/);assert.equal(first.querySelector('[data-details-button]'),null);assert.equal(first.querySelector('[data-creator-button]'),null);assert.ok(first.querySelector('.feed-card-footer-grid > .feed-card-actions'));first.querySelector('.feed-card-image').click();assert.equal(h.navigations[0][0],'/creations/1');assert.equal(h.navigations[0][1].seed.created_image_id,1);mounted.destroy();assert.equal(requests[0].options.signal.aborted,true);assert.ok(h.observers.every(o=>o.disconnected));assert.equal(h.outlet.children.length,0);}finally{h.outlet.querySelector('.feed-view')?.remove();h.close();}
});
test('Feed retries the same cursor and ignores a late response after unmount', {skip:!vm.SourceTextModule}, async()=>{
 let page=0,finish;const calls=[];const h=await harness('/feed',async(url,options)=>{calls.push({url,options});if(!url.startsWith('/api/feed?'))return response({item:null,version:1});page++;if(page===2)return new Response(JSON.stringify({message:'Try again'}),{status:503});if(page===3)return new Promise(resolve=>{finish=()=>resolve(response({items:[{id:2,title:'Late',image_url:'/two.jpg'}],hasMore:false}));});return response({items:[{id:1,title:'First',image_url:'/one.jpg'}],hasMore:true,feed_cursor:{after_image_created_at:'2026-10-01',after_image_id:5}});});
 try{const {FeedView}=await h.load('views/Feed/FeedView.js');const mounted=FeedView.mount(h);await tick();await tick();h.outlet.querySelector('.feed-view__more').click();await tick();assert.match(h.outlet.querySelector('[role="status"]').textContent,/Try again/);assert.equal(h.outlet.querySelectorAll('.feed-card').length,1);h.outlet.querySelector('.feed-view__more').click();await tick();mounted.destroy();finish();await tick();assert.equal(h.outlet.children.length,0);assert.match(calls.filter(c=>c.url.startsWith('/api/feed?'))[2].url,/feed_after_image_id=5/);}finally{h.outlet.querySelector('.feed-view')?.remove();h.close();}
});

test('Doom Scroll opens a feed-cached video before the timeline request finishes', {skip:!vm.SourceTextModule}, async()=>{
 let finish;
 const item={id:42,created_image_id:42,media_type:'video',video_url:'/clip.mp4',image_url:'/one.jpg',title:'Clip'};
 const h=await harness('/feed/doom/42',()=>new Promise(resolve=>{finish=()=>resolve(response({items:[item],hasMore:false}));}));
 try {
  const {rememberFeedDoomVideo}=await h.load('shared/doomFeedVideoCache.js');
  rememberFeedDoomVideo(item);
  const {DoomScrollView}=await h.load('views/DoomScroll/DoomScrollView.js');
  const mounted=DoomScrollView.mount({...h,creationId:42,seed:item});
  const video=h.outlet.querySelector('video.chat-doom-video');
  assert.ok(video);
  assert.match(video.getAttribute('src')||video.src,/clip\.mp4/);
  assert.doesNotMatch(h.outlet.textContent,/Loading video/);
  mounted.destroy();
  finish();
  await mounted.backgroundReady;
  assert.equal(h.outlet.children.length,0);
 } finally {h.close()}
});

test('Doom Scroll fills likes and comments from the timeline and hides an Untitled caption', {skip:!vm.SourceTextModule}, async()=>{
 let finish;
 const seed={id:42,created_image_id:42,media_type:'video',video_url:'/clip.mp4',title:'Untitled',author_user_name:'ada',user_id:7,like_count:0,comment_count:0,viewer_liked:false};
 const api={...seed,title:'Untitled',like_count:4,viewer_liked:true,liked_by:['@ada'],comment_count:2,commented_by:['@bob'],author_plan:'founder'};
 const h=await harness('/feed/doom/42',async(url)=>String(url).includes('/api/feed/doom')?new Promise(resolve=>{finish=()=>resolve(response({items:[api],hasMore:false}));}):response({}));
 try {
  const {formatDoomCaption}=await h.load('views/DoomScroll/DoomSlideView.js');
  assert.equal(formatDoomCaption({title:'Untitled'}),'');
  assert.equal(formatDoomCaption({title:'  untitled  '}),'');
  assert.equal(formatDoomCaption({title:''}),'');
  assert.equal(formatDoomCaption({title:'Night drive'}),'Night drive');
  const {DoomScrollView}=await h.load('views/DoomScroll/DoomScrollView.js');
  const mounted=DoomScrollView.mount({...h,creationId:42,seed});
  await mounted.backgroundReady;
  assert.equal(h.outlet.querySelector('.chat-doom-caption'),null);
  finish();
  await tick(); await tick();
  const like=h.outlet.querySelector('button[data-like-button]');
  assert.equal(like.getAttribute('aria-pressed'),'true');
  assert.equal(like.querySelector('[data-like-count]').textContent,'4');
  assert.equal(like.getAttribute('data-tooltip'),'@ada');
  const comments=h.outlet.querySelector('a[data-chat-doom-comments]');
  assert.equal(comments.querySelector('.chat-doom-rail-count').textContent,'2');
  assert.equal(comments.getAttribute('data-tooltip'),'@bob');
  assert.ok(h.outlet.querySelector('.chat-doom-handle').classList.contains('founder-name'));
  assert.equal(h.outlet.querySelector('.chat-doom-caption'),null);
  const titled=formatDoomCaption({title:'Night drive'});
  assert.equal(titled,'Night drive');
  mounted.destroy();
 } finally {h.close()}
});

test('Doom Scroll buffers the next clips instead of leaving them on preload none', {skip:!vm.SourceTextModule}, async()=>{
 const items=[1,2,3].map(id=>({id,created_image_id:id,media_type:'video',video_url:`/clip-${id}.mp4`,title:`Clip ${id}`}));
 const h=await harness('/feed/doom/1',async(url)=>String(url).includes('/api/feed/doom')?response({items,hasMore:false}):response({}));
 try {
  const {warmDoomVideoElement}=await h.load('views/DoomScroll/doomScrollWarm.js');
  const stalled=h.w.document.createElement('video');
  let loads=0;
  stalled.load=()=>{loads+=1};
  stalled.preload='none';
  stalled.src='/clip.mp4';
  assert.equal(warmDoomVideoElement(stalled,'auto'),true);
  assert.equal(stalled.preload,'auto');
  assert.equal(loads,1);
  assert.equal(warmDoomVideoElement(stalled,'auto'),true);
  assert.equal(loads,1,'a second warm must not restart the fetch');
  const ready=h.w.document.createElement('video');
  let readyLoads=0;
  ready.load=()=>{readyLoads+=1};
  ready.src='/ready.mp4';
  Object.defineProperty(ready,'readyState',{value:2});
  warmDoomVideoElement(ready,'auto');
  assert.equal(readyLoads,0);
  const {DoomScrollView}=await h.load('views/DoomScroll/DoomScrollView.js');
  const mounted=DoomScrollView.mount({...h,creationId:1});
  await mounted.backgroundReady;
  const videos=[...h.outlet.querySelectorAll('video.chat-doom-video')];
  assert.equal(videos.length,3);
  assert.equal(videos[1].preload,'auto');
  assert.equal(videos[1].getAttribute('data-chat-doom-fetch'),'1');
  assert.equal(videos[2].preload,'auto');
  mounted.destroy();
 } finally {h.close()}
});

test('Doom Scroll dismissal during loading aborts the request and cannot install late media', {skip:!vm.SourceTextModule}, async()=>{
 let finish, options;
 const h=await harness('/feed/doom/42',async(_url,opts)=>{options=opts;return new Promise(resolve=>{finish=()=>resolve(response({items:[{id:42,created_image_id:42,media_type:'video',video_url:'/clip.mp4'}],hasMore:false}));});});
 try {
  const {DoomScrollView}=await h.load('views/DoomScroll/DoomScrollView.js');
  const mounted=DoomScrollView.mount({...h,creationId:42});
  assert.ok(h.outlet.querySelector('.chat-doom-pending-spinner'));
  assert.doesNotMatch(h.outlet.textContent, /Loading video/);
  mounted.destroy();assert.equal(options.signal.aborted,true);finish();await mounted.backgroundReady;
  assert.equal(h.outlet.children.length,0);assert.equal(h.w.document.querySelector('.chat-doom-slide'),null);assert.equal(h.w.document.body.classList.contains('chat-page--doom-scroll'),false);
 }finally{h.close();}
});


test('Feed renders saved likes and liker tooltips and updates both after unlike', {skip:!vm.SourceTextModule}, async()=>{
 const h=await harness('/feed',async(url,options)=>{
  if(url==='/api/created-images/42/like') {
   assert.equal(options.method,'DELETE');
   return response({like_count:1,viewer_liked:false,liked_by:['@other']});
  }
  return response(url.startsWith('/api/feed?')?{items:[{id:42,created_image_id:42,title:'Liked',image_url:'/one.jpg',media_type:'image',user_id:2,like_count:2,viewer_liked:true,liked_by:['@viewer','@other']}],hasMore:false}:{version:1,item:null});
 });
 try {
  const {FeedView}=await h.load('views/Feed/FeedView.js');const mounted=FeedView.mount(h);
  await tick();await tick();
  const button=h.outlet.querySelector('[data-like-id="42"]');
  assert.ok(button);assert.equal(button.getAttribute('aria-pressed'),'true');
  assert.equal(button.dataset.tooltip,'@viewer, @other');
  button.click();await tick();await tick();
  assert.equal(button.getAttribute('aria-pressed'),'false');
  assert.equal(button.dataset.tooltip,'@other');
  assert.equal(h.outlet.querySelector('[data-like-id="42"]'),button);
  mounted.destroy();
 }finally{h.close();}
});

test('Feed why menu opens an explanation dialog and releases it on close and unmount', {skip:!vm.SourceTextModule}, async()=>{
 const h=await harness('/feed',async url=>response(url.startsWith('/api/feed?')?{items:[{id:42,created_image_id:42,image_url:'/one.jpg',user_id:2,feed_beta_why:{label:'Recommended',summary:'You follow this creator.',details:['A recent creation from someone you follow.'],developer:{rank:3}}}],hasMore:false}:{version:1}));
 try {
  const {FeedView}=await h.load('views/Feed/FeedView.js');const mounted=FeedView.mount(h);
  await tick();await tick();
  const card=h.outlet.querySelector('.feed-card');
  function open(){card.querySelector('[data-more-button]').click();card.querySelector('[data-feed-beta-why]').click();return h.w.document.querySelector('dialog.feed-beta-why-modal');}
  let dialog=open();assert.ok(dialog.open);assert.match(dialog.textContent,/You follow this creator/);assert.match(dialog.textContent,/recent creation/);assert.match(dialog.textContent,/Developer details/);
  dialog.querySelector('.modal-dismiss').click();assert.equal(dialog.isConnected,false);
  dialog=open();dialog.close();dialog.dispatchEvent(new h.w.Event('close'));assert.equal(dialog.isConnected,false);
  dialog=open();mounted.destroy();assert.equal(dialog.isConnected,false);
 } finally {h.close()}
});
