'use strict';
const $=id=>document.getElementById(id);
const ui=globalThis.__BTR_UI__,focusCore=globalThis.__BTR_FOCUS_CORE__,homeCore=globalThis.__BTR_HOME_CORE__,lockCore=globalThis.__BTR_LOCK_CORE__;
const defaults={enabled:true,liveEnabled:true,autoConcurrency:true,smartPolicy:true,strategy:'auto',mode:'auto',maxAutoThreads:32,memoryBudgetMB:64,takeover:'full',...homeCore.defaults,...focusCore.defaults,quickFab:true};
const FOCUS=new Set(Object.keys(focusCore.defaults));
const RELOAD=new Set(['takeover','enabled','liveEnabled']);

/* ---------- save status (sticky bar) ---------- */
let savingCount=0;
function status(text,kind){
 const bar=$('savebar');bar.classList.toggle('saving',kind==='saving');bar.classList.toggle('error',kind==='error');
 ui.flash($('saved'),text,kind==='error'?'error':kind==='ok'?'ok':'');
}
function read(k){const n=$(k),v=defaults[k];return typeof v==='boolean'?n.checked:typeof v==='number'?Number(n.value):n.value;}
function write(k,val){const n=$(k);if(!n||n===document.activeElement&&n.type==='number')return;if(typeof defaults[k]==='boolean')n.checked=!!val;else n.value=String(val);}
function populate(s){for(const k of Object.keys(defaults))write(k,s[k]);}
async function load(){const s=await chrome.storage.sync.get(defaults);populate({...s,...homeCore.settings(s),...focusCore.settings(s)});}

// Watch-limit keys go through the service worker so the self-discipline lock can hold back loosening.
async function saveFocus(changes,password){
 const r=await chrome.runtime.sendMessage({type:'focus-set',changes,password});
 if(r?.error)throw new Error(r.error);
 if(r?.lock)renderLock(r.lock);
 const later=Object.values(r?.deferred||{});
 if(later.length){await load();status(`🔒 自律锁：放宽的改动已排队，将在 ${focusCore.fmtReset(Math.max(...later))} 生效（或在下方输入密码立即生效）。`,'ok');return false;}
 return true;
}
async function save(changes){
 savingCount++;status('正在保存…','saving');
 try{
  const f={},o={};for(const[k,v]of Object.entries(changes))(FOCUS.has(k)?f:o)[k]=v;
  if(Object.keys(o).length)await chrome.storage.sync.set(o);
  let plain=true;if(Object.keys(f).length)plain=await saveFocus(f);
  if(plain){
   const reload=Object.keys(changes).some(k=>RELOAD.has(k));
   status(reload?'已自动保存。播放内核与加速开关在刷新视频页后生效。':'已自动保存。','ok');
  }
 }catch(e){status(`没保存上：${e.message}`,'error');await load().catch(()=>{});}
 finally{savingCount--;}
}
$('settings').addEventListener('submit',e=>e.preventDefault()); // Enter in a field must not reload the page.
// Every control saves on its own "change" (number fields on blur / Enter, so typing 9 → 90 never saves 9).
$('settings').addEventListener('change',e=>{
 const k=e.target?.id;if(!k||!(k in defaults))return;
 save({[k]:read(k)});
});
$('restore').onclick=async()=>{
 if(!confirm('把所有设置恢复为默认值？不会清除推荐历史、用量记录或代理设置。'))return;
 await save({...defaults});await load();
};
$('clearHistory').onclick=async()=>{if(!confirm('确定清空本扩展保存的全部推荐历史？此操作无法撤销。'))return;try{await chrome.storage.local.set({flowHistoryClearedAt:Date.now()});const all=await chrome.storage.local.get(null);const keys=Object.keys(all).filter(k=>k.startsWith('flowHistory:'));await chrome.storage.local.remove(keys);status(`已清空 ${keys.length} 组推荐历史；之后刷到的推荐仍会记录，关闭“保存推荐批次”可停止。`,'ok');}catch(e){status(e.message,'error');}};
for(const b of document.querySelectorAll('[data-preset]'))b.onclick=()=>{const[m,w,v,sm,br]=b.dataset.preset.split(',').map(Number);save({focusWindowMinutes:m,focusWeeklyHours:w,focusWindowVideos:v,focusSessionMinutes:sm,focusBreakMinutes:br,focusEnabled:true}).then(load);};
// Changes made elsewhere (popup, quick panel, the lock's own revert) show up here at once.
chrome.storage.onChanged.addListener((changes,area)=>{
 if(area==='sync'){const s={};for(const k of Object.keys(defaults))if(changes[k])s[k]=changes[k].newValue;if(Object.keys(s).length&&!savingCount)load().catch(()=>{});}
 if(area==='local'&&changes.focusLock)refreshLock();
});

/* ---------- proxy (unchanged behaviour) ---------- */
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
 }catch(e){ui.flash($('proxyStatus'),e.message,'error');}finally{b.disabled=false;}
};
$('disableProxy').onclick=async()=>{try{
 if(await chrome.permissions.contains({permissions:['proxy']})){await proxyCall('clear',{scope:'regular_only'});await chrome.permissions.remove({permissions:['proxy']});}
 await chrome.storage.local.remove('flowProxy');ui.flash($('proxyStatus'),'已清除本扩展代理设置，并撤销本扩展代理权限。','ok');
}catch(e){ui.flash($('proxyStatus'),e.message,'error');}};
proxyState().catch(e=>$('proxyStatus').textContent=e.message);

/* ---------- self-discipline lock ---------- */
let lock={locked:false};
const lockSay=(t,k)=>ui.flash($('lockStatus'),t,k);
const send=async m=>{const r=await chrome.runtime.sendMessage(m);if(r?.error)throw new Error(r.error);return r;};
function renderLock(v){
 lock=v||{locked:false};
 $('lockOff').hidden=lock.locked;$('lockOn').hidden=!lock.locked;
 $('lockPill').textContent=lock.locked?'已开启':'未开启';
 document.querySelectorAll('[data-lock-badge]').forEach(n=>n.hidden=!lock.locked);
 if(!lock.locked)return;
 $('lockSummary').textContent=`开启于 ${new Date(lock.createdAt).toLocaleString()} · 冷却期 ${lock.cooldownHours} 小时 · ${lock.hasPassword?'已设置密码':'未设置密码（只能等冷却期）'}${lock.lockoutUntil?` · 密码输错太多次，${focusCore.fmtReset(lock.lockoutUntil)} 后可再试`:''}`;
 if(document.activeElement!==$('lockCooldownOn'))$('lockCooldownOn').value=String(lock.cooldownHours);
 $('lockAuth').closest('.field').hidden=!lock.hasPassword;
 const ul=$('lockPending');ul.replaceChildren();
 const entries=Object.entries(lock.pending||{});
 for(const[k,p]of entries){
  const li=document.createElement('li'),t=document.createElement('span'),sm=document.createElement('small'),c=document.createElement('button');
  t.textContent=lockCore.describe(k,p.value);sm.textContent=`${focusCore.fmtReset(p.effectiveAt)} 生效 · 还要 ${focusCore.fmtLeft(p.effectiveAt-Date.now())}`;t.append(sm);
  c.type='button';c.className='small';c.textContent='撤销';c.onclick=async()=>{try{renderLock(await send({type:'lock-cancel',key:k}));lockSay('已撤销这项放宽。','ok');await load();}catch(e){lockSay(e.message,'error');}};
  li.append(t,c);ul.append(li);
 }
 $('lockApplyNow').hidden=!(entries.length&&lock.hasPassword);
 $('lockRemove').textContent=lock.pending?.remove?'解除自律锁（已排队）':'解除自律锁';
}
async function refreshLock(){try{renderLock(await send({type:'lock-state'}));}catch(_){}}
$('lockCreate').onclick=async()=>{
 const pw=$('lockPassword').value,pw2=$('lockPassword2').value;
 try{
  if(pw!==pw2)throw new Error('两次输入的密码不一样。');
  if(pw&&pw.length<4)throw new Error('密码至少 4 位。');
  const cd=Number($('lockCooldown').value);
  if(!confirm(`开启自律锁后，放宽额度要等 ${cd} 小时${pw?'（或输入密码）':''}才生效，包括解除自律锁本身。确定开启？`))return;
  renderLock(await send({type:'lock-create',newPassword:pw,cooldownHours:cd}));
  $('lockPassword').value=$('lockPassword2').value='';
  lockSay('自律锁已开启。收紧随时生效，放宽要等冷却期。','ok');await load();
 }catch(e){lockSay(e.message,'error');}
};
const auth=()=>$('lockAuth').value;
$('lockCooldownOn').onchange=async e=>{
 try{const r=await send({type:'lock-cooldown',cooldownHours:Number(e.target.value),password:auth()});renderLock(r);
  lockSay(r.deferredAt?`缩短冷却期已排队，将在 ${focusCore.fmtReset(r.deferredAt)} 生效。`:'冷却期已更新。','ok');}
 catch(err){lockSay(err.message,'error');refreshLock();}
};
$('lockApplyNow').onclick=async()=>{
 const p=lock.pending||{},changes={};for(const[k,x]of Object.entries(p))if(FOCUS.has(k))changes[k]=x.value;
 try{
  if(!auth())throw new Error('请先输入自律锁密码。');
  if(Object.keys(changes).length){const r=await send({type:'focus-set',changes,password:auth()});renderLock(r.lock);}
  if(p.cooldownHours)renderLock(await send({type:'lock-cooldown',cooldownHours:p.cooldownHours.value,password:auth()}));
  if(p.remove)renderLock(await send({type:'lock-remove',password:auth()}));
  $('lockAuth').value='';lockSay('密码正确，等待中的改动已立即生效。','ok');await load();
 }catch(e){lockSay(e.message,'error');}
};
$('lockChangePw').onclick=async()=>{
 const next=prompt(lock.hasPassword?'输入新密码（至少 4 位）。需要先在“自律锁密码”里填当前密码。':'设置一个密码（至少 4 位）。设置后，输入密码可以让放宽立即生效。');
 if(next==null)return;
 try{renderLock(await send({type:'lock-password',newPassword:next,password:auth()}));$('lockAuth').value='';lockSay('密码已更新。','ok');}catch(e){lockSay(e.message,'error');}
};
$('lockRemove').onclick=async()=>{
 try{
  const pw=auth();
  if(!pw&&!confirm(`没有输入密码：解除会在 ${lock.cooldownHours} 小时冷却期后生效（忘记密码也走这条路）。现在排队解除？`))return;
  const r=await send({type:'lock-remove',password:pw});renderLock(r);$('lockAuth').value='';
  lockSay(r.locked?`解除已排队，将在 ${focusCore.fmtReset(r.deferredAt)} 生效；期间随时可以撤销。`:'自律锁已解除。','ok');
 }catch(e){lockSay(e.message,'error');}
};

/* ---------- usage meters: built once, updated in place ---------- */
const meters={};
function meter(id,label){
 if(meters[id])return meters[id];
 const row=document.createElement('div'),head=document.createElement('div'),l=document.createElement('span'),t=document.createElement('b'),track=document.createElement('div'),fill=document.createElement('i'),foot=document.createElement('div');
 row.className='usage-row';head.className='usage-head';l.textContent=label;head.append(l,t);track.className='meter';fill.style.transform='scaleX(0)';track.append(fill);foot.className='usage-foot';row.append(head,track,foot);
 $('focusUsage').append(row);return(meters[id]={row,t,fill,foot});
}
function paint(id,label,m,f,extra){
 const x=meter(id,label);x.t.textContent=m.limit?`已用 ${m.percent}%`:`已看 ${f.fmt(m.seconds)}`;
 requestAnimationFrame(()=>{x.fill.style.transform=`scaleX(${(m.limit?m.percent:0)/100})`;});
 x.fill.classList.toggle('full',!!(m.limit&&m.seconds>=m.limit));
 x.foot.textContent=(m.limit?`${f.fmt(m.seconds)} / ${f.fmt(m.limit)}`:'不限')+(extra||'')+` · ${f.fmtReset(m.resetAt)}${m.resetAt?' 重置':''}`;
}
async function focusUsage(){try{const r=await chrome.runtime.sendMessage({type:'focus-check'});if(!r||r.error||!r.window)return;
 paint('w','当前 5 小时窗口',r.window,focusCore,r.videoLimit?` · 视频 ${r.videos}/${r.videoLimit}`:'');paint('k','本周',r.week,focusCore);
 let sn=$('focusUsage').querySelector('.snoozes');if(r.snoozes){if(!sn){sn=document.createElement('p');sn.className='hint snoozes';$('focusUsage').append(sn);}sn.textContent=`这个窗口里已经“再看”了 ${r.snoozes} 次`;}else sn?.remove();
}catch(_){}}

/* ---------- sticky section nav ---------- */
const links=[...document.querySelectorAll('.toc a')];
const io=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){links.forEach(a=>a.setAttribute('aria-current',String(a.getAttribute('href')==='#'+e.target.id)));}},{rootMargin:'-30% 0px -60% 0px'});
for(const a of links){const t=document.querySelector(a.getAttribute('href'));if(t)io.observe(t);
 a.addEventListener('click',e=>{const t=document.querySelector(a.getAttribute('href'));if(!t)return;e.preventDefault();t.scrollIntoView({behavior:ui.reduced.matches?'auto':'smooth',block:'start'});history.replaceState(null,'',a.getAttribute('href'));});}

load().catch(e=>status(e.message,'error'));refreshLock();focusUsage();setInterval(focusUsage,5000);setInterval(()=>{if(lock.locked)refreshLock();},30000);
if(location.hash)requestAnimationFrame(()=>document.querySelector(location.hash)?.scrollIntoView({block:'start'}));
