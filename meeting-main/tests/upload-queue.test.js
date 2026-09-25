import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrainer,pendingFor} from '../upload-queue.js';
import {temporaryPassword} from '../server/password.js';
function fixture(send){const rows=new Map();return {rows,drain:createDrainer({userId:'advisor',read:async()=>[...rows.values()],put:async x=>rows.set(x.id,x),send})};}
const item=(id,extra={})=>({id,userId:'advisor',dossierId:'project',callId:'call',type:'audio',blob:new Blob(['audio']),...extra});
test('lost upload acknowledgement reuses stable id and preserves source until confirmation',async()=>{
 const received=new Set();let attempts=0;const f=fixture(async x=>{received.add(x.id);if(++attempts===1)throw new Error('ACK lost');});f.rows.set('a',item('a'));
 assert.equal((await f.drain()).pending.length,1);assert.equal(await f.rows.get('a').blob.text(),'audio');
 assert.equal((await f.drain()).pending.length,0);assert.equal(received.size,1);assert.ok(f.rows.get('a').confirmedAt);assert.equal(await f.rows.get('a').blob.text(),'audio');
});
test('one failed call does not block other calls, but its finish waits',async()=>{
 const sent=[];const f=fixture(async x=>{sent.push(x.id);if(x.id==='a')throw new Error('offline');});
 for(const x of [item('end',{type:'finish'}),item('a'),item('b',{callId:'second'}),item('foreign',{userId:'other'})])f.rows.set(x.id,x);
 const result=await f.drain();assert.deepEqual(sent,['a','b']);assert.equal(result.pending.length,2);assert.equal(pendingFor([...f.rows.values()],'advisor').length,2);
});
test('simultaneous retry callers await the same actual completion',async()=>{
 let release;const wait=new Promise(r=>release=r);let calls=0;const f=fixture(async()=>{calls++;await wait;});f.rows.set('a',item('a'));
 const first=f.drain(),second=f.drain();assert.equal(first,second);release();await second;assert.equal(calls,1);assert.ok(f.rows.get('a').confirmedAt);
});
test('expired session keeps pending sources and does not attempt remaining calls',async()=>{
 let attempts=0;const f=fixture(async()=>{attempts++;throw Object.assign(new Error('expired'),{status:401});});f.rows.set('a',item('a'));f.rows.set('b',item('b'));
 assert.equal((await f.drain()).pending.length,2);assert.equal(attempts,1);
});
test('unbound source requires explicit assignment and is never sent',async()=>{
 let calls=0;const f=fixture(async()=>calls++);f.rows.set('a',item('a',{dossierId:null}));await f.drain();assert.equal(calls,0);assert.match(f.rows.get('a').error,/Rattachement/);
});
test('individual temporary passphrases have eight independently sampled pronounceable words',()=>{
 const values=new Set(Array.from({length:100},temporaryPassword));assert.equal(values.size,100);for(const value of values)assert.match(value,/^(?:[bcdfghjkmnprstvw][aeio][bcdfghjkmnprstvw][aeio]-){7}[bcdfghjkmnprstvw][aeio][bcdfghjkmnprstvw][aeio]7!$/);
});
