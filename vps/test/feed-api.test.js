import test from 'node:test';
import assert from 'node:assert/strict';
import createFeedRoutes from '../routes/feed.js';
import { createChatFeedFetchPage } from '../client/providers/feed/feed.js';
import { createDoomFeedPager } from '../client/providers/feed/doom.js';
import { normalizeDoomAnchorMountItems } from '../client/providers/feed/doom.js';
import { invalidateChallengeFeedSnapshotMemCache } from '../services/feed/challengeFeedSnapshotCache.js';

async function call(router, path, { auth = { userId: 1 }, query = {}, body } = {}) {
 const route = router.stack.find(layer => layer.route?.path === path)?.route;
 const handler = route.stack[0].handle;
 let status = 200, data;
 const res = { status(value) { status = value; return this; }, json(value) { data = value; return this; }, setHeader() {} };
 await handler({ auth, query, body }, res);
 return { status, data };
}
function queries(extra = {}) {
 return { selectUserById: { get: async () => ({id:1,meta:{}}) }, selectPolicyByKey:{get:async()=>null}, selectFeedItems:{getPage:async()=>({rows:[],hasMore:false})}, ...extra };
}
test('every feed surface requires authentication, including impression writes', async()=>{
 const router = createFeedRoutes({queries:queries()});
 for (const path of ['/api/feed','/api/feed/doom','/api/feed/version','/api/feed/challenge-engagement','/api/feed/impressions','/api/feed/impression']) assert.equal((await call(router,path,{auth:null})).status,401,path);
});
test('ranked feed drops NSFW rows even when a stored legacy-feed flag is present',async()=>{
 invalidateChallengeFeedSnapshotMemCache();
 const catalog=[{id:7,created_image_id:70,url:'/safe.jpg',created_at:'2026-10-01',user_id:2,meta:{}},{id:8,created_image_id:80,url:'/hidden.jpg',nsfw:true,created_at:'2026-09-30',user_id:2,meta:{}}];
 const router=createFeedRoutes({queries:queries({selectUserById:{get:async()=>({id:1,meta:{forceLegacyFeed:true}})},selectFeedBetaSitewideCatalog:{getRecent:async()=>catalog,getPublishedCount:async()=>catalog.length},selectUserFollowing:{all:async()=>[]}})});
 const out=await call(router,'/api/feed',{query:{limit:12,feed_surface:'chat'}});
 assert.equal(out.status,200);assert.deepEqual(out.data.items.map(row=>row.created_image_id),[70]);assert.equal(out.data.feed_beta.completed_page,1);
});
test('doom deep links fall back to the site video timeline with an explicit anchor and cursor',async()=>{
 let options;const router=createFeedRoutes({queries:queries({selectFeedItems:{getPage:async()=>({rows:[],hasMore:false}),getSitePublishedVideoFeedPage:async(_viewer,opts)=>{options=opts;return {rows:[{created_image_id:42,url:'/cover.jpg',meta:{media_type:'video',video:{file_path:'/clip.mp4'}}}],hasMore:true,cursor:{after_created_image_id:'42'}};}}})});
 const out=await call(router,'/api/feed/doom',{query:{start:'42',limit:8}});
 assert.equal(out.status,200);assert.equal(options.mode,'from_anchor');assert.equal(options.startCreationId,42);assert.equal(out.data.items[0].media_type,'video');assert.equal(out.data.hasMore,true);assert.equal(out.data.cursor.after_created_image_id,'42');
});
test('mobile feed continuation keeps the server cursor even when hidden rows are removed',async()=>{
 const urls=[];const fetchPage=createChatFeedFetchPage({mobileChatSlotPack:true,getHiddenFeedItems:()=>['9'],fetchJsonWithStatusDeduped:async url=>{urls.push(url);return {ok:true,data:{items:[{id:9},{id:8}],hasMore:true,feed_cursor:{after_image_created_at:'2026-10-01',after_image_id:9}}};}});
 assert.deepEqual((await fetchPage({initial:true,items:[]})).pageItems,[{id:8}]);await fetchPage({initial:false,items:[{id:8}]});assert.match(urls[0],/slot_pack=mobile_chat_v1/);assert.match(urls[1],/feed_after_image_id=9/);assert.doesNotMatch(urls[1],/slot_pack=/);
});
test('doom pager filters hidden and non-video rows while advancing using the API cursor',async()=>{
 const urls=[];const pager=createDoomFeedPager({getHiddenFeedItems:()=>['9'],fetchJsonWithStatusDeduped:async url=>{urls.push(url);return {ok:true,data:{items:[{created_image_id:10,media_type:'video',video_url:'/ten.mp4'},{created_image_id:9,media_type:'video',video_url:'/nine.mp4'},{created_image_id:8,media_type:'image'}],hasMore:true,cursor:{after_created_image_id:'8'}}};}});
 const page=await pager.fetchMountPage(10);assert.equal(page.pageItems.length,1);await pager.fetchOlderPage();assert.match(urls[1],/after_created_image_id=8/);assert.deepEqual(normalizeDoomAnchorMountItems([{id:11},{id:10},{id:9}],10),[{id:10},{id:9}]);
});

test('ranked feed uses the sitewide catalog and returns a continuation cursor and acknowledgement',async()=>{
 const catalog=Array.from({length:45},(_,i)=>({id:i+1,created_image_id:i+1,title:'Ranked '+i,url:'/image.jpg',created_at:new Date(Date.now()-i*3600000).toISOString(),user_id:i+2,meta:{},like_count:i%5,comment_count:0}));
 const router=createFeedRoutes({queries:queries({selectUserById:{get:async()=>({id:1,meta:{}})},selectFeedBetaSitewideCatalog:{getRecent:async()=>catalog,getPublishedCount:async()=>catalog.length},selectUserFollowing:{all:async()=>[]}})});
 const out=await call(router,'/api/feed',{query:{limit:12,feed_surface:'chat'}});
 assert.equal(out.status,200);assert.ok(out.data.items.length>0);assert.equal(out.data.feed_beta.completed_page,1);assert.ok(out.data.feed_cursor.after_image_id);assert.ok(out.data.feed_timing);
});
