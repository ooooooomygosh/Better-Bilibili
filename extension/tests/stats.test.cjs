'use strict';
// 观看周报: pure stats core + the service worker as the single writer (chrome.* mocked like sw-lock.test.cjs).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const st=require('../src/stats-core.js');
const SRC=path.join(__dirname,'../src');
const at=(y,m,d,h=20,mi=0)=>new Date(y,m-1,d,h,mi).getTime();
function play(raw,now,seconds,id='BV1aa411c7mD',up){let s=raw;for(let i=0;i<seconds;i+=5)s=st.tick(s,now+i*1000,5,id,up);return s;}

test('defaults: on, with the weekly notice; only an explicit false turns them off',()=>{
 assert.deepEqual(st.settings({}),{statsEnabled:true,statsWeeklyNotice:true});
 assert.deepEqual(st.settings({statsEnabled:false,statsWeeklyNotice:0}),{statsEnabled:false,statsWeeklyNotice:true});
});

test('day keys are local calendar dates; weeks start on Monday 00:00 local',()=>{
 assert.equal(st.dayKey(at(2026,10,16,23,59)),'2026-10-16');
 assert.equal(st.dayKey(at(2026,10,17,0,0)),'2026-10-17');
 assert.equal(st.weekKey(at(2026,10,12,0,0)),'2026-10-12'); // Monday midnight belongs to the new week
 assert.equal(st.weekKey(at(2026,10,11,23,59)),'2026-10-05'); // Sunday night to the old one
 assert.equal(st.weekKey(at(2026,10,18,12)),'2026-10-12');
 assert.equal(st.weekKey('2026-10-14'),'2026-10-12');
 // Across month / year ends and the DST change dates of many zones: pure date arithmetic, never 24 h steps.
 assert.equal(st.weekKey('2027-01-01'),'2026-12-28');
 assert.equal(st.addDays('2026-03-28',2),'2026-03-30');
 assert.equal(st.addDays('2026-10-24',2),'2026-10-26');
 assert.equal(st.addDays('2026-11-01',-7),'2026-10-25');
 assert.deepEqual(st.weekDays('2026-10-26'),['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01']);
 assert.equal(st.range('2026-12-28'),'12月28日 – 1月3日');
});

test('ticks add seconds to the day and hour; a video counts once per day after 10 s',()=>{
 const t=at(2026,10,14,21,10);
 let s=play(null,t,5);assert.equal(s.days['2026-10-14'].n,0);
 s=play(s,t+5000,5);assert.equal(s.days['2026-10-14'].n,1);
 s=play(s,t+10000,60);assert.equal(s.days['2026-10-14'].n,1,'same video, same day');
 const d=s.days['2026-10-14'];assert.equal(d.s,70);assert.equal(d.h[21],70);assert.equal(d.h.reduce((a,b)=>a+b),70);
 s=play(s,at(2026,10,15,9),10);assert.equal(s.days['2026-10-15'].n,1,'counted again the next day');
 assert.equal(s.days['2026-10-14'].ids,undefined,'per-video lists are kept for today only');
 assert.equal(st.tick(s,t,9999).days['2026-10-14'].s,100,'a tick is capped at 30 s');
 assert.equal(st.tick(s,t,-5).days['2026-10-14'].s,70);
});

test('uploaders: seconds per mid, latest name wins, junk ignored, capped per day',()=>{
 const t=at(2026,10,14);
 let s=play(null,t,20,'BV1',{mid:'123',name:'  旧名字 '});s=play(s,t+20000,10,'BV1',{mid:'123',name:'新名字'});
 assert.deepEqual(s.days['2026-10-14'].up,{123:['新名字',30]});
 s=st.tick(s,t,5,'BV2',{mid:'abc',name:''});s=st.tick(s,t,5,'BV2',null);assert.equal(Object.keys(s.days['2026-10-14'].up).length,1);
 for(let i=0;i<st.MAX_UPS+10;i++)s=st.tick(s,t+i,5,'BVx'+i,{mid:String(1000+i),name:'UP'+i});
 const ups=s.days['2026-10-14'].up;assert.equal(Object.keys(ups).length,st.MAX_UPS);assert.equal(ups[123][1],30,'the big one stays');
});

test('only the last 10 weeks are kept, nothing from the future, corrupt data is ignored',()=>{
 const now=at(2026,10,16);
 const raw={days:{'2026-08-09':{s:100},'2026-08-10':{s:200,h:'x',up:{'1':['a','NaN']}},'2026-10-17':{s:5},'bad':{s:1},'2026-10-16':{s:'9e9',n:-3}},brake:7,noticed:'nope'};
 const s=st.normalize(raw,now);
 assert.deepEqual(Object.keys(s.days),['2026-08-10','2026-10-16']);
 assert.equal(s.days['2026-08-10'].h.length,24);assert.equal(s.days['2026-08-10'].up['1'][1],0);
 assert.equal(s.days['2026-10-16'].s,86400);assert.equal(s.days['2026-10-16'].n,0);
 assert.equal(s.brake,'');assert.equal(s.noticed,'');
 assert.equal(st.normalize('garbage',now).days&&Object.keys(st.normalize('garbage',now).days).length,0);
});

test('brakes count once per distinct limit / break, however many tabs report it',()=>{
 const t=at(2026,10,14),block={kind:'window',resetAt:t+3600000};
 const tag=st.brakeTag(block);assert.equal(tag,`window:${t+3600000}`);assert.equal(st.brakeTag(null),'');
 let s=st.brake(null,t,tag);s=st.brake(s,t+1000,tag);s=st.brake(s,t+2000,st.brakeTag({kind:'break',until:t+300000}));
 assert.equal(s.days['2026-10-14'].b,2);
});

test('week summary: totals, longest day, peak hour, top 5 UP, same-span cut',()=>{
 let s=null;
 s=play(s,at(2026,10,12,21),600,'BV1',{mid:'1',name:'甲'});
 s=play(s,at(2026,10,14,22),1800,'BV2',{mid:'2',name:'乙'});
 s=play(s,at(2026,10,15,12),300,'BV3',{mid:'1',name:'甲'});
 for(let i=0;i<6;i++)s=play(s,at(2026,10,16,20,i),30,'BVu'+i,{mid:String(10+i),name:'丙'+i});
 const w=st.week(st.normalize(s,at(2026,10,16,23)),'2026-10-12');
 assert.equal(w.seconds,600+1800+300+180);assert.equal(w.videos,3+6);
 assert.deepEqual(w.longest,{key:'2026-10-14',seconds:1800});assert.equal(w.peakHour,22);
 assert.deepEqual(w.ups.slice(0,2).map(u=>[u.name,u.seconds]),[['乙',1800],['甲',900]]);assert.equal(w.ups.length,5);
 assert.equal(w.days.length,7);assert.equal(w.activeDays,4);
 const cut=st.week(s,'2026-10-12',1);assert.equal(cut.seconds,600);assert.equal(cut.days[2].seconds,1800,'bars still show every day');
 assert.equal(st.week(null,'2026-10-12').seconds,0);assert.equal(st.week(null,'2026-10-12').peakHour,-1);
});

test('comparison one-liners tease or cheer',()=>{
 const W=s=>({seconds:s});
 const down=st.compare(W(24000),W(33000));assert.equal(down.pct,-27);assert.equal(down.mood,'down');assert.equal(down.text,'比上周少刷 2 小时 30 分，节流成功 🎉');
 assert.match(st.compare(W(1000),W(33000)).text,/少了一半多/);
 assert.equal(st.compare(W(0),W(3000)).mood,'down');
 assert.equal(st.compare(W(10200),W(10000)).mood,'flat');
 assert.equal(st.compare(W(11000),W(10000)).text,'比上周多了 10%，油门稍微松了点');
 assert.equal(st.compare(W(13800),W(10000)).text,'比上周多了 38%，刹车该踩了 🛑');
 assert.match(st.compare(W(30000),W(10000)).text,/翻了 3 倍/);
 assert.equal(st.compare(W(13800),W(10000),true).text,'比上周同期多了 38%，刹车该踩了 🛑');
 assert.equal(st.compare(W(500),W(0)).mood,'first');assert.equal(st.compare(W(0),W(0)).mood,'none');
 assert.equal(st.fmt(24000),'6 小时 40 分');assert.equal(st.fmt(7200),'2 小时');assert.equal(st.fmt(2280),'38 分钟');assert.equal(st.fmt(30),'不到 1 分钟');assert.equal(st.fmt(0),'0 分钟');
});

test('weekly notice: once per week, only with something to report',()=>{
 let s=play(null,at(2026,10,8,21),300);
 const a=st.notice(s,at(2026,10,12,9));assert.equal(a.show,true);assert.equal(a.seconds,300);assert.equal(a.week,'2026-10-05');
 assert.equal(st.notice(a.next,at(2026,10,13,9)).show,false,'already noticed this week');
 const b=st.notice(a.next,at(2026,10,19,9));assert.equal(b.show,false,'nothing watched last week');assert.equal(b.next.noticed,'2026-10-19');
});

function boot(){
 const data={sync:{},local:{}},messages=[];
 const area=name=>({
  async get(keys){const all=structuredClone(data[name]);if(keys==null)return all;if(typeof keys==='string')return keys in all?{[keys]:all[keys]}:{};
   if(Array.isArray(keys))return Object.fromEntries(keys.filter(k=>k in all).map(k=>[k,all[k]]));
   return {...keys,...Object.fromEntries(Object.keys(keys).filter(k=>k in all).map(k=>[k,all[k]]))};},
  async set(obj){await new Promise(r=>setTimeout(r,Math.random()*3));for(const[k,v]of Object.entries(obj))data[name][k]=structuredClone(v);},
  async remove(keys){for(const k of [].concat(keys))delete data[name][k];}
 });
 const ev=()=>({addListener(){}}),made=[];
 const chrome={storage:{sync:area('sync'),local:area('local'),onChanged:ev()},
  runtime:{id:'ext',onInstalled:ev(),onStartup:ev(),onMessage:{addListener:f=>messages.push(f)},getURL:p=>p,getContexts:async()=>[]},
  action:{setBadgeBackgroundColor:async()=>{},setBadgeText:async()=>{}},tabs:{onUpdated:ev(),create:async o=>{made.push(o.url);},remove:async()=>{}}};
 const ctx={chrome,console,crypto:globalThis.crypto,TextEncoder,btoa,atob,setTimeout,clearTimeout,structuredClone,Promise,Date};
 ctx.self=ctx;ctx.globalThis=ctx;
 ctx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync(path.join(SRC,f),'utf8'),ctx));
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(SRC,'service-worker.js'),'utf8'),ctx);
 const send=(msg,sender={id:'ext'})=>new Promise(resolve=>{for(const f of messages)if(f(msg,sender,resolve)===true)return;resolve(undefined);});
 return {data,send,made};
}

test('service worker: many tabs ticking at once lose nothing (single writer)',async()=>{
 const sw=boot(),tabs=[];
 for(let t=0;t<4;t++)for(let i=0;i<10;i++)tabs.push(sw.send({type:'focus-tick',seconds:5,id:'BVtab'+t,up:{mid:String(100+t),name:'UP'+t}},{id:'ext',tab:{id:t}}));
 await Promise.all(tabs);
 const d=Object.values(sw.data.local.watchStats.days)[0];
 assert.equal(d.s,200);assert.equal(d.n,4);assert.equal(Object.keys(d.up).length,4);assert.ok(Object.values(d.up).every(([,s])=>s===50));
 assert.equal(sw.data.local.focusUsage,undefined,'quota off: its usage is not metered');
});

test('service worker: quota on meters both; a limit counts one brake; statsEnabled off records nothing',async()=>{
 const sw=boot();
 await sw.send({type:'focus-set',changes:{focusEnabled:true,focusWindowMinutes:1,focusSessionMinutes:0}});
 for(let i=0;i<13;i++)await sw.send({type:'focus-tick',seconds:5,id:'BV1'});
 assert.equal(sw.data.local.focusUsage.window.seconds,65);
 const day=()=>Object.values(sw.data.local.watchStats.days)[0];
 assert.equal(day().s,65);assert.equal(day().b,1);
 await sw.send({type:'focus-check',id:'BV1'});await sw.send({type:'focus-check',id:'BV1'});assert.equal(day().b,1,'same limit, counted once');
 sw.data.sync.statsEnabled=false;
 await sw.send({type:'focus-tick',seconds:5,id:'BV1'});assert.equal(day().s,65);
 assert.equal(sw.data.local.focusUsage.window.seconds,70,'the quota is unaffected by the stats switch');
});

test('service worker: weekly notice once, clear, and opening the report from a page',async()=>{
 const sw=boot(),now=Date.now(),wk=st.weekKey(now),last=st.addDays(wk,-3);
 sw.data.local.watchStats={v:1,days:{[last]:{s:5400}}};
 const a=await sw.send({type:'stats-notice'},{id:'ext',tab:{id:1}});
 assert.equal(a.show,true);assert.equal(a.seconds,5400);assert.equal(a.range,st.range(st.addDays(wk,-7)));
 const b=await sw.send({type:'stats-notice'},{id:'ext',tab:{id:2}});assert.equal(b.show,false,'a second tab stays quiet');
 sw.data.sync.statsWeeklyNotice=false;sw.data.local.watchStats.noticed='';assert.equal((await sw.send({type:'stats-notice'})).show,false);
 assert.equal((await sw.send({type:'flow-open-report'})).ok,true);assert.deepEqual(sw.made,['ui/report.html']);
 assert.equal((await sw.send({type:'stats-clear'})).ok,true);assert.equal(sw.data.local.watchStats,undefined);
 assert.equal(await sw.send({type:'stats-clear'},{id:'other'}),undefined,'other extensions are ignored');
});

test('report page and stats core are wired into the extension',()=>{
 const root=path.join(__dirname,'..'),m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 assert.deepEqual(m.permissions,['storage']);
 assert.match(fs.readFileSync(path.join(SRC,'service-worker.js'),'utf8'),/importScripts\("focus-core\.js", "lock-core\.js", "stats-core\.js"\)/);
 const html=fs.readFileSync(path.join(root,'ui/report.html'),'utf8');
 for(const s of ['../src/ui-kit.js','../src/stats-core.js','report.js','report.css'])assert.ok(html.includes(s),s);
 assert.match(fs.readFileSync(path.join(root,'ui/options.html'),'utf8'),/id="statsEnabled"[\s\S]*id="statsWeeklyNotice"[\s\S]*id="statsClear"/);
 assert.match(fs.readFileSync(path.join(root,'ui/popup.html'),'utf8'),/id="report"/);
});
