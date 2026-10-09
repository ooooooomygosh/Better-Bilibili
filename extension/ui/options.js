'use strict';
const $=id=>document.getElementById(id);
const ui=globalThis.__BTR_UI__,focusCore=globalThis.__BTR_FOCUS_CORE__,homeCore=globalThis.__BTR_HOME_CORE__,lockCore=globalThis.__BTR_LOCK_CORE__;
const defaults={enabled:true,liveEnabled:true,autoConcurrency:true,smartPolicy:true,strategy:'auto',mode:'auto',maxAutoThreads:32,memoryBudgetMB:64,takeover:'full',...homeCore.defaults,...focusCore.defaults,quickFab:true};
const FOCUS=new Set(Object.keys(focusCore.defaults));
const RELOAD=new Set(['takeover','enabled','liveEnabled']);

/* ---------- in-page dialog (replaces confirm / prompt; focus trap, Esc, labelled) ---------- */
let dialogOpen=null;
function dialog({title,text,ok='确定',cancel='取消',danger=false,fields=[]}){
 if(dialogOpen)dialogOpen.close(null);
 return new Promise(resolve=>{
  const back=document.createElement('div'),box=document.createElement('div'),h=document.createElement('h3'),p=document.createElement('p'),acts=document.createElement('div'),err=document.createElement('p');
  back.className='modal-back';box.className='modal';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');
  const id='dlg-'+Math.random().toString(36).slice(2);h.id=id+'-t';p.id=id+'-d';box.setAttribute('aria-labelledby',h.id);box.setAttribute('aria-describedby',p.id);
  h.textContent=title;p.textContent=text||'';p.className='muted';err.className='field-error';err.hidden=true;err.setAttribute('role','alert');box.append(h,p);
  const inputs=fields.map(f=>{const l=document.createElement('label'),i=document.createElement('input');l.className='field';const t=document.createElement('span');t.textContent=f.label;i.type=f.type||'text';i.autocomplete=f.autocomplete||'off';if(f.placeholder)i.placeholder=f.placeholder;l.append(t,i);box.append(l);return i;});
  box.append(err);
  const no=document.createElement('button'),yes=document.createElement('button');no.type=yes.type='button';no.textContent=cancel;yes.textContent=ok;yes.className=danger?'primary danger-fill':'primary';
  acts.className='actions';acts.append(no,yes);box.append(acts);back.append(box);document.body.append(back);
  const before=document.activeElement;document.querySelector('main')?.setAttribute('inert','');
  ui.animate(back,[{opacity:0},{opacity:1}],{duration:ui.MOTION.fast});ui.animate(box,[{opacity:0,transform:'translateY(8px) scale(.98)'},{opacity:1,transform:'none'}],{duration:ui.MOTION.mid});
  const close=v=>{if(dialogOpen!==api)return;dialogOpen=null;document.querySelector('main')?.removeAttribute('inert');document.removeEventListener('keydown',key,true);ui.fadeOut(back,ui.MOTION.fast);before?.focus?.({preventScroll:true});resolve(v);};
  const submit=()=>{const vals=inputs.map(i=>i.value);const msg=fields.map((f,k)=>f.check?.(vals[k],vals)).find(Boolean);if(msg){fieldError(inputs[0],null);err.textContent=msg;err.hidden=false;shake(box);return;}close(fields.length?vals:true);};
  const key=e=>{
   if(e.key==='Escape'){e.preventDefault();close(null);}
   else if(e.key==='Enter'&&e.target.tagName==='INPUT'){e.preventDefault();submit();}
   else if(e.key==='Tab'){const f=[...box.querySelectorAll('input,button')];const i=f.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();f.at(-1).focus();}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus();}}
  };
  document.addEventListener('keydown',key,true);
  back.addEventListener('pointerdown',e=>{if(e.target===back)close(null);});
  no.onclick=()=>close(null);yes.onclick=submit;
  const api={close};dialogOpen=api;
  (inputs[0]||(danger?no:yes)).focus();
 });
}
function shake(n){ui.animate(n,[{transform:'translateX(0)'},{transform:'translateX(-6px)'},{transform:'translateX(5px)'},{transform:'translateX(-3px)'},{transform:'translateX(0)'}],{duration:320,easing:'ease-out'});}
/** Show an error right under the field it is about (and shake the field); null clears it. */
function fieldError(input,msg){
 const slot=input&&document.getElementById(input.id+'Err')||null;
 if(!slot)return false;
 slot.textContent=msg||'';slot.hidden=!msg;input.toggleAttribute('aria-invalid',!!msg);
 if(msg){shake(input);input.focus();}
 return true;
}

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
// Listen on the document: some controls (e.g. 快捷面板) live outside the form.
document.addEventListener('change',e=>{
 const k=e.target?.id;if(!k||!(k in defaults))return;
 save({[k]:read(k)});
});
$('restore').onclick=async()=>{
 if(!await dialog({title:'恢复默认设置？',text:'所有开关和选项回到默认值。不会清除推荐历史、用量记录或代理设置。',ok:'恢复默认'}))return;
 await save({...defaults});await load();
};
$('clearHistory').onclick=async()=>{if(!await dialog({title:'清空推荐历史？',text:'本扩展保存的全部推荐批次都会删除，此操作无法撤销。',ok:'清空',danger:true}))return;try{await chrome.storage.local.set({flowHistoryClearedAt:Date.now()});const all=await chrome.storage.local.get(null);const keys=Object.keys(all).filter(k=>k.startsWith('flowHistory:'));await chrome.storage.local.remove(keys);status(`已清空 ${keys.length} 组推荐历史；之后刷到的推荐仍会记录，关闭“保存推荐批次”可停止。`,'ok');}catch(e){status(e.message,'error');}};
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
// Password problems are shown right under the password field (and the field shakes); everything else below the buttons.
function lockErr(e){const m=String(e?.message||e);if(/密码/.test(m)&&!$('lockOn').hidden&&lock.hasPassword&&fieldError($('lockAuth'),m)){$('lockStatus').textContent='';return;}lockSay(m,'error');}
for(const id of ['lockAuth','lockPassword','lockPassword2'])$(id).addEventListener('input',()=>{fieldError($(id),null);if(id==='lockPassword')fieldError($('lockPassword2'),null);});
const send=async m=>{const r=await chrome.runtime.sendMessage(m);if(r?.error)throw new Error(r.error);return r;};
function renderLock(v){
 lock=v||{locked:false};
 $('lockOff').hidden=lock.locked;$('lockOn').hidden=!lock.locked;
 $('lockPill').textContent=lock.locked?'已开启':'未开启';
 document.querySelectorAll('[data-lock-badge]').forEach(n=>n.hidden=!lock.locked);
 if(!lock.locked){if(/排队/.test($('saved').textContent))status('已自动保存。','ok');return;}
 $('lockSummary').textContent=`开启于 ${new Date(lock.createdAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} · 冷却期 ${lock.cooldownHours} 小时 · ${lock.hasPassword?'已设置密码':'未设置密码（只能等冷却期）'}${lock.lockoutUntil?` · 密码输错太多次，${focusCore.fmtReset(lock.lockoutUntil)} 后可再试`:''}`;
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
 // The save bar must not keep saying "queued" once nothing is waiting any more.
 if(!entries.length&&/排队/.test($('saved').textContent))status('已自动保存。','ok');
 $('lockRemove').textContent=lock.pending?.remove?'解除自律锁（已排队）':'解除自律锁';
}
async function refreshLock(){try{renderLock(await send({type:'lock-state'}));}catch(_){}}
$('lockCreate').onclick=async()=>{
 const pw=$('lockPassword').value,pw2=$('lockPassword2').value;
 try{
  if(pw&&pw.length<4){fieldError($('lockPassword2'),'密码至少 4 位。');return;}
  if(pw!==pw2){fieldError($('lockPassword2'),'两次输入的密码不一样。');return;}
  const cd=Number($('lockCooldown').value);
  if(!await dialog({title:'开启自律锁？',text:`开启后，放宽额度要等 ${cd} 小时${pw?'（或输入密码）':''}才生效，包括解除自律锁本身。收紧随时立即生效。`,ok:'开启自律锁'}))return;
  renderLock(await send({type:'lock-create',newPassword:pw,cooldownHours:cd}));
  $('lockPassword').value=$('lockPassword2').value='';
  lockSay('自律锁已开启。收紧随时生效，放宽要等冷却期。','ok');await load();
 }catch(e){lockErr(e);}
};
const auth=()=>$('lockAuth').value;
$('lockCooldownOn').onchange=async e=>{
 try{const r=await send({type:'lock-cooldown',cooldownHours:Number(e.target.value),password:auth()});renderLock(r);
  lockSay(r.deferredAt?`缩短冷却期已排队，将在 ${focusCore.fmtReset(r.deferredAt)} 生效。`:'冷却期已更新。','ok');}
 catch(err){lockErr(err);refreshLock();}
};
$('lockApplyNow').onclick=async()=>{
 const p=lock.pending||{},changes={};for(const[k,x]of Object.entries(p))if(FOCUS.has(k))changes[k]=x.value;
 try{
  if(!auth()){fieldError($('lockAuth'),'请先输入自律锁密码。');return;}
  if(Object.keys(changes).length){const r=await send({type:'focus-set',changes,password:auth()});renderLock(r.lock);}
  if(p.cooldownHours)renderLock(await send({type:'lock-cooldown',cooldownHours:p.cooldownHours.value,password:auth()}));
  if(p.remove)renderLock(await send({type:'lock-remove',password:auth()}));
  $('lockAuth').value='';fieldError($('lockAuth'),null);lockSay('密码正确，等待中的改动已立即生效。','ok');await load();
  status('密码正确，等待中的改动已立即生效。','ok');
 }catch(e){lockErr(e);}
};
$('lockChangePw').onclick=async()=>{
 const had=lock.hasPassword,min=v=>v&&v.length<4?'密码至少 4 位。':!v?'请输入新密码。':null;
 const fields=[...(had?[{label:'当前密码',type:'password',autocomplete:'current-password',check:v=>v?null:'请输入当前密码。'}]:[]),
  {label:had?'新密码（至少 4 位）':'密码（至少 4 位）',type:'password',autocomplete:'new-password',check:min},
  {label:'再输入一次',type:'password',autocomplete:'new-password',check:(v,all)=>v!==all[had?1:0]?'两次输入的密码不一样。':null}];
 const vals=await dialog({title:had?'修改自律锁密码':'设置自律锁密码',text:had?'需要当前密码。忘记密码时只能等冷却期解除自律锁。':'设置后，输入密码可以让放宽立即生效。可以让朋友帮你设一个你不知道的密码。',ok:'保存密码',fields});
 if(!vals)return;
 const current=had?vals[0]:'',next=vals[had?1:0];
 try{renderLock(await send({type:'lock-password',newPassword:next,password:current}));fieldError($('lockAuth'),null);lockSay('密码已更新。','ok');}catch(e){lockErr(e);}
};
$('lockRemove').onclick=async()=>{
 try{
  const pw=auth();
  if(!pw&&!await dialog({title:'排队解除自律锁？',text:`没有输入密码：解除会在 ${lock.cooldownHours} 小时冷却期后生效（忘记密码也走这条路），期间随时可以撤销。${lock.hasPassword?'有密码的话，先在「自律锁密码」里输入即可立即解除。':''}`,ok:'排队解除',danger:true}))return;
  const r=await send({type:'lock-remove',password:pw});renderLock(r);$('lockAuth').value='';fieldError($('lockAuth'),null);
  lockSay(r.locked?`解除已排队，将在 ${focusCore.fmtReset(r.deferredAt)} 生效；期间随时可以撤销。`:'自律锁已解除。','ok');
 }catch(e){lockErr(e);}
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

/* ---------- sticky section nav: the section under a reading line just below the nav is current ---------- */
const links=[...document.querySelectorAll('.toc a')],targets=links.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);
let navFrame=0,navCurrent=null;
function navUpdate(){
 navFrame=0;
 const line=($('toc')?.getBoundingClientRect().bottom||0)+Math.min(160,innerHeight*.25);
 let cur=targets[0];
 for(const t of targets){if(t.getBoundingClientRect().top<=line)cur=t;else break;}
 if(innerHeight+scrollY>=document.documentElement.scrollHeight-4)cur=targets.at(-1); // Bottom of the page: the last section, even if short.
 if(cur===navCurrent)return;navCurrent=cur;
 for(const a of links){const on=a.getAttribute('href')==='#'+cur?.id;a.setAttribute('aria-current',String(on));if(on)a.scrollIntoView({block:'nearest',inline:'nearest'});}
}
addEventListener('scroll',()=>{if(!navFrame)navFrame=requestAnimationFrame(navUpdate);},{passive:true});
addEventListener('resize',()=>{if(!navFrame)navFrame=requestAnimationFrame(navUpdate);},{passive:true});
for(const a of links)a.addEventListener('click',e=>{const t=document.querySelector(a.getAttribute('href'));if(!t)return;e.preventDefault();t.scrollIntoView({behavior:ui.reduced.matches?'auto':'smooth',block:'start'});history.replaceState(null,'',a.getAttribute('href'));});
navUpdate();

load().catch(e=>status(e.message,'error'));refreshLock();focusUsage();setInterval(focusUsage,5000);setInterval(()=>{if(lock.locked)refreshLock();},30000);
if(location.hash)requestAnimationFrame(()=>document.querySelector(location.hash)?.scrollIntoView({block:'start'}));
