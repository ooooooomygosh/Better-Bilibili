'use strict';
const $=id=>document.getElementById(id);let tab;
async function init(){
 const s=await chrome.storage.sync.get({enabled:true,strategy:'auto',mode:'auto'});
 $('enabled').checked=s.enabled;$('strategy').value=s.strategy;$('mode').value=s.mode;
 [tab]=await chrome.tabs.query({active:true,currentWindow:true});await update();
}
for(const k of ['enabled','strategy','mode'])$(k).addEventListener('change',async()=>{
 try{await chrome.storage.sync.set({[k]:k==='enabled'?$(k).checked:$(k).value});$('message').textContent='已保存。新请求使用更新后的策略。';}catch(e){$('message').textContent=e.message;}
});
$('options').onclick=()=>chrome.runtime.openOptionsPage();
$('native').onclick=async()=>{try{await chrome.tabs.sendMessage(tab.id,{type:'openSettings'});window.close();}catch(_){$('message').textContent='请先打开或刷新 B 站页面。';}};
async function update(){
 try{
  if(!tab?.id)return;const d=await chrome.tabs.sendMessage(tab.id,{type:'flow-get-state'}),s=d.stats,t=d.telemetry;
  if(s){$('speed').textContent=(Math.max(0,Number(s.totalSpeedBps)||0)/1048576).toFixed(2);$('buffer').textContent=Math.max(0,Number(s.bufferedAhead)||0).toFixed(1);$('threads').textContent=String(Math.max(0,Number(s.activeThreads)||0));}
  $('profile').textContent=t?.policy?.name?`${t.policy.name} · 自动并发上限 ${t.policy.cap} · 缓冲目标 ${t.policy.ahead}s`:(d.home?`首页已保存 ${d.historyCount} 批推荐`:'等待播放器准备');
  $('warning').textContent=t?.policy?.decodeWarning?'缓冲充足但掉帧偏多：更可能是解码问题。可在播放器播放策略中试 HEVC / AVC。':s?.lastError||'';
 }catch(_){$('profile').textContent='请在 B 站页面使用；刚安装后需要刷新页面。';}
}
async function focus(){
 try{const r=await chrome.runtime.sendMessage({type:'focus-check'}),box=$('focusUsage');if(!r||r.error||!r.enabled){box.replaceChildren();return;}
  const f=globalThis.__BTR_FOCUS_CORE__,rows=[];
  if(r.timeLimit)rows.push(['今日观看',r.seconds/r.timeLimit,`${f.fmt(r.seconds)} / ${f.fmt(r.timeLimit)}`]);else rows.push(['今日观看',0,f.fmt(r.seconds)]);
  if(r.videoLimit)rows.push(['今日视频',r.videos/r.videoLimit,`${r.videos} / ${r.videoLimit} 个`]);
  box.replaceChildren(...rows.map(([label,ratio,text])=>{const row=document.createElement('div'),head=document.createElement('div'),l=document.createElement('span'),b=document.createElement('b'),m=document.createElement('div'),i=document.createElement('i');
   head.className='usage-head';l.textContent=label;b.textContent=text;head.append(l,b);m.className='meter';i.style.width=Math.min(100,ratio*100)+'%';if(ratio>=1)i.className='full';m.append(i);row.append(head,m);return row;}));
 }catch(_){}
}
focus();setInterval(focus,3000);
init().catch(e=>$('message').textContent=e.message);setInterval(update,1000);
