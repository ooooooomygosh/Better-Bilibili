'use strict';
const $=id=>document.getElementById(id);let tab=null;
const ui=globalThis.__BTR_UI__,f=globalThis.__BTR_FOCUS_CORE__;
const say=(t,k)=>ui.flash($('message'),t,k);
async function init(){
 const s=await chrome.storage.sync.get({enabled:true,strategy:'auto',mode:'auto'});
 $('enabled').checked=s.enabled;$('strategy').value=s.strategy;$('mode').value=s.mode;
 [tab]=await chrome.tabs.query({active:true,currentWindow:true});await update();
}
for(const k of ['enabled','strategy','mode'])$(k).addEventListener('change',async()=>{
 try{
  await chrome.storage.sync.set({[k]:k==='enabled'?$(k).checked:$(k).value});
  say(k==='enabled'?($(k).checked?'已开启视频加速。':'已关闭视频加速。'):'已保存。新的请求会使用更新后的策略。','ok');
  // The player hooks are installed when the page starts, so the master switch needs a reload.
  if(k==='enabled'&&tab?.id&&reachable)$('reload').hidden=false;
 }catch(e){say(e.message,'error');}
});
// 空降助手: the content script listens to storage changes, so this takes effect at once (no reload).
chrome.storage.sync.get({sbEnabled:true}).then(s=>{$('sbEnabled').checked=s.sbEnabled;});
$('sbEnabled').addEventListener('change',async()=>{try{const on=$('sbEnabled').checked;await chrome.storage.sync.set({sbEnabled:on,sbChosen:true});say(on?'空降助手已开启，当前视频立即生效。':'空降助手已关闭。','ok');}catch(e){say(e.message,'error');}});
$('reloadBtn').onclick=async()=>{try{await chrome.tabs.reload(tab.id);window.close();}catch(e){say(e.message,'error');}};
$('options').onclick=()=>chrome.runtime.openOptionsPage();
$('quick').onclick=async()=>{try{await chrome.tabs.sendMessage(tab.id,{type:'flow-quick-open'});window.close();}catch(_){say('请先打开或刷新 B 站页面，快捷面板在页面右下角。','error');}};
let reachable=false;
// Read live from the tab every second: infinite-feed batches (current / loaded) and 换一批 history are different things.
function homeLine(d){
 const f=d.feed,parts=['首页'];
 if(f&&f.loaded>1)parts.push(`无限下滑：正在看第 ${f.current} 批，已加载 ${f.loaded} 批${f.paused?'（已暂停）':f.loading?'（加载中…）':''}`);
 else if(f)parts.push('无限下滑已开启，往下滑自动加载');
 if(d.historyCount>1)parts.push(`换一批记录 ${d.historyCount} 组，可回看`);
 if(parts.length===1)parts.push('打开视频后这里显示下载速度和缓冲');
 return parts.join(' · ');
}
async function update(){
 try{
  if(!tab?.id)return;const d=await chrome.tabs.sendMessage(tab.id,{type:'flow-get-state'}),s=d.stats,t=d.telemetry;reachable=true;
  // Live numbers only mean something on a playing video; elsewhere show one honest line instead of three dashes.
  const live=!!s&&(Number(s.totalSpeedBps)>0||Number(s.bufferedAhead)>0||Number(s.activeThreads)>0||!!t?.policy?.name);
  $('metrics').hidden=!live;
  if(live){$('speed').textContent=(Math.max(0,Number(s.totalSpeedBps)||0)/1048576).toFixed(2);$('buffer').textContent=Math.max(0,Number(s.bufferedAhead)||0).toFixed(1);$('threads').textContent=String(Math.max(0,Number(s.activeThreads)||0));}
  $('profile').textContent=t?.policy?.name?`${t.policy.name} · 自动并发上限 ${t.policy.cap} · 缓冲目标 ${t.policy.ahead}s`:(d.home?homeLine(d):'这个页面没有正在播放的视频；打开视频后这里显示下载速度和缓冲。');
  $('warning').textContent=t?.policy?.decodeWarning?'缓冲充足但掉帧偏多：更可能是解码问题。可在播放器播放策略中试 HEVC / AVC。':s?.lastError||'';
 }catch(_){reachable=false;$('metrics').hidden=true;$('profile').textContent='在 B 站页面打开这里能看到实时状态；刚安装后需要刷新页面。';}
}
// Meters are built once and then updated in place, so the bars glide instead of re-growing.
const meters={};
function meter(id,label){
 if(meters[id])return meters[id];
 const el=document.createElement('div'),head=document.createElement('div'),l=document.createElement('span'),b=document.createElement('b'),bar=document.createElement('div'),i=document.createElement('i'),foot=document.createElement('div');
 head.className='usage-head';l.textContent=label;head.append(l,b);bar.className='meter';i.style.transform='scaleX(0)';bar.append(i);foot.className='usage-foot';el.append(head,bar,foot);
 $('focusUsage').append(el);return(meters[id]={el,b,i,foot});
}
function paint(id,label,m,extra=''){
 const x=meter(id,label);x.b.textContent=m.limit?`${m.percent}%`:f.fmt(m.seconds);
 requestAnimationFrame(()=>{x.i.style.transform=`scaleX(${(m.limit?m.percent:0)/100})`;});
 x.i.classList.toggle('full',!!(m.limit&&m.seconds>=m.limit));
 x.foot.textContent=`${f.fmtReset(m.resetAt)}${m.resetAt?' 重置':''}${extra}`;
}
async function focus(){
 try{
  const [r,lock]=await Promise.all([chrome.runtime.sendMessage({type:'focus-check'}),chrome.runtime.sendMessage({type:'lock-state'})]);
  const ll=$('lockline');ll.hidden=!lock?.locked;
  if(lock?.locked){const n=Object.keys(lock.pending||{}).length;ll.textContent=`🔒 自律锁开启中 · 放宽需要 ${lock.cooldownHours} 小时冷却${lock.hasPassword?'或密码':''}${n?` · ${n} 项放宽等待生效`:''}`;}
  if(!r||r.error||!r.enabled||!r.window){$('focusUsage').replaceChildren();for(const k in meters)delete meters[k];return;}
  paint('w','5 小时窗口',r.window,r.videoLimit?` · 视频 ${r.videos}/${r.videoLimit}`:'');paint('k','本周',r.week);
 }catch(_){}
}
focus();setInterval(focus,3000);
init().catch(e=>say(e.message,'error'));setInterval(update,1000);
