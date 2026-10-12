import test from 'node:test';
import assert from 'node:assert/strict';
import { createThreadsProvider } from '../client/providers/threads/index.js';
import { createThreadMessagesQuery } from '../client/providers/threads/query.js';
import { createQueryRegistry } from '../client/core/queryRegistry.js';
import { createChallengeVotes } from '../client/providers/challenges/votes.js';
import { CHALLENGE_SCORE_REACTION_KEYS as keys } from '../client/shared/challenges/constants.js';

function storage() { const data=new Map();return {get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}; }
const message=id=>({id,created_at:`2026-10-05T00:00:${String(id).padStart(2,'0')}Z`,body:'{}',viewer_reactions:[],reactions:{}});

test('complete Challenges history shares one cached thread query and one room subscription across views', async () => {
 const old=globalThis.localStorage;globalThis.localStorage=storage();let loads=0,subscriptions=0,unsubscribes=0;
 const api={loadMessages:async(_id,{before,limit})=>{loads++;assert.equal(limit,100);return before?{messages:[message(1)],hasMore:false,nextBefore:null}:{messages:[message(2)],hasMore:true,nextBefore:'older'};}};
 const make=viewerId=>createThreadsProvider({viewerId,registry:createQueryRegistry(),apiFactory:()=>api,realtimeFactory:()=>({subscribe(){subscriptions++;return()=>unsubscribes++;},destroy(){},retry(){}})});
 const provider=make(1);
 try {
  const first=provider.acquireMessages(9,{persist:true,complete:true});
  const second=provider.acquireMessages(9,{persist:true,complete:true});assert.equal(first.query,second.query);assert.equal(subscriptions,1);
  await first.query.refresh();assert.deepEqual(first.query.data.messages.map(m=>m.id),[1,2]);assert.equal(loads,2);assert.equal(first.query.data.complete,true);
  first.release();second.release();assert.equal(unsubscribes,1);
  const revisit=provider.acquireMessages(9,{persist:true,complete:true});assert.equal(revisit.query.data.messages.length,2);assert.equal(loads,2);revisit.release();
  provider.destroy();const reload=make(1),foreign=make(2);
  const warm=reload.acquireMessages(9,{persist:true,complete:true});const cold=foreign.acquireMessages(9,{persist:true,complete:true});
  assert.equal(warm.query.data.messages.length,2);assert.equal(cold.query.data,undefined);
  warm.release();cold.release();reload.destroy();foreign.destroy();
 } finally {provider.destroy();globalThis.localStorage=old;}
});

test('late history response cannot erase a vote entered while the refresh was in flight', async () => {
 let finish;const store=storage();
 const votes=createChallengeVotes({viewerId:1,storage:()=>store,debounceMs:10000,send:async()=>{}});
 const lease=createThreadMessagesQuery({threadId:9,viewerId:1,mode:{complete:true},reconcile:messages=>votes.project(messages),api:{loadMessages:()=>new Promise(resolve=>finish=resolve)}});
 try {
  const request=lease.query.refresh();await Promise.resolve();votes.set(9,7,8);
  finish({messages:[message(7)],hasMore:false,nextBefore:null});await request;
  assert.deepEqual(lease.query.data.messages[0].viewer_reactions,[keys[7]]);
  assert.equal(lease.query.data.messages[0].vote_delivery,'pending');
 } finally {lease.release();votes.destroy();}
});

test('failed refresh retains a usable complete history snapshot', async () => {
 let fail=false;const lease=createThreadMessagesQuery({threadId:9,mode:{complete:true},api:{async loadMessages(){if(fail)throw Error('offline');return {messages:[message(7)],hasMore:false,nextBefore:null};}}});
 try {await lease.query.refresh();fail=true;await assert.rejects(lease.query.refresh(),/offline/);assert.equal(lease.query.data.messages.length,1);assert.equal(lease.query.status,'stale-error');}
 finally {lease.release();}
});

test('incomplete pagination never replaces a complete cached snapshot', async () => {
 const lease=createThreadMessagesQuery({threadId:9,mode:{complete:true},api:{async loadMessages(){return {messages:[message(7)],hasMore:true,nextBefore:null};}}});
 lease.query.setData({messages:[message(1),message(7)],complete:true});
 try {await assert.rejects(lease.query.refresh(),/pagination cursor missing/);assert.equal(lease.query.data.messages.length,2);}
 finally {lease.release();}
});
