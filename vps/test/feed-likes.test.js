import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedQueries, resolveFeedRowTitle } from '../db/feed.js';
import { creationTitleDisplay } from '../client/shared/creationCard.js';
import { applyViewerLikedToCatalog, applyViewerLikedToRows } from '../services/feed/ranking/catalog.js';
import { stampWhoMetaOnCreationRows } from '../services/feed/whoMeta.js';

test('feed titles preserve missing titles despite stored legacy placeholders', () => {
 for (const title of [null, '', '  ', undefined]) {
  const resolved = resolveFeedRowTitle(title, 'Untitled');
  assert.deepEqual(creationTitleDisplay({ title: resolved, published: true }), { text: 'Untitled', untitled: true });
 }
 assert.equal(resolveFeedRowTitle('', 'Old title'), '');
 assert.deepEqual(creationTitleDisplay({ title: resolveFeedRowTitle('Untitled', 'Old title'), published: true }), { text: 'Untitled', untitled: false });
 assert.equal(resolveFeedRowTitle(' New title ', 'Old title'), 'New title');
});

// Exercise the actual query factory used by server.js, including viewer isolation
// and profile hydration, rather than supplying the previously missing contracts.
function fixtureClient() {
 const tables = {
  prsn_likes_created_image: [
   {created_image_id:10,user_id:1,created_at:'2026-10-02'},
   {created_image_id:11,user_id:2,created_at:'2026-10-01'}
  ],
  prsn_comments_created_image: [
   {created_image_id:10,user_id:2,created_at:'2026-10-02'},
   {created_image_id:10,user_id:2,created_at:'2026-10-01'}
  ],
  prsn_user_profiles: [{user_id:1,user_name:'viewer'},{user_id:2,display_name:'Other'}]
 };
 return {from(table) {
  let rows = [...(tables[table] ?? [])];
  const query = {
   select() {return this;},
   eq(key,value) {rows=rows.filter(row=>row[key]===value);return this;},
   in(key,values) {rows=rows.filter(row=>values.includes(row[key]));return this;},
   order(key,{ascending}) {rows.sort((a,b)=>String(a[key]).localeCompare(String(b[key]))*(ascending?1:-1));return this;},
   limit(count) {rows=rows.slice(0,count);return this;},
   then(resolve,reject) {return Promise.resolve({data:rows,error:null}).then(resolve,reject);}
  };
  return query;
 }};
}

test('production feed queries preserve viewer likes in catalog and assembled pages and hydrate reaction names',async()=>{
 const queries=createFeedQueries(fixtureClient());
 const rows=[{created_image_id:10,like_count:1},{created_image_id:11,like_count:1}];
 for(const hydrate of [applyViewerLikedToCatalog,applyViewerLikedToRows]) {
  const result=await stampWhoMetaOnCreationRows(queries,await hydrate(queries,1,rows));
  assert.deepEqual(result.map(row=>row.viewer_liked),[true,false]);
  assert.deepEqual(result.map(row=>row.liked_by),[['@viewer'],['@Other']]);
  assert.deepEqual(result[0].commented_by,['@Other']);
 }
 assert.deepEqual(await queries.selectViewerLikedCreationIds.all(2,[10]),[]);
 assert.deepEqual(await queries.selectViewerLikedCreationIdsByUser.all(2),[11]);
});
