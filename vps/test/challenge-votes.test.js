import test from 'node:test';
import assert from 'node:assert/strict';
import { createChallengeVotes } from '../client/providers/challenges/votes.js';
import { saveChallengeVote } from '../services/challenges/voteStore.js';
import { CHALLENGE_SCORE_REACTION_KEYS as keys } from '../client/shared/challenges/constants.js';
import { mergeThreadsInbox } from '../client/providers/threads/model.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(fn) { for (let i=0;i<100;i++) { if(fn()) return; await tick(); } assert.fail('Timed out waiting for expected state'); }
function storage() { const data = new Map(); return { get length() { return data.size; }, key: i => [...data.keys()][i], getItem: k => data.get(k) || null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) }; }
const ack = payload => ({ ok: true, score: payload.score, intent: { ...payload.intent, score: payload.score } });

test('vote is durable before delivery and replays after the page/provider is destroyed', async () => {
 const store=storage(); const sent=[];
 const first=createChallengeVotes({viewerId:1,storage:()=>store,debounceMs:1000,send:async(...args)=>sent.push(args)});
 first.set(9,7,8); assert.equal(store.length,1); assert.equal(sent.length,0); first.destroy();
 const second=createChallengeVotes({viewerId:1,storage:()=>store,debounceMs:0,send:async(id,payload)=>{sent.push([id,payload]);return ack(payload);}});
 try { await until(()=>second.get(7)?.status==='saved'); assert.equal(sent.length,1); assert.equal(sent[0][1].score,8); assert.equal(sent[0][1].viewer_id,1); }
 finally { second.destroy(); }
});

test('newer intent wins during an in-flight request and old responses cannot clear it', async () => {
 const requests=[]; const store=storage();
 const votes=createChallengeVotes({viewerId:1,storage:()=>store,debounceMs:0,send:(id,payload)=>new Promise(resolve=>requests.push({id,payload,resolve}))});
 try {
  votes.set(9,7,2); await until(()=>requests.length===1);
  votes.set(9,7,9); await tick(); assert.equal(requests.length,1);
  requests[0].resolve(ack(requests[0].payload)); await until(()=>requests.length===2);
  assert.equal(votes.get(7).score,9); assert.equal(votes.get(7).status,'pending');
  requests[1].resolve(ack(requests[1].payload)); await until(()=>votes.get(7).status==='saved');
  assert.equal(votes.get(7).score,9);
 } finally { votes.destroy(); }
});

test('a transient failure retries the same idempotent intent; stale refreshes keep selected score and badge', async () => {
 const sent=[]; const votes=createChallengeVotes({viewerId:1,storage:()=>storage(),debounceMs:0,retryMs:1,send:async(_id,payload)=>{sent.push(payload);if(sent.length===1)throw new Error('offline');return ack(payload);}});
 try {
  votes.set(9,7,6); await until(()=>votes.get(7).status==='saved');
  assert.equal(sent.length,2); assert.equal(sent[0].intent.id,sent[1].intent.id);
  const [message]=votes.project([{id:7,viewer_reactions:[],reactions:{}}]);
  assert.deepEqual(message.viewer_reactions,[keys[5]]); assert.equal(message.reactions[keys[5]],1);
  assert.equal(votes.pending().length,0);
 } finally { votes.destroy(); }
});

test('unauthorized votes remain explicit failures without infinite retries or false saved state', async () => {
 let calls=0;const votes=createChallengeVotes({viewerId:1,storage:()=>storage(),debounceMs:0,retryMs:1,send:async()=>{calls++;throw Object.assign(new Error('No longer a member'),{status:403});}});
 try { votes.set(9,7,5);await until(()=>votes.get(7).status==='blocked');await tick();assert.equal(calls,1);assert.equal(votes.pending().length,1);assert.equal(votes.get(7).score,5); }
 finally { votes.destroy(); }
});

test('account scopes isolate queued votes and unavailable storage still allows online saving', async () => {
 const store=storage();const a=createChallengeVotes({viewerId:1,storage:()=>store,debounceMs:1000,send:async()=>{}});a.set(9,7,8);a.destroy();
 let calls=0;const b=createChallengeVotes({viewerId:2,storage:()=>store,send:async()=>calls++});await tick();assert.equal(calls,0);assert.equal(b.pending().length,0);b.destroy();
 const c=createChallengeVotes({viewerId:1,storage:()=>{throw Error('blocked');},debounceMs:0,send:async(_id,payload)=>ack(payload)});
 try { c.set(9,8,4);assert.equal(c.durable,false);await until(()=>c.get(8).status==='saved'); } finally { c.destroy(); }
});

function database({ owner=99, member=true }={}) {
 let row={id:7,thread_id:9,sender_id:owner,body:JSON.stringify({kind:'challenge_submission'}),reactions:{}};
 let writes=0, conflicts=0;
 const sb={from(table){let update=null,expected=null;
  const q={select(){return q;},eq(key,value){if(key==='reactions')expected=JSON.parse(value);return q;},is(){return q;},update(value){update=value;return q;},async maybeSingle(){return {data:table==='prsn_chat_messages'?structuredClone(row):table==='prsn_chat_members'?(member?{user_id:1}:null):{channel_slug:'challenges'}};},then(resolve,reject){return Promise.resolve().then(()=>{if(JSON.stringify(row.reactions)!==JSON.stringify(expected)){conflicts++;return {data:[]};}writes++;row={...row,...update};return {data:[{id:7}]};}).then(resolve,reject);}};return q;
 }};return {sb,get row(){return row;},get writes(){return writes;},get conflicts(){return conflicts;}};
}

test('simultaneous voters merge instead of losing another voter, without a DB schema change', async () => {
 const db=database();
 await Promise.all([saveChallengeVote({sb:db.sb,userId:1,messageId:7,score:3,intent:{at:100,id:'one'}}),saveChallengeVote({sb:db.sb,userId:2,messageId:7,score:9,intent:{at:100,id:'two'}})]);
 assert.deepEqual(db.row.reactions[keys[2]],[1]);assert.deepEqual(db.row.reactions[keys[8]],[2]);assert.ok(db.conflicts>=1);
});

test('replayed or reordered requests cannot undo a newer score and duplicate retries do not toggle', async () => {
 const db=database();const send=(score,at,id)=>saveChallengeVote({sb:db.sb,userId:1,messageId:7,score,intent:{at,id}});
 await send(8,200,'new');await send(2,100,'old');await send(8,200,'new');
 assert.equal(db.writes,1);assert.deepEqual(db.row.reactions[keys[7]],[1]);assert.equal(db.row.reactions[keys[1]],undefined);
});

test('server refuses nonmembers and self-voting before writing', async () => {
 for(const options of [{owner:1},{member:false}]) { const db=database(options);await assert.rejects(saveChallengeVote({sb:db.sb,userId:1,messageId:7,score:8,intent:{at:100,id:'vote'}}),{status:403});assert.equal(db.writes,0); }
});

test('confirmed read marker prevents a stale inbox response from restoring the Challenges badge', () => {
 const incoming={threads:[{id:9,channel_slug:'challenges',unread_count:5,last_message:{id:20}}],unreadSummary:{challenges_unread:5,total_unread:7}};
 const next=mergeThreadsInbox(incoming,{readMarkers:{9:20}});assert.equal(next.unreadSummary.challenges_unread,0);assert.equal(next.unreadSummary.total_unread,2);
 const newer=mergeThreadsInbox({...incoming,threads:[{...incoming.threads[0],last_message:{id:21}}]},next);assert.equal(newer.unreadSummary.challenges_unread,5);
});

test('older tab acknowledgements cannot overwrite a newer durable intent before storage events arrive', async () => {
 const store=storage();let finish;
 const a=createChallengeVotes({viewerId:1,storage:()=>store,debounceMs:0,now:()=>100,send:(_id,payload)=>new Promise(resolve=>{finish=()=>resolve(ack(payload));})});
 a.set(9,7,2);await until(()=>finish);
 const b=createChallengeVotes({viewerId:1,storage:()=>store,debounceMs:1000,now:()=>101,send:async()=>{}});
 b.set(9,7,9);b.destroy();finish();await until(()=>a.get(7).status==='saved');a.destroy();
 const sent=[];const c=createChallengeVotes({viewerId:1,storage:()=>store,send:async(_id,payload)=>{sent.push(payload);return ack(payload);}});
 try { await until(()=>c.get(7)?.status==='saved');assert.equal(c.get(7).score,9);assert.equal(sent[0].score,9); } finally { c.destroy(); }
});

test('hung network requests time out and retry without changing the vote intent', async () => {
 let calls=0;const votes=createChallengeVotes({viewerId:1,storage:()=>storage(),debounceMs:0,retryMs:1,timeoutMs:5,send:async(_id,payload,{signal})=>{
  calls++;if(calls>1)return ack(payload);
  return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('timed out'),{name:'AbortError'}))));
 }});
 try { votes.set(9,7,10);await until(()=>votes.get(7).status==='saved');assert.equal(calls,2);assert.equal(votes.get(7).score,10); } finally { votes.destroy(); }
});

test('WWW-compatible adds use the same atomic writer and preserve every other voter', async () => {
 const db=database();await saveChallengeVote({sb:db.sb,userId:1,messageId:7,score:4,intent:{at:100,id:'beta'}});
 await saveChallengeVote({sb:db.sb,userId:2,messageId:7,emojiKey:keys[8],op:'add'});
 assert.deepEqual(db.row.reactions[keys[3]],[1]);assert.deepEqual(db.row.reactions[keys[8]],[2]);
 await saveChallengeVote({sb:db.sb,userId:1,messageId:7,emojiKey:keys[5],op:'add'});
 assert.equal(db.row.reactions[keys[3]],undefined);assert.deepEqual(db.row.reactions[keys[5]],[1]);assert.deepEqual(db.row.reactions[keys[8]],[2]);
});

test('fresh input advances the observed server revision even when the browser clock is behind', () => {
 const votes=createChallengeVotes({viewerId:1,storage:()=>storage(),now:()=>1,debounceMs:10000,send:async()=>{}});
 try {
  votes.project([{id:7,viewer_vote_intent:{at:10000,id:'other-device',score:2},viewer_reactions:[keys[1]],reactions:{[keys[1]]:1}}]);
  const next=votes.set(9,7,9);assert.ok(next.intent.at>10000);assert.equal(next.score,9);
 } finally {votes.destroy();}
});
