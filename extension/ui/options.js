'use strict';
const $=id=>document.getElementById(id);
const defaults={enabled:true,liveEnabled:true,autoConcurrency:true,smartPolicy:true,strategy:'auto',mode:'auto',maxAutoThreads:32,memoryBudgetMB:64,takeover:'full',...globalThis.__BTR_HOME_CORE__.defaults};
function populate(s){for(const[k,v]of Object.entries(defaults))if(typeof v==='boolean')$(k).checked=s[k];else $(k).value=String(s[k]);}
chrome.storage.sync.get(defaults).then(s=>populate({...s,...globalThis.__BTR_HOME_CORE__.settings(s)})).catch(e=>$('saved').textContent=e.message);
$('settings').onsubmit=async e=>{e.preventDefault();try{const out={};for(const[k,v]of Object.entries(defaults))out[k]=typeof v==='boolean'?$(k).checked:typeof v==='number'?Number($(k).value):$(k).value;await chrome.storage.sync.set(out);$('saved').textContent='已保存。下载策略在后续请求中生效；若更换播放内核，请刷新视频页。';}catch(err){$('saved').textContent=err.message;}};
$('restore').onclick=async()=>{try{await chrome.storage.sync.set(defaults);populate(defaults);$('saved').textContent='已恢复默认设置；没有改动代理或清除历史。';}catch(e){$('saved').textContent=e.message;}};
$('clearHistory').onclick=async()=>{try{await chrome.storage.local.set({flowHistoryClearedAt:Date.now()});const all=await chrome.storage.local.get(null);const keys=Object.keys(all).filter(k=>k.startsWith('flowHistory:'));await chrome.storage.local.remove(keys);$('saved').textContent=`已清空 ${keys.length} 组推荐历史；之后刷到的推荐仍会记录，关闭“保存推荐批次”可停止。`;}catch(e){$('saved').textContent=e.message;}};
const proxyCall=(method,details)=>new Promise((resolve,reject)=>{chrome.proxy.settings[method](details,result=>{const e=chrome.runtime.lastError;if(e)reject(new Error(e.message));else resolve(result);});});
async function proxyState(){
 const data=await chrome.storage.local.get('flowProxy');if(data.flowProxy?.url)$('proxyUrl').value=data.flowProxy.url;
 if(!await chrome.permissions.contains({permissions:['proxy']})){$('proxyStatus').textContent='未授权 / 未启用；浏览器代理保持不变。';return;}
 const s=await proxyCall('get',{incognito:false});$('proxyStatus').textContent=s.levelOfControl==='controlled_by_this_extension'?'本扩展的代理分流已配置。线路是否可用，需要在真实 B 站页面验证。':`本扩展未控制当前代理（${s.levelOfControl}）。`;
}
$('enableProxy').onclick=async()=>{
 const b=$('enableProxy');try{
  if(!$('proxyConsent').checked)throw new Error('请先阅读并勾选代理影响说明。');
  const url=$('proxyUrl').value.trim(),pac=globalThis.__BTR_PROXY_CORE__.pac(url);
  const granted=await chrome.permissions.request({permissions:['proxy']});if(!granted)throw new Error('未获得代理权限，配置没有更改。');
  b.disabled=true;const s=await proxyCall('get',{incognito:false});
  if(!['controllable_by_this_extension','controlled_by_this_extension'].includes(s.levelOfControl))throw new Error('代理正由其他扩展或管理策略控制，未覆盖。请保留原来的分流方式。');
  await proxyCall('set',{value:{mode:'pac_script',pacScript:{data:pac,mandatory:true}},scope:'regular_only'});
  await chrome.storage.local.set({flowProxy:{url,at:Date.now()}});await proxyState();
 }catch(e){$('proxyStatus').textContent=e.message;}finally{b.disabled=false;}
};
$('disableProxy').onclick=async()=>{try{
 if(await chrome.permissions.contains({permissions:['proxy']})){await proxyCall('clear',{scope:'regular_only'});await chrome.permissions.remove({permissions:['proxy']});}
 await chrome.storage.local.remove('flowProxy');$('proxyStatus').textContent='已清除本扩展代理设置，并撤销本扩展代理权限。';
}catch(e){$('proxyStatus').textContent=e.message;}};
proxyState().catch(e=>$('proxyStatus').textContent=e.message);
