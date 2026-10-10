'use strict';
const $=id=>document.getElementById(id);
const ui=globalThis.__BTR_UI__,focusCore=globalThis.__BTR_FOCUS_CORE__,homeCore=globalThis.__BTR_HOME_CORE__,lockCore=globalThis.__BTR_LOCK_CORE__,filterCore=globalThis.__BTR_FILTER_CORE__,cleanCore=globalThis.__BTR_CLEAN_CORE__,sbCore=globalThis.__BTR_SB_CORE__;
const defaults={enabled:true,liveEnabled:true,autoConcurrency:true,smartPolicy:true,strategy:'auto',mode:'auto',maxAutoThreads:32,memoryBudgetMB:64,takeover:'full',...homeCore.defaults,...focusCore.defaults,filterEnabled:true,filterDedupe:true,...cleanCore.defaults,quickFab:true,uiTheme:'bili',...sbCore.defaults};
const LISTS=['filterKeywords','filterUps','filterTags'];
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
  const inputs=fields.map(f=>{const l=document.createElement('label'),i=document.createElement('input');l.className='field';const t=document.createElement('span');t.textContent=f.label;i.type=f.type||'text';i.autocomplete=f.autocomplete||'off';if(f.placeholder)i.placeholder=f.placeholder;if(f.value!=null)i.value=f.value;l.append(t,i);box.append(l);return i;});
  box.append(err);
  const no=document.createElement('button'),yes=document.createElement('button');no.type=yes.type='button';no.textContent=cancel;yes.textContent=ok;yes.className=danger?'primary danger-fill':'primary';
  acts.className='actions';no.hidden=!cancel;acts.append(no,yes);box.append(acts);back.append(box);document.body.append(back);
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
async function load(){const s=await chrome.storage.sync.get({...defaults,...filterCore.defaults});const all={...s,...homeCore.settings(s),...focusCore.settings(s),...filterCore.settings(s),...cleanCore.settings(s),...sbCore.settings(s)};populate(all);showMode(all);showLists(all);}

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
 }catch(e){status(`没保存上：${e.message}`,'error');await /* ---------- 空降助手分类（由分类表生成） ---------- */
(function(){const box=$('sbCats');if(!box)return;
 for(const c of sbCore.CATEGORIES){const f=document.createElement('div');f.className='field';const l=document.createElement('label'),sw=document.createElement('i'),sel=document.createElement('select');
  sel.id=sbCore.key(c.name);l.htmlFor=sel.id;sw.className='sb-swatch';sw.style.background=c.color;l.append(sw,c.label);
  for(const o of sbCore.OPTIONS){if(c.name==='poi_highlight'&&o==='auto')continue;const op=document.createElement('option');op.value=o;op.textContent=sbCore.OPTION_LABEL[o];sel.append(op);}
  sel.setAttribute('form','settings');f.append(l,sel);box.append(f);}
})();
load().catch(()=>{});}
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

/* ---------- sticky section nav: the section under the middle of the visible area is current ---------- */
const links=[...document.querySelectorAll('.toc a')],targets=links.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);
let navFrame=0,navCurrent=null;
let navPin=null;
function navUpdate(){
 navFrame=0;
 if(navPin&&performance.now()<navPin.until){setNav(navPin.target);return;}navPin=null;
 // The section under the middle of the visible area (between the sticky nav and the save bar).
 // A 35%-line rule lagged on short screens: at 1280×800 a section filling 56% of the screen
 // stayed unlit because its top was still below the line.
 const top=Math.max(0,$('toc')?.getBoundingClientRect().bottom||0),bottom=innerHeight-($('savebar')?.offsetHeight||0);
 // Over the last stretch of scrolling the line slides down to the bottom edge, so short sections
 // at the end of a tall window still get their turn before the page runs out.
 const mid=(top+bottom)/2,span=bottom-mid,remaining=document.documentElement.scrollHeight-innerHeight-scrollY;
 const line=mid+Math.max(0,span-Math.max(0,remaining));
 let cur=targets[0];
 for(const t of targets){if(t.getBoundingClientRect().top<=line)cur=t;else break;}
 // A section filling more than half of the visible area is always the current one.
 for(const t of targets){const r=t.getBoundingClientRect();if(Math.min(r.bottom,bottom)-Math.max(r.top,top)>span){cur=t;break;}}
 if(innerHeight+scrollY>=document.documentElement.scrollHeight-4)cur=targets.at(-1); // Bottom of the page: the last section, even if short.
 setNav(cur);
}
function setNav(cur){
 if(cur===navCurrent)return;navCurrent=cur;
 for(const a of links){const on=a.getAttribute('href')==='#'+cur?.id;a.setAttribute('aria-current',String(on));if(on)a.scrollIntoView({block:'nearest',inline:'nearest'});}
}
addEventListener('scroll',()=>{if(!navFrame)navFrame=requestAnimationFrame(navUpdate);},{passive:true});
addEventListener('resize',()=>{if(!navFrame)navFrame=requestAnimationFrame(navUpdate);},{passive:true});
addEventListener('scrollend',()=>{navPin=null;});
['wheel','touchstart','keydown'].forEach(t=>addEventListener(t,()=>{navPin=null;},{passive:true}));
// The save bar is fixed to the bottom edge; keep the page end clear of it.
const bar=$('savebar');if(bar&&typeof ResizeObserver==='function')new ResizeObserver(()=>{document.body.style.paddingBottom=bar.offsetHeight+'px';}).observe(bar);
for(const a of links)a.addEventListener('click',e=>{const t=document.querySelector(a.getAttribute('href'));if(!t)return;e.preventDefault();navPin={target:t,until:performance.now()+1000};setNav(t);t.scrollIntoView({behavior:ui.reduced.matches?'auto':'smooth',block:'start'});history.replaceState(null,'',a.getAttribute('href'));});
navUpdate();

load().catch(e=>status(e.message,'error'));refreshLock();focusUsage();setInterval(focusUsage,5000);setInterval(()=>{if(lock.locked)refreshLock();},30000);
if(location.hash)requestAnimationFrame(()=>document.querySelector(location.hash)?.scrollIntoView({block:'start'}));

/* ---------- 首页模式 ---------- */
function showMode(st){
 const mode=st.homeInfinite?'infinite':'batch';
 for(const r of document.querySelectorAll('input[name="homeMode"]'))r.checked=st.homeModeChosen!==false||st.homeInfinite?r.value===mode:false;
 for(const n of document.querySelectorAll('.mode-opts'))n.hidden=n.dataset.mode!==mode;
}
for(const r of document.querySelectorAll('input[name="homeMode"]'))r.addEventListener('change',()=>{if(r.checked)save({homeInfinite:r.value==='infinite',homeModeChosen:true}).then(load);});

/* ---------- 屏蔽列表 ---------- */
let lists={filterKeywords:[],filterUps:[],filterTags:[]};
const KIND={filterKeywords:'keywords',filterUps:'ups',filterTags:'tags'};
function chipLabel(key,e){return key==='filterUps'?(filterCore.parseUp(e).mid?`${filterCore.upLabel(e)}（UID ${filterCore.parseUp(e).mid}）`:e):key==='filterTags'?`#${e}`:e;}
function showLists(st){
 lists=Object.fromEntries(LISTS.map(k=>[k,st[k]||[]]));
 for(const box of document.querySelectorAll('.list-editor')){
  const key=box.dataset.list,ul=box.querySelector('.chiplist'),items=lists[key];
  ul.replaceChildren(...items.slice().reverse().map(e=>{const li=document.createElement('li'),t=document.createElement('span'),x=document.createElement('button');
   t.textContent=chipLabel(key,e);x.type='button';x.textContent='×';x.setAttribute('aria-label',`移除 ${t.textContent}`);
   x.onclick=()=>saveList(key,filterCore.remove(lists[key],e));li.title=e;li.append(t,x);return li;}));
  if(!items.length){const li=document.createElement('li');li.className='none';li.textContent='还没有规则';ul.append(li);}
 }
 const n=LISTS.reduce((a,k)=>a+lists[k].length,0);$('filterCount').textContent=`${n} 条规则`;
}
async function saveList(key,next){lists[key]=next;showLists(lists);await save({[key]:next});}
for(const box of document.querySelectorAll('.list-editor')){
 const key=box.dataset.list,input=box.querySelector('.add input'),addBtn=box.querySelector('.add button');
 // Not a <form>: the whole page is one form already, and nested forms are dropped by the parser.
 input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();add();}});
 addBtn.addEventListener('click',()=>add());
 function add(){
  const v=input.value.trim();if(!v){input.focus();return;}
  const entry=key==='filterUps'&&/^\d{3,20}$/.test(v)?filterCore.upEntry(v):v;
  const next=filterCore.add(lists[key],entry,KIND[key]);
  if(!next){fieldError(input,'已经在列表里了');return;}
  input.value='';saveList(key,next);input.focus();}
}
$('filterExport').onclick=async()=>{const text=JSON.stringify({bilithrottleFilters:1,...lists},null,1);
 try{await navigator.clipboard.writeText(text);status('已把全部屏蔽规则复制到剪贴板，可以粘贴保存或分享。','ok');}
 catch(_){await dialog({title:'导出屏蔽规则',text:'复制下面的内容保存：',fields:[{label:'规则',value:text}],ok:'好',cancel:''});}};
$('filterImport').onclick=async()=>{const r=await dialog({title:'导入屏蔽规则',text:'粘贴之前导出的内容（会合并到现有规则里，不会删掉已有的）。',fields:[{label:'规则',value:''}],ok:'导入'});
 if(!r)return;const raw=Array.isArray(r)?r[0]:r?.values?.[0]??r;let data;try{data=JSON.parse(String(raw));}catch(_){status('没认出这段内容，请粘贴导出的完整文字。','error');return;}
 const changes={};for(const k of LISTS){let cur=lists[k];for(const e of Array.isArray(data[k])?data[k]:[]){const n=filterCore.add(cur,e,KIND[k]);if(n)cur=n;}changes[k]=cur;}
 await save(changes);await load();status('已导入并合并屏蔽规则。','ok');};
$('filterClear').onclick=async()=>{if(!await dialog({title:'清空全部屏蔽规则？',text:'关键词、UP 主和标签规则都会删除，此操作无法撤销。',ok:'清空',danger:true}))return;await save({filterKeywords:[],filterUps:[],filterTags:[]});await load();};

/* ---------- 净化开关（由规则表生成） ---------- */
(function(){const box=$('cleanGroups');if(!box)return;
 for(const {group,rules} of cleanCore.groups()){if(group==='首页')continue;
  const h=document.createElement('h3');h.textContent=group;const st=document.createElement('div');st.className='stack';
  for(const r of rules){const l=document.createElement('label');l.className='row';l.innerHTML='<span class="switch"><input type="checkbox" role="switch"><span></span></span>';
   const i=l.querySelector('input');i.id=r.key;const t=document.createElement('span');t.className='lbl';const b=document.createElement('b');b.textContent=r.label;const hn=document.createElement('small');hn.textContent=r.hint;t.append(b,hn);l.append(t);st.append(l);}
  box.append(h,st);}
})();
load().catch(()=>{});
