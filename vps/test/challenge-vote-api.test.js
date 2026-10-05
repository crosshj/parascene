import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import createChallengeActionsRoutes from '../routes/challengeActions.js';

async function withApi(run) {
 let reads=0;
 const app=express();app.use(express.json());
 app.use((req,_res,next)=>{if(req.get('authorization')==='test')req.auth={userId:1};next();});
 app.use(createChallengeActionsRoutes({queries:{},getClient:()=>({from(){reads++;throw Error('Database must not be touched for invalid requests');}})}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try {await run(`http://127.0.0.1:${server.address().port}`,()=>reads);} finally {await new Promise(resolve=>server.close(resolve));}
}
test('vote API rejects cross-account outbox replay before reading or writing messages',()=>withApi(async(base,reads)=>{
 const response=await fetch(`${base}/api/chat/messages/7/challenge-vote`,{method:'PUT',headers:{authorization:'test','content-type':'application/json'},body:JSON.stringify({viewer_id:2,score:8,intent:{at:100,id:'vote'}})});
 assert.equal(response.status,403);assert.equal((await response.json()).code,'VIEWER_CHANGED');assert.equal(reads(),0);
}));
test('vote API requires authentication and a complete explicit intent',()=>withApi(async(base,reads)=>{
 const path=`${base}/api/chat/messages/7/challenge-vote`;
 assert.equal((await fetch(path,{method:'PUT'})).status,401);
 assert.equal((await fetch(path,{method:'PUT',headers:{authorization:'test','content-type':'application/json'},body:JSON.stringify({viewer_id:1,score:8})})).status,400);
 assert.equal(reads(),0);
}));
