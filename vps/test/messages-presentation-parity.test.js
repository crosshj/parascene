import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import * as acorn from 'acorn';
import postcss from 'postcss';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Dev-only verification reads the active WWW builders as its reference.
// Run with npm run verify:messages in the full repository checkout.
const sourcePath = path.join(repoRoot, 'src/chat/chatPage.js');
test('message body formatter matches active WWW implementation', { skip: !fs.existsSync(sourcePath) }, () => {
 const implementation = file => fs.readFileSync(path.join(repoRoot, file), 'utf8').replace(/^import .*;\r?\n/gm, '');
 assert.equal(implementation('vps/client/shared/userText.js'), implementation('src/shared/userText.js'));
});
test('shared messages preserve active WWW DOM', { skip: !vm.SourceTextModule || !fs.existsSync(sourcePath) }, async () => {
const dom=new JSDOM('<!doctype html><html><body class="beta-layout"><div class="beta-outlet__scroll"><div class="beta-outlet__content"></div></div></body></html>',{url:'https://example.com',pretendToBeVisual:true});
const w=dom.window;class Observer{observe(){}disconnect(){}};
w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.ResizeObserver=Observer;w.IntersectionObserver=Observer;
w.HTMLElement.prototype.scrollTo=function({top}){this.scrollTop=top;};w.HTMLElement.prototype.scrollIntoView=function(){};
w.fetch=async()=>({ok:true,json:async()=>({})});
const context=vm.createContext({console,...Object.fromEntries(['document','navigator','location','HTMLElement','Element','Node','Document','HTMLAnchorElement','HTMLBRElement','HTMLButtonElement','HTMLMediaElement','HTMLImageElement','HTMLVideoElement','HTMLAudioElement','HTMLInputElement','HTMLTextAreaElement','MutationObserver','AbortController','URL','URLSearchParams','CustomEvent','Event','Image','localStorage','sessionStorage'].map(k=>[k,w[k]])),window:w,matchMedia:w.matchMedia,ResizeObserver:Observer,IntersectionObserver:Observer,fetch:w.fetch,requestAnimationFrame:w.requestAnimationFrame.bind(w),cancelAnimationFrame:w.cancelAnimationFrame.bind(w),setTimeout,clearTimeout,crypto:webcrypto,confirm:()=>false});
const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);let code=fs.readFileSync(file,'utf8');if(file.endsWith('.css'))code='export default {};';if(file.endsWith('.html'))code='export default '+JSON.stringify(code)+';';const m=new vm.SourceTextModule(code,{context,identifier:file});cache.set(file,m);return m;}
try {
 const base=path.join(repoRoot,'vps/client/components/Messages');
 const port=await load(base+'/MessageRow.js');await port.link((specifier,ref)=>load(path.resolve(path.dirname(ref.identifier),specifier)));await port.evaluate();
 const source=fs.readFileSync(sourcePath,'utf8');const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});const functions=new Map();
 function walk(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration'&&n.id)functions.set(n.id.name,source.slice(n.start,n.end));for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}}walk(ast);
 const names=Object.keys(port.namespace).filter(k=>functions.has(k));
 const importHeader=fs.readFileSync(base+'/MessageRow.js','utf8').split('const CHAT_MESSAGE_GROUP_GAP_MS')[0];
 let referenceCode=importHeader+'const CHAT_MESSAGE_GROUP_GAP_MS=7*60*1000; const CHAT_HOVER_QUICK_REACTION_KEYS=REACTION_ORDER.slice(0,3); const activePseudoChannelSlug=""; const activeThreadPinnedMessageId=null; const chatViewerId=1;\n';
 referenceCode+='function escapeHtml(value){return String(value??"").replace(/[&<>"\']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;","\'":"&#039;"})[char]);}\n';
 referenceCode+=names.map(n=>'export '+functions.get(n)).join('\n');
 const reference=new vm.SourceTextModule(referenceCode,{context,identifier:base+'/WWW-reference.js'});await reference.link((specifier,ref)=>load(path.resolve(path.dirname(ref.identifier),specifier)));await reference.evaluate();
 const stamp={referenced_id:1,sender_id:2,sender_user_name:'person',preview_text:'Quoted message'};
 const basic={id:10,sender_id:1,sender_user_name:'harrison',sender_avatar_url:'',created_at:'2026-10-02T12:00:00Z',body:'Hello',meta:{},reactions:{},viewer_reactions:[]};
 const fixtures=[['own',{}],['other',{sender_id:2,sender_user_name:'person'}],['founder',{sender_plan:'founder',sender_avatar_url:'https://example.com/avatar.png'}],['edited',{meta:{edited_at:'2026-10-02T12:01:00Z'}}],['reply',{meta:{reply:stamp},reply_parent_exists:true}],['deleted-parent',{meta:{reply:stamp},reply_parent_exists:false}],['reactions',{reactions:{heart:['@person',3],thumbsUp:['@harrison']},viewer_reactions:['thumbsUp']}],['markdown',{body:'# Heading\n- one\n- [x] task\n> quote\n```js\nconst a=1;\n```'}],['inline-image',{body:'https://example.com/api/generic-images/profile/1/misc_a.png\ncaption'}],['system',{meta:{system_event:{kind:'channel_invite_sent'}},body:'@harrison invited @person to the channel'}],['legacy-system',{body:'@harrison invited @person to the channel'}],['canvas',{meta:{canvas:{title:'Document'}},body:'Some text'}],['invite',{meta:{time_sensitive:{kind:'channel_invite',expires_at:'2099-01-01',cta:{label:'Accept',invite_token:'test'}}}}],['expired-invite',{meta:{time_sensitive:{kind:'channel_invite',expires_at:'2000-01-01',cta:{label:'Accept',invite_token:'test'}}}}]];
 // Attribute insertion order is not DOM structure; preserve text whitespace.
 const normalize = node => {
  if (node.nodeType === 3) return ['text', node.nodeValue];
  return [node.nodeName, [...node.attributes].map(attr => [attr.name, attr.value]).sort(([a], [b]) => a.localeCompare(b)), [...node.childNodes].map(normalize)];
 };
 for(const [name,delta] of fixtures){const m={...basic,...delta};const flags={effectiveUnread:false,vStart:-1,vEnd:-1,showHoverBar:true,showAdminDelete:false};assert.deepEqual(normalize(port.namespace.createChatMessageRowElement(m,0,[m],1,flags)),normalize(reference.namespace.createChatMessageRowElement(m,0,[m],1,flags)),name);}
 for(const name of ['grouped','unread-first','unread-middle','unread-last','unread-solo']){const messages=[0,1,2].map(i=>({...basic,id:i+1,sender_id:2,created_at:`2026-10-02T12:0${i}:00Z`}));const index=name==='unread-last'?2:name==='unread-middle'?1:0;const flags={effectiveUnread:name!=='grouped',vStart:0,vEnd:name==='unread-solo'?0:2,showHoverBar:true};assert.deepEqual(normalize(port.namespace.createChatMessageRowElement(messages[index],index,messages,1,flags)),normalize(reference.namespace.createChatMessageRowElement(messages[index],index,messages,1,flags)),name);}
 const mounted=await load(base+'/Messages.js');await mounted.link((specifier,ref)=>load(path.resolve(path.dirname(ref.identifier),specifier)));await mounted.evaluate();const outlet=w.document.querySelector('.beta-outlet__content');
 const templates = load(path.join(repoRoot, 'vps/client/utils/dom.js'));
 const clone = templates.namespace.createTemplateFactory('<template id="sample"><div><span>initial</span></div></template>');
 const first = clone('sample'); first.firstElementChild.textContent = 'changed';
 assert.equal(clone('sample').firstElementChild.textContent, 'initial');
 const actions = [];
 Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => actions.push(['copy', text]) } });
 context.confirm = () => true;
 const view=mounted.namespace.mountMessages({outlet,viewerId:1,onReact:async(id,key)=>{actions.push(['react',id,key]);return true;},onEdit:async()=>true,onDelete:async id=>{actions.push(['delete',id]);return true;}});
 view.render({messages:[basic],hasMore:false,editable:true});const stream=outlet.querySelector('[data-chat-messages]');assert.equal(stream.tagName,'DIV');assert.equal(stream.className,'chat-page-messages');assert.equal(stream.getAttribute('role'),'log');assert.equal(stream.children.length,1);assert.equal(stream.firstChild.className,'connect-chat-msg is-self connect-chat-msg--reaction-empty');
 const referenceRow=reference.namespace.createChatMessageRowElement(basic,0,[basic],1,{effectiveUnread:false,vStart:-1,vEnd:-1,showHoverBar:true});
 const copy=stream.firstChild.cloneNode(true);copy.removeAttribute('data-chat-latest');assert.deepEqual(normalize(copy),normalize(referenceRow));
 assert.equal(outlet.querySelector('template'), null);
 const bubble=stream.querySelector('.connect-chat-msg-bubble');const row=stream.firstChild;
 row.querySelector('[data-chat-hover-copy]').click();
 row.querySelector('[data-chat-hover-delete]').click();
 assert.ok(row.classList.contains('is-deleting'));
 assert.equal(row.getAttribute('aria-busy'), 'true');
 row.querySelector('.connect-chat-msg-hover-react').click();
 await new Promise(resolve => setTimeout(resolve, 0));
 assert.deepEqual(actions, [['copy', 'Hello'], ['delete', '10'], ['react', '10', 'heart']]);
 assert.ok(!row.classList.contains('is-deleting'));
 assert.equal(row.getAttribute('aria-busy'), null);
 context.matchMedia = () => ({ matches: true });
 bubble.click(); assert.ok(row.classList.contains('connect-chat-msg--toolbar-open'));
 bubble.click(); assert.ok(!row.classList.contains('connect-chat-msg--toolbar-open'));
 context.matchMedia = w.matchMedia;
 view.render({messages:[{...basic,reactions:{heart:['@harrison']},viewer_reactions:['heart']}],hasMore:false,editable:true});assert.equal(stream.firstChild,row);assert.equal(stream.querySelector('.connect-chat-msg-bubble'),bubble);assert.ok(stream.querySelector('.connect-chat-msg-footer > .comment-meta-row > .comment-meta-top > .comment-meta-right > .comment-reaction-pills > .comment-reaction-pills-inner'));
 view.render({messages:[{...basic,id:9},basic],hasMore:true,editable:true});assert.equal(stream.firstChild.className,'chat-page-thread-load-sentinel');assert.equal(stream.children[1].dataset.chatMessageId,'9');assert.equal(stream.children[2].dataset.chatMessageId,'10');
 stream.querySelector('[data-chat-hover-edit]').click();assert.ok(stream.querySelector('[data-chat-message-editing="1"] .connect-chat-msg-edit-dialog'));stream.querySelector('[data-chat-message-edit-cancel]').click();
 view.setReplyTarget(10); assert.ok(stream.querySelector('[data-chat-message-id="10"]').classList.contains('connect-chat-msg--reply-target'));
 view.setReplyTarget(null); assert.ok(!stream.querySelector('.connect-chat-msg--reply-target'));
 // Exercise hydration after mounting, async metadata, rerender, and edit cancellation.
 const requests = [];
 context.fetch = async url => {
  requests.push(String(url));
  const payload = String(url).startsWith('/api/create/images/')
   ? {id:123,title:'Preview',status:'completed',url:'https://example.com/preview.png',meta:{}}
   : String(url).startsWith('/api/suno/')
    ? {kind:'song',songId:'12345678-1234-1234-1234-123456789abc',title:'Song',creator:'Artist',ogImage:'https://example.com/cover.png'}
    : String(url).startsWith('/api/x/') ? {title:'@person',tweetText:'Post preview'} : {title:'Video',creator:'@person'};
  return {ok:true,json:async()=>payload};
 };
 const rich = {...basic, body:'https://youtu.be/abcdefghi\nhttps://suno.com/s/abcdefgh\nhttps://x.com/person/status/123456789\n/creations/123'};
 const richReference = reference.namespace.createChatMessageRowElement(rich,0,[rich],1,{effectiveUnread:false,vStart:-1,vEnd:-1,showHoverBar:true});
 w.document.body.append(richReference);
 load(path.join(repoRoot,'vps/client/shared/userText.js')).namespace.hydrateRichUserTextEmbeds(richReference);
 for (const bubble of richReference.querySelectorAll('.connect-chat-msg-bubble')) reference.namespace.trimTrailingWhitespaceAfterChatEmbed(bubble);
 view.render({messages:[rich],hasMore:false,editable:true});
 await new Promise(resolve => setTimeout(resolve, 30));
 assert.ok(stream.querySelector('.connect-chat-youtube-embed-iframe'));
 assert.ok(stream.querySelector('.connect-chat-suno-embed-iframe'));
 assert.ok(stream.querySelector('.connect-chat-creation-embed-img'));
 assert.match(stream.textContent, /Post preview/);
 for (const endpoint of ['/api/youtube/oembed', '/api/suno/resolve', '/api/x/oembed', '/api/create/images/123']) assert.ok(requests.some(url => url.startsWith(endpoint)), endpoint);
 await new Promise(resolve => setTimeout(resolve, 30));
 const richCopy = stream.firstChild.cloneNode(true); richCopy.removeAttribute('data-chat-latest');
 assert.deepEqual(normalize(richCopy),normalize(richReference),'hydrated rich message matches WWW builder and hydration');
 richReference.remove();
 const hydratedBubble = stream.querySelector('.connect-chat-msg-bubble');
 view.render({messages:[{...rich,reactions:{heart:['@person']}}],hasMore:false,editable:true});
 assert.equal(stream.querySelector('.connect-chat-msg-bubble'), hydratedBubble);
 assert.equal(stream.querySelectorAll('.connect-chat-youtube-embed').length, 1);
 stream.querySelector('[data-chat-hover-edit]').click();
 stream.querySelector('[data-chat-message-edit-cancel]').click();
 await new Promise(resolve => setTimeout(resolve, 30));
 assert.ok(stream.querySelector('.connect-chat-youtube-embed-iframe'), 'edit cancel rehydrates replacement row');
 assert.ok(stream.querySelector('.connect-chat-creation-embed-img'), 'edit cancel restores creation preview');
 const images = {...basic,body:['a','b','c','d'].map(name => '/api/images/generic/profile/1/generic_'+name+'.png').join('\n')};
 view.render({messages:[images],hasMore:false,editable:true});
 assert.ok(stream.querySelector('.user-text-inline-media-group'), 'consecutive image hydration groups media');
 for (const img of stream.querySelectorAll('.user-text-inline-image')) {
  assert.equal(img.dataset.inlineImageHydrateBound,'1');
  img.dispatchEvent(new w.Event('load'));
  assert.ok(!img.closest('.user-text-inline-image-wrap').classList.contains('is-loading'));
 }
 view.render({messages:[],hasMore:false,editable:true}); assert.equal(stream.firstChild.className, 'chat-page-empty-hint');
 view.setStatus({isLoading:true}); assert.ok(stream.querySelector('.chat-thread-channel-loading > .skeleton-chat-thread'));
 view.destroy();assert.equal(outlet.children.length,0);
 assert.equal(fixtures.length + 5, 19);
} finally { dom.window.close(); }
});

const styleSources = ['public/global.css', 'public/pages/chat.css', 'public/pages/chat-hotfix.css'];
const relevant = /\.(?:connect-chat-msg(?:[-.\s:#\[]|$)|connect-chat-(?:creation-embed|youtube|suno|canvas-inline)|msg-reply-|user-text-|comment-(?:meta-row|meta-top|meta-right|author-name|avatar|reaction)|avatar-with-founder-flair|founder-(?:flair|name)|chat-(?:timed-message|channel-system-event)|chat-page-(?:empty-hint|optimistic-|thread-load-sentinel|thread-loading)|skeleton-chat-(?:msg|thread)|chat-thread-channel-loading)/;
function keep(selector) {
 if (relevant.test(selector)) return !/\.chat-page-pinned-message-overlay/.test(selector);
 if (/\.chat-page-messages(?:\s|:|$)/.test(selector)) return !/\.(?:feed-route|chat-feed|comments-channel|chat-doom|doom-|challenge-pane|chat-page--pseudo|chat-page--viewport-scroll|chat-page--doom-scroll|chat-page--challenges|chat-page--mobile-composer-overlay|chat-page--create-composer-overlay|chat-page-pinned-banner)/.test(selector.replace(/:not\([^)]*\)/g, ''));
 return false;
}
function adapt(selector) { return selector.replace(/html\.chat-page\s+/g, '').replace(/body\.chat-page/g, 'body.beta-layout'); }
function rules(root, reference = false) {
 const collected = [];
 root.walkRules(node => {
  const conditions = []; let parent = node.parent;
  while (parent) { if (parent.type === 'atrule') conditions.unshift([parent.name, parent.params]); parent = parent.parent; }
  if (conditions.some(([name]) => /keyframes$/.test(name))) return;
  const selectors = postcss.list.comma(node.selector).filter(reference ? keep : () => true).map(reference ? adapt : value => value);
  if (selectors.length) collected.push({ selectors, conditions, declarations: node.nodes.filter(n => n.type === 'decl').map(n => [n.prop, n.value, !!n.important]) });
 });
 return collected;
}
test('messages CSS retains every relevant WWW rule and its cascade order', { skip: !fs.existsSync(sourcePath) }, () => {
 const expected = styleSources.flatMap(file => rules(postcss.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8')), true));
 const port = postcss.parse(fs.readFileSync(path.join(repoRoot, 'vps/client/components/Messages/Messages.css'), 'utf8'));
 assert.deepEqual(rules(port), expected);
 assert.equal(expected.length, 601);
 for (const name of ['msg-reply-jump-flash', 'inline-image-loading-shimmer', 'connect-chat-creation-embed-pulse', 'loading', 'spin']) {
  const frames = []; port.walkAtRules(/keyframes$/, node => { if (node.params === name) frames.push(node); });
  assert.ok(frames.length, `Missing animation ${name}`);
  const expectedFrames = styleSources.flatMap(file => {
   const found = []; postcss.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8')).walkAtRules(/keyframes$/, node => { if (node.params === name) found.push(node); }); return found;
  });
  const signature = node => [node.name, node.params, node.nodes.filter(child => child.type === 'rule').map(child => [child.selector, child.nodes.filter(decl => decl.type === 'decl').map(decl => [decl.prop, decl.value, !!decl.important])])];
  assert.deepEqual(frames.map(signature), expectedFrames.map(signature), `Animation differs: ${name}`);
 }
});
