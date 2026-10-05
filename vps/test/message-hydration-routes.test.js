import test from 'node:test';
import assert from 'node:assert/strict';
import createYoutubeRoutes from '../routes/youtube.js';
import createSunoRoutes from '../routes/suno.js';
import createXRoutes from '../routes/x.js';

async function request(router, path, query, authenticated = true) {
 const route = router.stack.find(layer => layer.route?.path === path).route;
 const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(key,value) { this.headers[key] = value; }, json(body) { this.body = body; return this; } };
 await route.stack[0].handle({auth:authenticated ? {userId:1} : null,query},res);
 return res;
}

test('rich message metadata routes match WWW payloads and require authentication', async () => {
 const originalFetch = globalThis.fetch;
 const requests = [];
 globalThis.fetch = async url => {
  requests.push(String(url));
  if (String(url).includes('suno.com')) return {ok:true,text:async()=>'<meta property="og:title" content="My song | Suno"><meta property="og:image" content="https://example.com/cover.jpg">'};
  return {ok:true,json:async()=>String(url).includes('publish.twitter.com')
   ? {author_url:'https://twitter.com/person',author_name:'Person',html:'<blockquote><p>Hello &amp; world</p></blockquote>'}
   : {title:'Video',author_url:'https://www.youtube.com/@person',thumbnail_url:'https://example.com/thumb.jpg'}};
 };
 try {
  const routes = [[createYoutubeRoutes(),'/api/youtube/oembed','https://youtu.be/abcdefghijk'],[createSunoRoutes(),'/api/suno/resolve','https://suno.com/song/12345678-1234-1234-1234-123456789abc'],[createXRoutes(),'/api/x/oembed','https://x.com/person/status/1234']];
  for (const [router,path,url] of routes) {
   assert.equal((await request(router,path,{url},false)).statusCode,401);
   assert.equal((await request(router,path,{url:'https://example.com/invalid'})).statusCode,400);
  }
  assert.equal(requests.length,0);
  const youtube = await request(routes[0][0],routes[0][1],{url:routes[0][2]});
  assert.deepEqual(youtube.body,{title:'Video',creator:'@person',thumbnail_url:'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg'});
  const suno = await request(routes[1][0],routes[1][1],{url:routes[1][2]});
  assert.equal(suno.statusCode,200); assert.equal(suno.body.kind,'song'); assert.equal(suno.body.ogImage,'https://example.com/cover.jpg');
  const sunoAlbum = await request(routes[1][0],routes[1][1],{url:'https://suno.com/album/5d5f35ce-a6f9-4c3e-bf24-ec42a25afbe6'});
  assert.equal(sunoAlbum.statusCode,200); assert.equal(sunoAlbum.body.kind,'album');
  assert.equal(sunoAlbum.body.albumId,'5d5f35ce-a6f9-4c3e-bf24-ec42a25afbe6');
  assert.equal(sunoAlbum.body.title,'My song | Suno album');
  assert.equal(sunoAlbum.body.url,'https://suno.com/album/5d5f35ce-a6f9-4c3e-bf24-ec42a25afbe6');
  const x = await request(routes[2][0],routes[2][1],{url:routes[2][2]});
  assert.deepEqual(x.body,{title:'@person',tweetText:'Hello & world'});
 } finally { globalThis.fetch = originalFetch; }
});
