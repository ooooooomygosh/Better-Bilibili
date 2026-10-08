'use strict';
/* Controlled transport model, not a measurement of Bilibili or the user's network. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const ROOT=path.join(__dirname,'..'),SIZE=512*1024,PACKET=16*1024,RTT=40;
const data=Uint8Array.from({length:SIZE},(_,i)=>i%251),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function environment(){const c=vm.createContext({console,URL,Headers,Response,Request,AbortController,DOMException,Uint8Array,ArrayBuffer,performance,setTimeout,clearTimeout,WeakRef,location:{href:'https://www.bilibili.com/video/BV1fixture',origin:'https://www.bilibili.com'}});for(const f of ['range-core','flow-policy','cdn-resolver','idm-downloader'])vm.runInContext(fs.readFileSync(path.join(ROOT,'src',f+'.js'),'utf8'),c);return c;}
async function trial(model,parallel){
 const c=environment();let requests=0,wireBytes=0,globalClock=0;
 const transport=async(_url,init)=>{
  if(init.signal.aborted)throw init.signal.reason;requests++;
  await new Promise((resolve,reject)=>{const id=setTimeout(resolve,RTT);init.signal.addEventListener('abort',()=>{clearTimeout(id);reject(init.signal.reason);},{once:true});});
  const r=c.__BILI_RANGE_CORE__.parseRangeHeader(new Headers(init.headers).get('range'));let pos=r.start,timer=null,closed=false;
  const body=new ReadableStream({pull(controller){if(closed)return;if(init.signal.aborted){closed=true;controller.error(init.signal.reason);return;}if(pos>r.end){closed=true;controller.close();return;}
   const next=Math.min(r.end+1,pos+PACKET),piece=data.slice(pos,next);pos=next;
   const now=performance.now(),rate=model==='per_request_limit'?256*1024:1024*1024;
   const due=model==='shared_link_limit'?(globalClock=Math.max(globalClock,now)+piece.length/rate*1000):now+piece.length/rate*1000;
   return new Promise(resolve=>{timer=setTimeout(()=>{if(!closed){wireBytes+=piece.length;controller.enqueue(piece);}resolve();},Math.max(0,due-now));});
  },cancel(){closed=true;clearTimeout(timer);}});
  return new Response(body,{status:206,headers:{'content-range':`bytes ${r.start}-${r.end}/${SIZE}`,'content-length':String(r.length)}});
 };
 const url='https://test.bilivideo.com/v.m4s',urls=()=>[url],r={urls,ordered:urls,rangeCandidates:urls,startupCandidates:urls,rescueCandidates:urls,allows:()=>true,speed:()=>0,sample(){},success(){},failure(_u,e){throw e;}};
 const d=c.__BILI_IDM_DOWNLOADER_FACTORY__.createDownloader({nativeFetch:transport,getSettings:()=>({autoConcurrency:false,concurrency:8,smartPolicy:false})});
 const t=performance.now(),result=await d.downloadRange({start:0,end:SIZE-1,length:SIZE},r,{parallel});
 const ms=performance.now()-t;assert.equal(hash(result.bytes),hash(data));assert.equal(wireBytes,SIZE);
 return{elapsed_ms:Math.round(ms),requests,wire_bytes:wireBytes,pieces:result.pieceCount,sha256:hash(result.bytes)};
}
(async()=>{const all=[];for(const model of ['per_request_limit','shared_link_limit']){const single=[],parallel=[];for(let i=0;i<3;i++){single.push(await trial(model,false));parallel.push(await trial(model,true));}const median=a=>[...a].map(x=>x.elapsed_ms).sort((a,b)=>a-b)[1];const s=median(single),p=median(parallel);const out={model,single,parallel,median_single_ms:s,median_parallel_ms:p,ratio:Number((s/p).toFixed(3))};all.push(out);console.log(model,`${s} ms / ${p} ms = ${out.ratio}x`);}
 const result={scope:'Synthetic in-memory transport model only. NOT real Bilibili performance, NOT a speedup of this fork over upstream.',node:process.version,parameters:{payload_bytes:SIZE,packet_bytes:PACKET,request_header_delay_ms:RTT,per_request_limit_bytes_s:256*1024,shared_link_limit_bytes_s:1024*1024,manual_concurrency:8,repeats:3},results:all};fs.writeFileSync(path.join(__dirname,'benchmark-results.json'),JSON.stringify(result,null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
