/* TEST ONLY. Browser APIs are mocked; this file is never loaded by the extension manifest. */
(()=>{
 // The extension waits for Vue hydration (hydration-signal.js); fixtures have no Vue, so they are hydrated at once.
 document.documentElement.setAttribute('data-btr-hydrated','fixture');
 const all={sync:{},local:{}},listeners=[],messages=[];
 window.fixtureStorage={all,reads:0,writes:0,fail:false,delay:0};
 const copy=x=>structuredClone(x);
 const area=name=>({
  async get(keys,callback){fixtureStorage.reads++;let out;
   if(keys===null)out=copy(all[name]);
   else if(typeof keys==='string')out={[keys]:copy(all[name][keys])};
   else if(Array.isArray(keys))out=Object.fromEntries(keys.map(k=>[k,copy(all[name][k])]));
   else out={...copy(keys),...Object.fromEntries(Object.keys(keys||{}).filter(k=>k in all[name]).map(k=>[k,copy(all[name][k])]))};
   if(callback)callback(out);return out;
  },
  async set(obj){if(name==='local'&&fixtureStorage.delay)await new Promise(r=>setTimeout(r,fixtureStorage.delay));if(name==='local'&&fixtureStorage.fail)throw Error('Synthetic storage quota failure');fixtureStorage.writes++;
   const changes={};for(const[k,v]of Object.entries(obj)){changes[k]={oldValue:copy(all[name][k]),newValue:copy(v)};all[name][k]=copy(v);}queueMicrotask(()=>listeners.forEach(f=>f(changes,name)));
  },
  async remove(keys){const changes={};for(const k of [].concat(keys)){changes[k]={oldValue:copy(all[name][k])};delete all[name][k];}queueMicrotask(()=>listeners.forEach(f=>f(changes,name)));}
 });
 let permissions=false,proxyValue={mode:'system'},level='controllable_by_this_extension';window.permissionRequests=0;window.proxyCalls=[];window.optionCalls=0;
 window.chromeMock={storage:{sync:area('sync'),local:area('local'),onChanged:{addListener:f=>listeners.push(f)}},
  runtime:{id:'fixture-not-real-extension',lastError:null,onMessage:{addListener:f=>messages.push(f)},sendMessage:async()=>{window.optionCalls++;},openOptionsPage:async()=>{window.optionCalls++;}},
  permissions:{contains:async()=>permissions,request:async()=>{permissionRequests++;permissions=true;return true;},remove:async()=>{permissions=false;return true;}},
  proxy:{settings:{get:(_d,cb)=>cb({value:proxyValue,levelOfControl:level}),set:(d,cb)=>{proxyValue=d.value;level='controlled_by_this_extension';proxyCalls.push(d);cb();},clear:(_d,cb)=>{proxyValue={mode:'system'};level='controllable_by_this_extension';cb();}}}
 };
})();
