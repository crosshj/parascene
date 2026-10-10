import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {JSDOM} from 'jsdom';
async function harness(url,fetcher){const dom=new JSDOM('<div class="beta-outlet__scroll"><div id="outlet"></div></div>',{url:'http://localhost'+url,pretendToBeVisual:true}),w=dom.window;w.HTMLElement.prototype.scrollTo=function(){};const observers=[];class Observer{constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this)}observe(){}unobserve(){}disconnect(){this.disconnected=true}}w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.HTMLMediaElement.prototype.play=async function(){};w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};const names=['document','Document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLButtonElement','HTMLAnchorElement','HTMLImageElement','HTMLTemplateElement','HTMLFormElement','HTMLMediaElement','HTMLAudioElement','HTMLVideoElement','Element','Node','Image','File','FormData','Event','CustomEvent','DOMException','AbortController','AbortSignal','customElements','localStorage','sessionStorage','navigator','location','MutationObserver'];const context=vm.createContext({...Object.fromEntries(names.map(n=>[n,w[n]])),window:w,innerWidth:w.innerWidth,innerHeight:w.innerHeight,matchMedia:w.matchMedia,console,structuredClone,URL,URLSearchParams,CSS:{escape:v=>v},getComputedStyle:w.getComputedStyle.bind(w),IntersectionObserver:Observer,ResizeObserver:Observer,requestAnimationFrame:w.requestAnimationFrame.bind(w),cancelAnimationFrame:w.cancelAnimationFrame.bind(w),setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,fetch:fetcher,alert(){},confirm:()=>true});const modules=new Map();function module(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);let code=fs.readFileSync(file,'utf8');if(file.endsWith('.css'))code='export default {}';if(file.endsWith('.html'))code='export default '+JSON.stringify(code);const mod=new vm.SourceTextModule(code,{identifier:file,context});modules.set(file,mod);return mod}async function load(file){const mod=module(path.resolve('client',file));if(mod.status==='unlinked')await mod.link((name,parent)=>module(path.resolve(path.dirname(parent.identifier),name)));if(mod.status!=='evaluated')await mod.evaluate();return mod.namespace}const navigations=[],actions={navigate:(...args)=>navigations.push(args),dismissOverlay(){}},services={session:{user:{id:1,role:'consumer',meta:{}},redirectToLogin(){throw Error('Unexpected auth redirect')},refresh:async()=>{}},providers:{document:{setTitle(){},get baseTitle(){return 'parascene'}}}};const searchComposer=(await load('components/SearchComposer/SearchComposer.js')).createSearchComposerElement();w.document.body.append(searchComposer);return {w,load,searchComposer,outlet:w.document.getElementById('outlet'),actions,services,navigations,observers,close:()=>dom.window.close()}}
const tick=()=>new Promise(resolve=>setImmediate(resolve)),response=data=>new Response(JSON.stringify(data),{headers:{"content-type":"application/json"}});
test('My Files puts Upload in the header, opens the paste-capable picker, and keeps Refresh in the menu',{skip:!vm.SourceTextModule},async()=>{const h=await harness('/files',async()=>response({files:[],pagination:{next_offset:null}}));let menu,headerActions,refreshes=0;const uploaded=[];const query={data:{files:[],pagination:{next_offset:null}},subscribe(fn){fn({status:'ready',data:this.data});return()=>{}},loadIfNeeded:async()=>{},refresh:async options=>{refreshes++;assert.deepEqual(options,{force:true})},setData(data){this.data=data}};try{const {renderFileManagerView}=await h.load('views/FileManager/FileManagerView.js');const cleanup=renderFileManagerView({...h,filesApi:{url:v=>v,list:async()=>({files:[],pagination:{next_offset:null}}),upload:async file=>{uploaded.push(file.name);return {file:{id:'pasted-image',display_name:file.name,content_type:file.type,size:file.size,public_url:'/pasted.png'}}}},filesQuery:query,onUnauthorized(){},setHeaderMenu:value=>{menu=value},setHeaderAccessories:value=>{headerActions=value}});assert.deepEqual(Array.from(headerActions,item=>item.label),['Upload']);assert.deepEqual(Array.from(menu.items,item=>item.label),['Refresh']);headerActions[0].onClick();const picker=h.w.document.querySelector('[data-image-picker-modal]');assert.ok(picker&&!picker.hidden);const input=picker.querySelector('.image-picker-composer-input');const pasted=new h.w.File(['pixels'],'pasted.png',{type:'image/png'});const event=new h.w.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{items:[{type:'image/png',getAsFile:()=>pasted}]}});input.dispatchEvent(event);await tick();assert.deepEqual(uploaded,['pasted.png']);assert.equal(h.w.document.querySelector('[data-image-picker-modal]'),null);menu.onSelect({action:'refresh'});await tick();assert.equal(refreshes,1);cleanup();assert.deepEqual(Array.from(headerActions),[]);assert.equal(menu,undefined)}finally{h.close()}});
test('Comments appends cursor pages and aborts on close',{skip:!vm.SourceTextModule},async()=>{const requests=[];const h=await harness('/comments',async(url,options)=>{requests.push({url,options});return response({comments:[{id:requests.length,text:'hello',created_image_id:5,created_image_title:'Example',created_at:'2026-10-01',commenter_user_name:'alice',creation:{id:5},reactions:{}}],has_more:requests.length===1,next_cursor:{before:'2026-10-01T00:00:00Z',before_id:1}})});try{const {CommentsView}=await h.load('views/Comments/CommentsView.js');const mounted=CommentsView.mount(h);assert.ok(h.outlet.querySelector('.skeleton-chat-thread'));assert.equal(h.outlet.querySelector('[role="status"]').hidden,true);await tick();assert.equal(h.outlet.querySelectorAll('[data-comment-id]').length,1);h.outlet.querySelector('.comments-view__more').click();await tick();assert.equal(h.outlet.querySelectorAll('[data-comment-id]').length,2);assert.match(requests[1].url,/before_id=1/);mounted.destroy();assert.equal(requests[1].options.signal.aborted,true);assert.ok(h.observers.every(o=>o.disconnected));assert.equal(h.outlet.children.length,0)}finally{h.close()}});
test('Explore paints keyword before semantic and opens seeded details',{skip:!vm.SourceTextModule},async()=>{let finishSemantic;const requests=[];const h=await harness('/explore?q=cat',async(url,options)=>{requests.push({url,options});if(url.includes('semantic'))return new Promise(resolve=>{finishSemantic=()=>resolve(response({items:[{id:2,title:'Semantic',url:'/two.jpg',published:true}]}))});return response({items:[{id:1,title:'Keyword',url:'/one.jpg',published:true}]})});try{const {ExploreView}=await h.load('views/Explore/ExploreView.js');const mounted=ExploreView.mount({...h,search:'?q=cat'});assert.equal(h.outlet.querySelector('form'),null);assert.equal(h.searchComposer.querySelector('input').value,'cat');assert.ok(h.outlet.querySelector('.skeleton-grid-tile'));assert.equal(h.outlet.querySelector('[role="status"]').hidden,true);await tick();assert.equal(h.outlet.querySelectorAll('.creation-grid__card[data-creation-id]').length,1);h.outlet.querySelector('.creation-grid__card[data-creation-id]').click();assert.equal(h.navigations[0][0],'/creations/1');assert.equal(h.navigations[0][1].seed.id,1);finishSemantic();await tick();assert.equal(h.outlet.querySelectorAll('.creation-grid__card[data-creation-id]').length,2);mounted.update({search:'?q=dog'});await tick();assert.match(requests.at(-1).url,/q=dog/);mounted.destroy();finishSemantic();await tick();assert.equal(h.outlet.children.length,0)}finally{h.close()}});
test('Library uses grids, lightbox actions and tab-specific outlet actions',{skip:!vm.SourceTextModule},async()=>{const requests=[];const h=await harness('/library',async(url,options)=>{requests.push({url,options});return response(url==='/api/styles/test'?{style:{tag:'test',title:'Test style',injection_text:'Illustration'}}:/\/api\/audio-clips\/\d+\/creations/.test(url)?{items:[]}:/\/api\/audio-clips\/\d+$/.test(url)?{clip:{id:5,title:'A clip',audio_url:'/clip.mp3'}}:url.includes('audio-clips')?{items:[{id:5,title:'A clip',audio_url:'/clip.mp3',can_edit:true,thumb_url:'/thumb.png'}],total:1}:{canAddStyle:true,items:[{tag:'test',tag_type:'style',title:'Test style',description:'Example',modifiers:'a'},{tag:'alice',tag_type:'persona',title:'Alice'}]})});try{await h.load('elements/tabs.js');let menu,headerActions=[];const {LibraryView}=await h.load('views/Library/LibraryView.js');const mounted=LibraryView.mount({...h,hash:'',setHeaderMenu:value=>{menu=value},setHeaderAccessories:value=>{headerActions=value||[]}});assert.ok(h.outlet.querySelector('.skeleton-grid-tile'));assert.equal(h.outlet.querySelector('.route-header'),null);await tick();await tick();assert.equal(headerActions.some(item=>item.label==='Add style'),false);h.outlet.querySelector('[data-grid="personas"] button').click();assert.equal(h.navigations.at(-1)[0],'/p/alice');assert.equal(h.w.document.querySelector('.chat-inline-image-lightbox'),null);mounted.update({hash:'#styles'});await tick();assert.equal(headerActions.some(item=>item.label==='Add style'),true);h.outlet.querySelector('[data-grid="styles"] button').click();await tick();assert.ok(h.w.document.querySelector('.library-style-modal').open);assert.equal(h.w.document.querySelector('.chat-inline-image-lightbox'),null);assert.match(h.w.document.querySelector('.library-style-modal').textContent,/Illustration/);assert.ok(h.w.document.querySelector('[data-copy-style-key]'));assert.doesNotMatch(h.w.document.querySelector('.library-style-modal').textContent,/See All Styles/);h.w.document.querySelector('.library-style-modal .modal-dismiss').click();mounted.update({hash:'#audio-clips'});await tick();assert.equal(headerActions.some(item=>item.label==='Record clip'),true);assert.equal(headerActions.some(item=>item.label==='Add style'),false);assert.ok(requests.some(r=>r.url.includes('/api/audio-clips')));h.outlet.querySelector('[data-grid="audio-clips"] button').click();await tick();assert.ok(h.w.document.querySelector('.library-audio-clip-modal').open);assert.equal(h.w.document.querySelector('.chat-inline-image-lightbox'),null);h.w.document.querySelector('[data-edit-audio-clip]').click();assert.equal(h.w.document.querySelector('[data-audio-clip-edit-title-input]').value,'A clip');assert.equal(menu.items.length,1);assert.equal(menu.items[0].action,'refresh');headerActions.find(item=>item.label==='Record clip').onClick();assert.ok(h.w.document.querySelector('[data-audio-clip-ingest-modal]').open);mounted.destroy();assert.equal(h.outlet.children.length,0);assert.ok(requests.every(r=>r.options.signal.aborted));assert.ok(h.observers.every(o=>o.disconnected))}finally{h.close()}});
test('Profile renders self tabs and routes creation clicks inside beta',{skip:!vm.SourceTextModule},async()=>{const h=await harness('/user',async(url)=>{if(url==='/api/profile')return response({id:1,role:'consumer',profile:{user_name:'alice'},plan:'free'});if(url.endsWith('/profile'))return response({user:{id:1,email:'alice@example.com',role:'consumer'},profile:{user_name:'alice',display_name:'Alice'},stats:{},is_self:true});if(url.includes('created-images'))return response({images:[{id:4,title:'My creation',url:'/four.jpg',published:true}],has_more:false});return response({images:[],comments:[],following:[],followers:[]})});try{await h.load('elements/tabs.js');const {UserProfileView}=await h.load('views/UserProfile/UserProfileView.js');const mounted=UserProfileView.mount({...h,url:'/user'});await mounted.backgroundReady;assert.match(h.outlet.textContent,/Alice/);assert.ok(h.outlet.querySelector('[data-profile-edit-overlay]'));const card=h.outlet.querySelector('.route-card-image');assert.ok(card);card.click();assert.equal(h.navigations.at(-1)[0],'/creations/4');const saved=mounted.getRestoreState();saved.tabData.creations.items.push({id:5,title:'Previously loaded',url:'/five.jpg',published:true});mounted.destroy();const returned=UserProfileView.mount({...h,url:'/user#creations',restoreState:saved});await returned.backgroundReady;assert.equal(h.outlet.querySelectorAll('.route-card-image').length,2);assert.equal(returned.getRestoreState().tabData.creations.items[1].id,5);returned.destroy();assert.ok(h.observers.every(o=>o.disconnected))}finally{h.close()}});
test('Connections renders credentials and registered app controls',{skip:!vm.SourceTextModule},async()=>{const requests=[];const h=await harness('/integrations',async(url,options)=>{requests.push({url,options});if(url==='/api/profile')return response({id:1,hasApiKey:false,hasVynlyToken:false});if(url.includes('integration/apps'))return response({apps:[]});if(url.includes('integration-grants'))return response({grants:[]});return response({configured:false,connected:false})});try{const {ConnectionsView}=await h.load('views/Connections/ConnectionsView.js');const mounted=ConnectionsView.mount(h);await mounted.backgroundReady;assert.match(h.outlet.textContent,/Generate/);h.outlet.querySelector('[data-open-register-dialog]').click();assert.ok(h.outlet.querySelector('[data-integrations-dialog]').open);mounted.destroy();assert.ok(requests.every(r=>r.options.signal.aborted))}finally{h.close()}});
test('My Files reuses cached data, previews images, and adjusts paging after upload/delete',{skip:!vm.SourceTextModule},async()=>{const h=await harness('/files',async()=>response({}));let subscriber,cacheLoads=0,listCalls=0,removed=[],uploaded=[];const file={id:'first',display_name:'One.png',content_type:'image/png',size:50,public_url:'http://localhost/one.png',created_at:'2026-10-01'};const query={data:{files:[file],pagination:{next_offset:1}},subscribe(fn){subscriber=fn;fn({status:'ready',data:this.data});return ()=>{subscriber=null}},loadIfNeeded:async()=>{cacheLoads++},setData(data){this.data=data;subscriber?.({status:'ready',data})}};const filesApi={url:v=>v,list:async({offset})=>{listCalls++;assert.equal(offset,1);return {files:[{...file,id:'older'}],pagination:{next_offset:null}}},remove:async id=>removed.push(id),upload:async f=>{uploaded.push(f.name);return {file:{...file,id:f.name,display_name:f.name}}}};try{let headerActions;const {renderFileManagerView}=await h.load('views/FileManager/FileManagerView.js');const cleanup=renderFileManagerView({...h,filesApi,filesQuery:query,onUnauthorized(){throw Error('Unexpected redirect')},setHeaderAccessories:value=>{headerActions=value}});assert.equal(cacheLoads,1);assert.equal(listCalls,0);assert.equal(h.outlet.querySelectorAll('[data-file-id]').length,1);h.outlet.querySelector('[data-file-id="first"]').click();assert.ok(!!h.w.document.querySelector('.chat-inline-image-lightbox'));assert.equal(h.outlet.querySelector('[data-file-id] [data-action]'),null);assert.match(h.w.document.querySelector('.chat-inline-image-lightbox').textContent,/One.png/);headerActions[0].onClick();const picker=h.w.document.querySelector('[data-image-picker-modal]');const pickerFileInput=picker.querySelector('input[type="file"]');Object.defineProperty(pickerFileInput,'files',{value:[new h.w.File(['a'],'a.png',{type:'image/png'}),new h.w.File(['b'],'b.png',{type:'image/png'})]});pickerFileInput.dispatchEvent(new h.w.Event('change'));await tick();await tick();assert.deepEqual(uploaded,['a.png','b.png']);assert.equal(query.data.pagination.next_offset,3);h.outlet.querySelector('[data-file-id="a.png"]').click();h.w.document.querySelector('.chat-inline-image-lightbox [data-action="delete"]').click();await tick();assert.deepEqual(removed,['a.png']);assert.equal(query.data.pagination.next_offset,2);cleanup();assert.equal(subscriber,null);assert.ok(h.observers.every(o=>o.disconnected));assert.equal(h.w.document.querySelector('.chat-inline-image-lightbox'),null)}finally{h.close()}});
test('User Menu routes profile and Connections and invokes owned settings/logout handlers',{skip:!vm.SourceTextModule},async()=>{const h=await harness('/explore',async()=>response({id:1,profile:{user_name:'alice'}}));try{await h.load('elements/modals/account-menu.js');const menu=h.w.document.createElement('app-account-menu');let settings=0,logout=0;menu.onNavigate=h.actions.navigate;menu.onSettings=()=>settings++;menu.onLogout=async()=>logout++;h.outlet.append(menu);menu.shadowRoot.querySelector('[data-action="view-profile"]').click();await tick();assert.equal(h.navigations.at(-1)[0],'/p/alice');menu.shadowRoot.querySelector('[data-action="integrations"]').click();assert.equal(h.navigations.at(-1)[0],'/integrations');menu.shadowRoot.querySelector('[data-action="settings"]').click();assert.equal(settings,1);menu.shadowRoot.querySelector('[data-action="logout"]').click();await tick();assert.equal(logout,1);menu.remove();assert.equal(h.w.document.querySelector('form[action="/logout"]'),null)}finally{h.close()}});
test('Style and Audio Clip details use native route URLs and abort their requests',{skip:!vm.SourceTextModule},async()=>{const requests=[];const h=await harness('/library',async(url,options)=>{requests.push({url,options});if(url.includes('/api/styles/'))return response({style:{tag:'test',title:'Test style',description:'A style',injection_text:'Illustration'}});return response(url.includes('/creations?')?{items:[]}:{clip:{id:5,title:'Test clip',audio_url:'/audio.mp3',owners:{},meta:{}}})});try{const {StyleDetailView}=await h.load('views/StyleDetail/StyleDetailView.js');const style=StyleDetailView.mount({...h,url:'/styles/test'});await style.backgroundReady;assert.match(h.outlet.textContent,/Test style/);style.destroy();assert.ok(requests[0].options.signal.aborted);const {AudioClipDetailView}=await h.load('views/AudioClipDetail/AudioClipDetailView.js');const clip=AudioClipDetailView.mount({...h,url:'/audio-clips/5'});await clip.backgroundReady;assert.match(h.outlet.textContent,/Test clip/);assert.ok(h.outlet.querySelector('audio'));clip.destroy();assert.ok(requests.every(r=>r.options.signal.aborted));assert.equal(h.outlet.children.length,0)}finally{h.close()}});
test('Explore large cards keep creator navigation native and dispose menus',{skip:!vm.SourceTextModule},async()=>{const h=await harness('/explore',async()=>response({items:[{id:7,created_image_id:7,user_id:2,user_name:'alice',title:'Large card',url:'/seven.jpg',published:true}],hasMore:false}));try{let menu;const {ExploreView}=await h.load('views/Explore/ExploreView.js');const mounted=ExploreView.mount({...h,setHeaderMenu:value=>{menu=value}});await tick();menu.onSelect({action:'toggle'});const card=h.outlet.querySelector('.feed-card');assert.ok(card);card.querySelector('[data-creator-button]').click();assert.equal(h.navigations.at(-1)[0],'/user/2');card.querySelector('[data-more-button]').click();mounted.destroy();await new Promise(resolve=>setTimeout(resolve,5));assert.equal(h.outlet.children.length,0);assert.ok(h.observers.every(o=>o.disconnected))}finally{h.close()}});
test('Help keeps article navigation native and cancels searches on teardown',{skip:!vm.SourceTextModule},async()=>{const requests=[];const h=await harness('/help',async(url,options)=>{requests.push({url,options});return response(url.includes('/search?')?{results:[{slug:'getting-started',title:'Getting started'}]}:{article:{title:'Help',html:'<p>Article body</p>'},navigation:[{section:'Guides',items:[{slug:'getting-started',title:'Getting started'}]}]})});try{const {HelpView}=await h.load('views/Help/HelpView.js');const mounted=HelpView.mount({...h,url:'/help'});await tick();assert.match(h.outlet.textContent,/Article body/);h.outlet.querySelector('input').value='start';h.outlet.querySelector('form').dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));await tick();h.outlet.querySelector('article a').click();assert.equal(h.navigations.at(-1)[0],'/help/getting-started');mounted.destroy();assert.ok(requests.every(r=>r.options.signal.aborted));assert.equal(h.outlet.children.length,0)}finally{h.close()}});
test('Library appends catalog and audio pages on scroll and releases observers',{skip:!vm.SourceTextModule},async()=>{const offsets=[];const h=await harness('/library',async url=>{if(url.includes('audio-clips')){const params=new URL(url,'http://localhost').searchParams;assert.equal(params.get('sort'),'created_at_asc');const offset=Number(params.get('offset'));offsets.push(offset);return response({items:Array.from({length:24},(_,i)=>({id:offset+i+1,title:'Clip '+(offset+i+1),audio_url:'/clip.mp3'})),total:48})}return response({items:Array.from({length:30},(_,i)=>({id:i+1,tag:'persona'+i,tag_type:'persona',title:'Persona '+i}))})});try{await h.load('elements/tabs.js');const {LibraryView}=await h.load('views/Library/LibraryView.js');const mounted=LibraryView.mount({...h,hash:''});await tick();assert.equal(h.outlet.querySelectorAll('[data-grid="personas"] button').length,24);const observer=h.observers[0];observer.callback([{isIntersecting:true}]);await tick();assert.equal(h.outlet.querySelectorAll('[data-grid="personas"] button').length,30);mounted.update({hash:'#audio-clips'});await tick();assert.equal(h.outlet.querySelectorAll('[data-grid="audio-clips"] button').length,24);observer.callback([{isIntersecting:true}]);await tick();assert.deepEqual(offsets,[0,24]);assert.equal(h.outlet.querySelectorAll('[data-grid="audio-clips"] button').length,48);assert.equal(h.outlet.querySelector('.library-view__more').hidden,true);mounted.destroy();assert.ok(observer.disconnected)}finally{h.close()}});
test('My Files replaces grid skeletons with square tiles and releases preview media',{skip:!vm.SourceTextModule},async()=>{const h=await harness('/files',async()=>response({}));let finish;try{const {renderFileManagerView}=await h.load('views/FileManager/FileManagerView.js');const cleanup=renderFileManagerView({...h,filesApi:{url:v=>v,list:()=>new Promise(resolve=>{finish=resolve})},onUnauthorized(){}});assert.equal(h.outlet.querySelectorAll('.skeleton-grid-tile').length,25);assert.equal(h.outlet.querySelector('[data-ref="status"]').hidden,true);finish({files:[{id:'clip',content_type:'audio/mpeg',display_name:'Clip.mp3',public_url:'/clip.mp3'}],pagination:{next_offset:null}});await tick();assert.equal(h.outlet.querySelectorAll('.skeleton-grid-tile').length,0);h.outlet.querySelector('[data-file-id]').click();const media=h.w.document.querySelector('.chat-inline-image-lightbox audio');assert.ok(media);assert.ok(h.w.document.querySelector('.chat-inline-image-lightbox [data-action="open"]'));h.w.document.querySelector('.chat-inline-image-lightbox-close').click();assert.equal(media.getAttribute('src'),null);cleanup()}finally{h.close()}});
test('Unknown file types keep the generic graphic and files reuse creation badges',{skip:!vm.SourceTextModule},async()=>{const h=await harness('/files',async()=>response({}));try{const {renderFileManagerView}=await h.load('views/FileManager/FileManagerView.js');const cleanup=renderFileManagerView({...h,filesApi:{url:v=>v,list:async()=>({files:[{id:'unknown',content_type:'application/octet-stream',public_url:'/s/1/unknown.bin',display_name:'Unknown.bin'},{id:'audio',content_type:'audio/mpeg',public_url:'/audio.mp3'},{id:'video',content_type:'video/mp4',public_url:'/video.mp4'}],pagination:{next_offset:null}})},onUnauthorized(){}});await tick();const unknown=h.outlet.querySelector('[data-file-id="unknown"]');assert.ok(unknown.querySelector('.file-icon'));assert.equal(unknown.querySelector('img,.creation-music-badge,.creation-video-badge'),null);assert.ok(h.outlet.querySelector('[data-file-id="audio"] .creation-music-badge svg'));assert.ok(h.outlet.querySelector('[data-file-id="video"] .creation-video-badge svg'));unknown.click();const box=h.w.document.querySelector('.chat-inline-image-lightbox');assert.ok(box.querySelector('.chat-inline-image-lightbox-file-card .chat-inline-image-lightbox-file'));box.querySelector('.chat-inline-image-lightbox-file-card').click();assert.ok(box.isConnected);assert.equal(box.querySelector('audio,.chat-inline-image-lightbox-audio-slot'),null);assert.equal(box.querySelector('.chat-inline-image-lightbox-title').textContent,'Unknown.bin');const footer=box.querySelector('.chat-inline-image-lightbox-footer');assert.ok(footer.firstElementChild.matches('.chat-inline-image-lightbox-explainer'));assert.match(footer.firstElementChild.textContent,/application\/octet-stream/);assert.ok(footer.querySelector('[data-action="delete"]'));cleanup();assert.equal(h.w.document.querySelector('.chat-inline-image-lightbox'),null)}finally{h.close()}});
test('A view-owned lightbox handle cannot close a newer chat preview',{skip:!vm.SourceTextModule},async()=>{const h=await harness('/files',async()=>response({}));try{const api=await h.load('shared/chatInlineImageLightbox.js');const owner=api.createChatMediaLightbox();owner.open({title:'Owned preview',url:'/one.png',actions:[{label:'Example',run:()=>{}}]});api.openChatInlineImageLightbox('/chat.png');const chat=h.w.document.querySelector('.chat-inline-image-lightbox');assert.ok(chat);assert.equal(chat.querySelector('.chat-inline-image-lightbox-title'),null);owner.destroy();assert.equal(h.w.document.querySelector('.chat-inline-image-lightbox'),chat);api.closeChatInlineImageLightbox();assert.equal(h.w.document.querySelector('.chat-inline-image-lightbox'),null)}finally{h.close()}});
test('Layout mounts Explore search in its composer slot and Library actions in its header',{skip:!vm.SourceTextModule},async()=>{const h=await harness('/explore',async url=>response(url==='/api/styles/new'?{canCreate:true}:url.includes('explore')?{items:[],hasMore:false}:{canAddStyle:true,items:[]}));let layout;try{const root=h.w.document.createElement('main');root.innerHTML='<div data-layout-region="sidebar"></div><div data-layout-region="page"></div><div data-layout-region="mobile-navigation"></div>';h.w.document.body.append(root);const {ExploreView}=await h.load('views/Explore/ExploreView.js');await h.load('elements/tabs.js');const {LibraryView}=await h.load('views/Library/LibraryView.js');const {createLayout}=await h.load('core/layout.js');const inert={mount:()=>({destroy(){}})};layout=createLayout({root,views:{Sidebar:inert,MobileNavigation:inert,MobileHeader:inert},services:h.services});await layout.apply({shell:'app',url:'/explore',backgroundUrl:'/explore',outlet:{key:'explore',view:ExploreView,props:{search:'?q=cat'},chrome:{title:'Explore',composer:'search'}},overlay:null},h.actions);await tick();const search=root.querySelector('.beta-outlet__search-composer');assert.equal(search.hidden,false);assert.ok(search.parentElement.matches('.beta-outlet__frame'));assert.equal(root.querySelector('.beta-outlet__content form'),null);search.querySelector('input').value='dogs';search.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(h.navigations.at(-1)[0],'/explore?q=dogs');await layout.apply({shell:'app',url:'/library#styles',backgroundUrl:'/library#styles',outlet:{key:'library',view:LibraryView,props:{hash:'#styles'},chrome:{title:'Library',composer:'none'}},overlay:null},h.actions);await tick();assert.equal(search.hidden,true);const button=root.querySelector('.beta-outlet__header .beta-outlet__pin');assert.ok(button);assert.equal(button.textContent,'Add style');const navigationCount=h.navigations.length;button.click();await tick();assert.equal(h.navigations.length,navigationCount);assert.ok(h.w.document.querySelector('.library-style-modal.app-dialog').open);assert.ok(h.w.document.querySelector('[data-style-new-form]'));assert.equal(root.querySelector('.beta-app-overlay-host').hidden,true);layout.destroy();layout=null;assert.ok(h.observers.every(o=>o.disconnected))}finally{layout?.destroy();h.close()}});

test('Explore suppresses shared badges in both modes and after publication updates',{skip:!vm.SourceTextModule},async()=>{const h=await harness('/explore',async()=>response({items:[{id:7,created_image_id:7,title:'Shared',url:'/seven.jpg',published:true,editorial_pin_show_metadata:false}],hasMore:false}));try{let menu;const {ExploreView}=await h.load('views/Explore/ExploreView.js');const {patchCreationCardPublishedInDocument}=await h.load('shared/creationDetailEmbedShell.js');const mounted=ExploreView.mount({...h,setHeaderMenu:value=>{menu=value}});await tick();for(let mode=0;mode<2;mode++){const card=h.outlet.querySelector('.feed-card');assert.ok(card);assert.equal(card.dataset.published,'1');assert.equal(card.querySelector('.creation-published-badge'),null);patchCreationCardPublishedInDocument(7,true,h.outlet);assert.equal(card.querySelector('.creation-published-badge'),null);if(mode===0)menu.onSelect({action:'toggle'});}const {creationCardMarkup}=await h.load('shared/creationGrid.js');assert.match(creationCardMarkup({id:8,published:true}),/class="creation-published-badge"/);mounted.destroy();}finally{h.close()}});

test('Direct audio clip links open a single modal, autoplay and stop on dismiss',{skip:!vm.SourceTextModule},async()=>{const h=await harness('/audio-clips/5',async url=>response(url.includes('/creations')?{items:[]}:url==='/api/audio-clips/5'?{clip:{id:5,title:'A clip',audio_url:'/clip.mp3'}}:{items:[],total:0}));try{let plays=0,pauses=0;h.w.HTMLMediaElement.prototype.play=async function(){plays++};h.w.HTMLMediaElement.prototype.pause=function(){pauses++};await h.load('elements/tabs.js');const {LibraryView}=await h.load('views/Library/LibraryView.js');const mounted=LibraryView.mount({...h,url:'/audio-clips/5'});await tick();const dialog=h.w.document.querySelector('.library-audio-clip-modal');assert.ok(dialog.open);assert.equal(h.w.document.querySelector('.chat-inline-image-lightbox'),null);assert.equal(plays,1);const player=dialog.querySelector('audio');assert.equal(player.getAttribute('src'),'/clip.mp3');dialog.querySelector('.modal-dismiss').click();assert.equal(pauses,1);assert.equal(player.getAttribute('src'),null);assert.equal(h.navigations.at(-1)[0],'/library#audio-clips');mounted.destroy();}finally{h.close()}});

test('Persona profile keeps WWW action layout and hides edit UI until opened', {skip: !vm.SourceTextModule}, async () => {
 const h = await harness('/p/storyteller', async url => {
  if (url.includes('/by-username/')) return new Response("{}", {status: 404});
  if (url.includes('/personalities/')) return response({images: [{id: 9, title: 'Story', url: '/story.jpg', published: true}], has_more: false});
  if (url.includes('/personas/in-library')) return response({in_library: true, persona: {id: 3, title: 'Storyteller', description: 'About this persona', character_description: 'A storyteller', avatar_url: '/avatar.jpg'}});
  if (url === '/api/profile') return response({id: 1, role: 'admin'});
  return response({});
 });
 try {
  const style = h.w.document.createElement('style');
  style.textContent = fs.readFileSync('client/views/UserProfile/UserProfileView.css', 'utf8');
  h.w.document.head.append(style);
  const {UserProfileView} = await h.load('views/UserProfile/UserProfileView.js');
  const mounted = UserProfileView.mount({...h, url: '/p/storyteller'});
  await mounted.backgroundReady;
  const root = h.outlet.querySelector('.user-profile-view');
  assert.match(root.textContent, /Storyteller/);
  assert.ok(root.querySelector('.user-profile-hero-inner > .user-profile-avatar'));
  assert.ok(root.querySelector('.user-profile-identity .user-profile-persona-details'));
  assert.equal(h.w.getComputedStyle(root.querySelector('.personality-discovery-actions')).display, 'flex');
  const overlay = root.querySelector('[data-persona-library-edit-overlay]');
  assert.equal(h.w.getComputedStyle(overlay).visibility, 'hidden');
  root.querySelector('[data-persona-library-edit-open]').click();
  assert.equal(h.w.getComputedStyle(overlay).visibility, 'visible');
  root.querySelector('[data-persona-library-edit-cancel]').click();
  assert.equal(h.w.getComputedStyle(overlay).visibility, 'hidden');
  root.querySelector('[data-personality-grid] .route-card-image').click();
  assert.equal(h.navigations.at(-1)[0], '/creations/9');
  mounted.destroy();
  assert.equal(h.outlet.children.length, 0);
 } finally { h.close(); }
});


test('single overlay replacement restores profile data and scroll after Escape', {skip:!vm.SourceTextModule}, async()=>{
 const h=await harness('/p/alice',async()=>response({}));let layout;
 try {
  const root=h.w.document.createElement('main');root.innerHTML='<div data-layout-region="sidebar"></div><div data-layout-region="page"></div><div data-layout-region="mobile-navigation"></div>';h.w.document.body.append(root);
  const {createLayout}=await h.load('core/layout.js');const inert={mount:()=>({destroy(){}})};
  let mounts=0,destroys=0,restored;
  const profile={mount({outlet,restoreState}){mounts++;restored=restoreState;outlet.textContent='Profile';return {backgroundReady:Promise.resolve(),getRestoreState:()=>({tabData:{likes:{items:[{id:42}],hasMore:true}},loadedTabs:['likes']}),destroy(){destroys++}}}};
  layout=createLayout({root,views:{Sidebar:inert,MobileNavigation:inert,MobileHeader:inert},services:h.services});
  const base={shell:'app',backgroundUrl:'/explore',outlet:{key:'explore',view:inert,props:{},chrome:{composer:'none'}}};
  const profileComposition={...base,url:'/p/alice#likes',overlay:{key:'profile',view:profile,props:{},title:'Profile'}};
  const actions={...h.actions,dismissOverlay:()=>layout.apply(profileComposition,actions)};
  await layout.apply(profileComposition,actions);await tick();
  const content=root.querySelector('[data-overlay-content]');content.scrollTop=640;
  await layout.apply({...base,url:'/creations/42',overlay:{key:'detail',view:inert,props:{},title:'Creation'}},actions);
  assert.equal(destroys,1);assert.equal(root.querySelectorAll('.beta-app-overlay-host').length,1);
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await tick();await tick();
  assert.equal(mounts,2);assert.equal(restored.tabData.likes.items[0].id,42);assert.equal(content.scrollTop,640);
 }finally{layout?.destroy();h.close()}
});

test('mobile contextual headers use one right-side chevron for chat switching and page actions', {skip:!vm.SourceTextModule}, async()=>{
 const h=await harness('/dm/alice',async()=>response({}));let layout;let selected;
 try {
  h.w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
  const root=h.w.document.createElement('main');root.innerHTML='<div data-layout-region="sidebar"></div><div data-layout-region="page"></div><div data-layout-region="mobile-navigation"></div>';h.w.document.body.append(root);
  const {createLayout}=await h.load('core/layout.js');
  let sidebar;const view={mount({outlet,setHeaderSwitcher,setHeaderMenu,rightSidebar}){sidebar=rightSidebar;outlet.textContent='DM';setHeaderSwitcher({channel:'Alice',items:[{id:null,label:'Alice',current:true}],onSelect:id=>{selected=id;}});setHeaderMenu({items:[{id:'refresh',label:'Refresh'}]});return {destroy(){}}}};
  layout=createLayout({root,views:{Sidebar:view,MobileNavigation:view,MobileHeader:view},services:h.services});
  await layout.apply({shell:'app',url:'/dm/alice',backgroundUrl:'/dm/alice',outlet:{key:'dm',view,props:{},chrome:{title:'Alice',composer:'message'}},overlay:null},h.actions);await tick();
  const caret=root.querySelector('.beta-outlet__mobile-menu');const more=root.querySelector('.beta-outlet__more');
  assert.equal(caret.hidden,false);assert.ok(more.hidden);caret.click();
  const items=root.querySelectorAll('.beta-outlet__mobile-menu-item');assert.equal(items.length,2);items[0].click();assert.equal(selected,null);
  assert.equal(root.querySelector('.beta-outlet__mobile-menu-sheet').hidden,true);
  sidebar.open({key:'canvas',title:'General',mount({outlet}){outlet.textContent='Canvas content';}});
  const sidebarCaret=root.querySelector('.beta-right-sidebar__menu');assert.equal(sidebarCaret.hidden,false);sidebarCaret.click();
  assert.equal(root.querySelector('.beta-outlet__mobile-menu-sheet').hidden,false);
 }finally{layout?.destroy();h.close()}
});

test('mobile page action headers use a chevron and keep the desktop dots hidden', {skip:!vm.SourceTextModule}, async()=>{
 const h=await harness('/comments',async()=>response({}));let layout;let selected;
 try {
  h.w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
  const root=h.w.document.createElement('main');root.innerHTML='<div data-layout-region="sidebar"></div><div data-layout-region="page"></div><div data-layout-region="mobile-navigation"></div>';h.w.document.body.append(root);
  const {createLayout}=await h.load('core/layout.js');
  const view={mount({outlet,setHeaderMenu}){outlet.textContent='Comments';setHeaderMenu({label:'Comments',items:[{label:'Refresh',action:'refresh'}],onSelect:item=>{selected=item.action;}});return {destroy(){}}}};
  layout=createLayout({root,views:{Sidebar:view,MobileNavigation:view,MobileHeader:view},services:h.services});
  await layout.apply({shell:'app',url:'/comments',backgroundUrl:'/comments',outlet:{key:'comments',view,props:{},chrome:{title:'Comments'}},overlay:null},h.actions);await tick();
  const caret=root.querySelector('.beta-outlet__mobile-menu');assert.equal(caret.hidden,false);assert.equal(root.querySelector('.beta-outlet__more').hidden,true);
  caret.click();root.querySelector('.beta-outlet__mobile-menu-item').click();assert.equal(selected,'refresh');
 }finally{layout?.destroy();h.close()}
});

test('Profile returns from cache before refresh completes and updates without replacing tabs', {skip:!vm.SourceTextModule}, async()=>{
 let hold=false, release, requests=0;
 const h=await harness('/user',async url=>{
  if(url==='/api/profile') return response({id:1,role:'consumer'});
  if(url.endsWith('/profile')) {
   requests++;
   if(hold) await new Promise(resolve=>{release=resolve});
   return response({user:{id:1},profile:{user_name:'alice',display_name:hold?'Updated Alice':'Alice'},stats:{},is_self:true});
  }
  return response({images:[{id:4,url:'/four.jpg'}],has_more:false});
 });
 try {
  await h.load('elements/tabs.js');
  const {createProfileProvider}=await h.load('providers/profile/index.js');
  h.services.providers.profile=createProfileProvider();
  const {UserProfileView}=await h.load('views/UserProfile/UserProfileView.js');
  const first=UserProfileView.mount({...h,url:'/user'});
  await first.backgroundReady;
  const saved=first.getRestoreState();first.destroy();hold=true;
  const returned=UserProfileView.mount({...h,url:'/user#creations',restoreState:saved});
  await returned.backgroundReady;
  assert.match(h.outlet.textContent,/Alice/);
  assert.equal(requests,2);
  const tabs=h.outlet.querySelector('app-tabs');
  assert.ok(release);release();await tick();await tick();
  assert.match(h.outlet.textContent,/Updated Alice/);
  assert.equal(h.outlet.querySelector('app-tabs'),tabs);
  returned.destroy();h.services.providers.profile.destroy();
 } finally {release?.();h.close()}
});

test('My Files uploads use creation placeholder cards', { skip: !vm.SourceTextModule }, async () => {
	const h = await harness('/files', async () => response({}));
	const pending = [];
	const file = { id: 'first', display_name: 'One.png', content_type: 'image/png', size: 50, public_url: '/one.png', created_at: '2026-10-01' };
	let subscriber;
	const query = {
		data: { files: [file], pagination: { next_offset: 1 } },
		subscribe(fn) { subscriber = fn; fn({ status: 'ready', data: this.data }); return () => { subscriber = null; }; },
		loadIfNeeded: async () => {},
		setData(data) { this.data = data; subscriber?.({ status: 'ready', data }); },
	};
	const filesApi = {
		url: (value) => value,
		upload(item) {
			return new Promise((resolve, reject) => pending.push({ name: item.name, resolve, reject }));
		},
	};
	let cleanup;
	try {
		const { renderFileManagerView } = await h.load('views/FileManager/FileManagerView.js');
		let headerActions;
		cleanup = renderFileManagerView({ ...h, filesApi, filesQuery: query, onUnauthorized() {}, setHeaderAccessories: (value) => { headerActions = value; } });
		headerActions[0].onClick();
		const picker = h.w.document.querySelector('[data-image-picker-modal]');
		const input = picker.querySelector('input[type="file"]');
		Object.defineProperty(input, 'files', { value: [new h.w.File(['a'], 'a.png', { type: 'image/png' }), new h.w.File(['b'], 'b.png', { type: 'image/png' })] });
		input.dispatchEvent(new h.w.Event('change'));
		await tick();
		const uploads = [...h.outlet.querySelectorAll('[data-upload-id]')];
		assert.equal(uploads.length, 2);
		assert.equal(h.outlet.querySelector('.file-manager-view__upload-dialog'), null);
		assert.match(uploads[0].textContent, /UPLOADING…/);
		assert.doesNotMatch(uploads[0].textContent, /GENERATING/);
		assert.ok(uploads[0].querySelector('.icon-gears'));
		assert.match(uploads[1].textContent, /QUEUED/);
		assert.equal(uploads[1].querySelector('.creation-grid__status-place')?.textContent, '1');
		uploads[0].click();
		uploads[1].click();
		assert.equal(h.w.document.querySelector('.chat-inline-image-lightbox'), null);
		assert.equal(pending.length, 1);
		pending[0].resolve({ file: { ...file, id: 'a.png', display_name: 'a.png' } });
		await tick();
		assert.ok(h.outlet.querySelector('[data-file-id="a.png"]'));
		const waiting = h.outlet.querySelector('[data-upload-id]');
		assert.match(waiting.textContent, /UPLOADING…/);
		pending[1].reject(Object.assign(new Error('Upload rejected'), { status: 500 }));
		await tick();
		const failed = h.outlet.querySelector('[data-upload-id]');
		assert.match(failed.textContent, /FAILED/);
		assert.equal(failed.querySelector('[data-upload-retry]'), null);
		failed.click();
		const popup = h.w.document.querySelector('.app-dialog');
		assert.ok(popup?.open);
		assert.match(popup.textContent, /Upload rejected/);
		assert.match(popup.textContent, /b\.png/);
		popup.querySelector('.modal-dismiss').click();
		assert.equal(h.w.document.querySelector('.app-dialog'), null);
		assert.equal(failed.isConnected, true);
		failed.click();
		h.w.document.querySelector('.app-dialog [data-upload-retry]').click();
		await tick();
		const retried = h.outlet.querySelector('[data-upload-id]');
		assert.match(retried.textContent, /UPLOADING…/);
		assert.equal(h.w.document.querySelector('.app-dialog'), null);
		pending.at(-1).reject(Object.assign(new Error('Upload rejected'), { status: 500 }));
		await tick();
		h.outlet.querySelector('[data-upload-id]').click();
		h.w.document.querySelector('.app-dialog [data-upload-dismiss]').click();
		assert.equal(h.outlet.querySelector('[data-upload-id]'), null);
		assert.equal(h.w.document.querySelector('.app-dialog'), null);
		h.outlet.querySelector('[data-file-id="a.png"]').click();
		assert.ok(h.w.document.querySelector('.chat-inline-image-lightbox'));
	} finally { cleanup?.(); h.close(); }
});
