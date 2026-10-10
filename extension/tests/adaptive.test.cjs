'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const A=require('../src/adaptive-core.js');
const T0=1_800_000_000_000;
test('classify: risk control vs transient vs fatal',()=>{
 assert.equal(A.classify({status:412}),'risk');assert.equal(A.classify({status:429}),'risk');
 for(const c of [-352,-412,-401,-509,-799])assert.equal(A.classify({code:c}),'risk');
 assert.equal(A.classify({name:'AbortError'}),'transient');assert.equal(A.classify({name:'TypeError'}),'transient');
 assert.equal(A.classify({status:503}),'transient');assert.equal(A.classify({kind:'empty'}),'transient');assert.equal(A.classify({status:404}),'fatal');});
test('backoff is exponential, capped, with equal jitter',()=>{
 const o=A.DEFAULTS;for(let i=0;i<8;i++){const d=Math.min(o.backoffCap,o.backoffBase*2**i);assert.equal(A.backoff(i,o,()=>0),d/2);assert.equal(A.backoff(i,o,()=>1),d);}
 assert.equal(A.backoff(20,o,()=>1),o.backoffCap);});
test('Retry-After: seconds and HTTP dates',()=>{assert.equal(A.retryAfter('30'),30000);assert.equal(A.retryAfter(new Date(T0+5000).toUTCString(),T0),5000);assert.equal(A.retryAfter('x'),0);assert.equal(A.retryAfter(null),0);});
test('AIMD: slow additive increase, halving on failure',()=>{
 const c=A.create(null,{},T0);assert.deepEqual([c.raw.lanes,c.raw.batch],[2,2]);
 for(let i=0;i<3;i++)c.success(T0);assert.deepEqual([c.raw.lanes,c.raw.batch],[3,3]);assert(c.raw.gap<=700);
 for(let i=0;i<30;i++)c.success(T0);assert.equal(c.raw.lanes,3);
 c.failure('transient',T0);assert.deepEqual([c.raw.lanes,c.raw.batch],[1,1]);assert.equal(c.raw.gap,1400);assert.equal(c.state(T0),'closed');});
test('plan respects the user cap',()=>{const c=A.create(null,{},T0);for(let i=0;i<9;i++)c.success(T0);assert.equal(c.plan(1,3,T0).lanes,1);assert.equal(c.plan(3,3,T0).lanes,3);});
test('risk opens the breaker at once; cooldown escalates; half-open probe',()=>{
 const c=A.create(null,{},T0);c.failure('risk',T0);assert.equal(c.state(T0),'open');assert.equal(c.remaining(T0),30000);
 assert.equal(c.plan(3,3,T0).allowed,false);assert.equal(c.shouldRetry('transient',0),false);
 const p=c.plan(3,3,T0+30001);assert.equal(p.probe,true);assert.equal(p.requests,1);
 c.failure('transient',T0+30001);assert.equal(c.remaining(T0+30001),60000); // probe failed → doubled
 c.force(T0+31000);assert.equal(c.state(T0+31000),'half-open');c.success(T0+31000);assert.equal(c.state(T0+31000),'closed');});
test('Retry-After longer than the cooldown wins',()=>{const c=A.create(null,{},T0);c.failure('risk',T0,120000);assert.equal(c.remaining(T0),120000);});
test('three transient failures in a row trip it; a success resets the streak',()=>{
 const c=A.create(null,{},T0);c.failure('transient',T0);c.failure('transient',T0);c.success(T0);c.failure('transient',T0);c.failure('transient',T0);assert.equal(c.state(T0),'closed');c.failure('transient',T0);assert.equal(c.state(T0),'open');});
test('fatal errors slow down but never open the breaker',()=>{const c=A.create(null,{},T0);for(let i=0;i<5;i++)c.failure('fatal',T0);assert.equal(c.state(T0),'closed');});
test('persisted state: cooldown survives reload, stale tuning decays, junk clamped',()=>{
 const c=A.create(null,{},T0);c.failure('risk',T0);const snap=c.snapshot();
 const r=A.create(snap,{},T0+1000);assert.equal(r.state(T0+1000),'open');assert.equal(r.remaining(T0+1000),29000);
 const after=A.create(snap,{},T0+40000);assert.equal(after.state(T0+40000),'half-open');
 const stale=A.create({lanes:1,batch:1,gap:9000,at:T0},{},T0+3600000);assert.deepEqual([stale.raw.lanes,stale.raw.gap],[2,700]);
 const junk=A.create({lanes:99,batch:-3,gap:'x',openUntil:T0+9e9,at:T0},{},T0);assert.deepEqual([junk.raw.lanes,junk.raw.batch,junk.raw.gap,junk.state(T0)],[3,1,700,'closed']);});
test('withRetry retries transient errors with backoff and never retries risk',async()=>{
 const c=A.create(null,{},T0),sleeps=[];let n=0;
 const v=await A.withRetry(c,async()=>{if(n++<2){const e=new Error('t');e.kind='transient';throw e;}return 'ok';},ms=>{sleeps.push(ms);});
 assert.equal(v,'ok');assert.equal(sleeps.length,2);assert(sleeps[1]>=sleeps[0]/2);
 n=0;await assert.rejects(A.withRetry(c,async()=>{n++;const e=new Error('r');e.code=-352;throw e;},()=>{}),e=>e.kind==='risk');assert.equal(n,1);
 n=0;await assert.rejects(A.withRetry(c,async()=>{n++;const e=new Error('t');e.kind='transient';throw e;},()=>{}));assert.equal(n,3);});
