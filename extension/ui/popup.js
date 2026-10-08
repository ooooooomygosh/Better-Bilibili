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
init().catch(e=>$('message').textContent=e.message);setInterval(update,1000);
