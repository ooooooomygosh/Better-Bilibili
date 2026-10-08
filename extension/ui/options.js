'use strict';
const $=id=>document.getElementById(id);
const defaults={enabled:true,liveEnabled:true,autoConcurrency:true,smartPolicy:true,strategy:'auto',mode:'auto',maxAutoThreads:32,memoryBudgetMB:64,takeover:'full',...globalThis.__BTR_HOME_CORE__.defaults,...globalThis.__BTR_FOCUS_CORE__.defaults,quickFab:true};
const focusCore=globalThis.__BTR_FOCUS_CORE__;
function populate(s){for(const[k,v]of Object.entries(defaults))if(typeof v==='boolean')$(k).checked=s[k];else $(k).value=String(s[k]);}
chrome.storage.sync.get(defaults).then(s=>populate({...s,...globalThis.__BTR_HOME_CORE__.settings(s),...focusCore.settings(s)})).catch(e=>$('saved').textContent=e.message);
$('settings').onsubmit=async e=>{e.preventDefault();try{const out={};for(const[k,v]of Object.entries(defaults))out[k]=typeof v==='boolean'?$(k).checked:typeof v==='number'?Number($(k).value):$(k).value;Object.assign(out,focusCore.settings(out));populate(out);await chrome.storage.sync.set(out);$('saved').classList.remove('dirty');$('saved').textContent='已保存。下载策略在后续请求中生效；若更换播放内核，请刷新视频页。';}catch(err){$('saved').textContent=err.message;}};
$('restore').onclick=async()=>{try{await chrome.storage.sync.set(defaults);populate(defaults);$('saved').classList.remove('dirty');$('saved').textContent='已恢复默认设置；没有改动代理或清除历史。';}catch(e){$('saved').textContent=e.message;}};
$('clearHistory').onclick=async()=>{if(!confirm('确定清空本扩展保存的全部推荐历史？此操作无法撤销。'))return;try{await chrome.storage.local.set({flowHistoryClearedAt:Date.now()});const all=await chrome.storage.local.get(null);const keys=Object.keys(all).filter(k=>k.startsWith('flowHistory:'));await chrome.storage.local.remove(keys);$('saved').textContent=`已清空 ${keys.length} 组推荐历史；之后刷到的推荐仍会记录，关闭“保存推荐批次”可停止。`;}catch(e){$('saved').textContent=e.message;}};
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
$('settings').addEventListener('change',()=>{$('saved').classList.add('dirty');$('saved').textContent='有未保存的更改，点击“保存设置”后生效。';});
for(const b of document.querySelectorAll('[data-preset]'))b.onclick=()=>{const[m,w,v,sm,br]=b.dataset.preset.split(',');$('focusWindowMinutes').value=m;$('focusWeeklyHours').value=w;$('focusWindowVideos').value=v;$('focusSessionMinutes').value=sm;$('focusBreakMinutes').value=br;$('focusEnabled').checked=true;$('settings').dispatchEvent(new Event('change'));};
// Usage bars styled after Claude Code's /usage: percentage used plus when each period resets.
function usageRows(r,f){
 const rows=[];const add=(label,m,extra)=>{const row=document.createElement('div');row.className='usage-row';const head=document.createElement('div');head.className='usage-head';const l=document.createElement('span');l.textContent=label;const t=document.createElement('b');t.textContent=m.limit?`已用 ${m.percent}%`:`已看 ${f.fmt(m.seconds)}`;head.append(l,t);const track=document.createElement('div');track.className='meter';const fill=document.createElement('i');fill.style.width=(m.limit?m.percent:0)+'%';if(m.limit&&m.seconds>=m.limit)fill.className='full';track.append(fill);const foot=document.createElement('div');foot.className='usage-foot';foot.textContent=(m.limit?`${f.fmt(m.seconds)} / ${f.fmt(m.limit)}`:'不限')+(extra||'')+` · ${f.fmtReset(m.resetAt)}${m.resetAt?' 重置':''}`;row.append(head,track,foot);rows.push(row);};
 add('当前 5 小时窗口',r.window,r.videoLimit?` · 视频 ${r.videos}/${r.videoLimit}`:'');add('本周',r.week);
 if(r.snoozes){const p=document.createElement('p');p.className='hint';p.textContent=`这个窗口里已经“再看”了 ${r.snoozes} 次`;rows.push(p);}
 return rows;
}
async function focusUsage(){try{const r=await chrome.runtime.sendMessage({type:'focus-check'});if(!r||r.error||!r.window)return;$('focusUsage').replaceChildren(...usageRows(r,focusCore));}catch(_){}}
focusUsage();setInterval(focusUsage,5000);
