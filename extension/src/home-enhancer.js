/* BiliThrottle 2.1.0 — isolated world. Native Vue cards stay mounted and retain their handlers.
 * Native refresh is the only source of fresh recommendations: no private API, prefetch loop,
 * synthetic scroll, raw-HTML snapshots or automatic document reload.
 */
(function () {
  'use strict';
  const core = globalThis.__BTR_HOME_CORE__;
  if (!core || globalThis.__BTR_FLOW_HOME_LOADED__) return;
  globalThis.__BTR_FLOW_HOME_LOADED__ = true;
  const GRID = '.recommended-container_floor-aside .container, .recommended-container .container';
  const CARD = '.bili-video-card, .video-card-reco, .feed-card .video-card';
  const OWN = '[data-btr-flow-owned]';
  const QUIET_MS = 600, REFRESH_TIMEOUT = 10000;
  let settings = {...core.defaults}, ready = false, snapshots = [], index = -1, liveReady = false;
  let grid = null, bar = null, shadow = null, view = null, refs = {}, nativeRefresh = null, nativeTarget = null;
  let gridObserver = null, mountObserver = null, resizeObserver = null, themeObserver = null;
  let settleTimer, deadlineTimer, saveTimer, mountTimer, routeTimer, paintTimer;
  let busy = false, transaction = null, generation = 0, issuingNative = false;
  let candidateKey = '', status = '', statusError = false, liveScroll = 0;
  let clearEpoch = 0, saveGeneration = 0, saveChain = Promise.resolve();
  let telemetry = null, stats = null, lastPath = location.pathname;
  let tabKey;
  try {
    tabKey = sessionStorage.getItem('btr-flow-tab');
    if (!/^[\w-]{8,80}$/.test(tabKey || '')) {
      tabKey = crypto.randomUUID(); sessionStorage.setItem('btr-flow-tab',tabKey);
    }
  } catch (_) { tabKey = crypto.randomUUID(); }
  const storageKey = 'flowHistory:' + tabKey;
  const isHome = () => /^\/(?:index\.html)?$/.test(location.pathname);
  const active = () => ready && isHome() && settings.homeEnabled;
  const owns = n => !!(n?.nodeType === 1 ? n.closest(OWN) : n?.parentElement?.closest(OWN));
  const root = () => document.documentElement;
  function el(tag,text,cls) {
    const n = document.createElement(tag); if (text != null) n.textContent=text;
    if (cls) n.className=cls; return n;
  }
  function button(text,fn,title) {
    const b=el('button',text); b.type='button'; if(title)b.title=title;
    b.addEventListener('click',fn); return b;
  }
  const skin = el('style'); skin.id='btr-flow-home-style'; skin.dataset.btrFlowOwned='';
  skin.textContent = `
/* Only homepage surfaces are touched. Preserve Bilibili's column count, titles and previews. */
html[data-btr-home-clean][data-btr-hide-carousel] :is(.recommended-container_floor-aside,.recommended-container) .recommended-swipe{display:none!important}
html[data-btr-home-clean][data-btr-hide-carousel] :is(.recommended-container_floor-aside,.recommended-container) .container{grid-template-areas:none!important;grid-template-rows:none!important;grid-auto-rows:auto!important;grid-auto-flow:row!important}
html[data-btr-home-clean][data-btr-hide-carousel] :is(.recommended-container_floor-aside,.recommended-container) .container > :is(.feed-card,.bili-video-card,.video-card-reco,.floor-single-card){margin-top:0!important;grid-area:auto!important;align-self:start}
html[data-btr-home-clean][data-btr-hide-carousel] [data-btr-grid] > .feed-card[data-btr-ready]{display:block!important}
html[data-btr-home-clean][data-btr-hide-ads] [data-btr-grid] :is(.feed-card,.bili-video-card,.video-card-reco)[data-btr-ad]{display:none!important}
html[data-btr-home-clean][data-btr-hide-banner] .bili-header .bili-header__banner{height:64px!important;min-height:64px!important;background:var(--bg1,white)!important}
html[data-btr-home-clean][data-btr-hide-banner] .bili-header .bili-header__banner > *{visibility:hidden!important}
html[data-btr-home-clean][data-btr-hide-banner] .bili-header .bili-header__bar{background:var(--bg1,white)!important}
html[data-btr-home-clean][data-btr-hide-banner] .bili-header .bili-header__bar :is(.entry-title,.download-entry,.default-entry,.loc-entry,.right-entry-icon,.right-entry-text){color:var(--text1,#18191c)!important}
html[data-btr-home-ui] [data-btr-native-refresh],html[data-btr-home-ui] #__bilibili_thread_ripper_launcher__{display:none!important}
html[data-btr-history-open] [data-btr-grid]{display:none!important}
/* Infinite feed replaces the site's own lazy loader, so content never shifts above the reader. */
html[data-btr-infinite] .load-more-anchor{display:none!important}
html[data-btr-oled]{--bg1:#000;--bg2:#000;--bg3:#000;--bg1_float:#000;--bg2_float:#000}
html[data-btr-oled] :is(body,#i_cecream,#app,.bili-header__bar,.bili-header__channel,.header-channel,.channel-link,.channel-link__right,.channel-link__left,.bili-video-card,.bili-video-card__info,.feed-card,.v-popover-content,.search-panel,.nav-search-content,.nav-search-input){background-color:#000!important}
`;
  const uiCSS = `
:host{display:block;box-sizing:border-box;font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--btr-text,#18191c)}
*{box-sizing:border-box} [hidden]{display:none!important}
.toolbar{display:flex;justify-content:flex-end;align-items:center;gap:6px;min-height:32px;margin:0 0 12px;flex-wrap:wrap}
button{font:inherit;border:1px solid transparent;background:transparent;color:inherit;padding:4px 8px;border-radius:6px;cursor:pointer;min-height:30px;white-space:nowrap}
button:hover{background:var(--btr-hover,rgba(128,128,128,.10));color:var(--brand_blue,#00aeec)}button:focus-visible,a:focus-visible{outline:2px solid #00aeec;outline-offset:2px}
button:disabled{opacity:.35;cursor:default}.count{font-size:12px;opacity:.64;min-width:38px;text-align:center;font-variant-numeric:tabular-nums}.separator{height:14px;border-left:1px solid currentColor;opacity:.15;margin:0 3px}
.refresh{border-color:var(--btr-border,rgba(128,128,128,.25))}.status{margin-right:auto;opacity:.72;font-size:12px;max-width:56%;overflow-wrap:anywhere}.status.error{opacity:1}.history-head{display:flex;gap:12px;align-items:center;justify-content:space-between;margin:0 0 14px;opacity:.75}.history-head p{margin:0;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(var(--btr-columns,5),minmax(0,1fr));column-gap:var(--btr-gap,20px);row-gap:24px;padding-bottom:20px}
.card{color:inherit;text-decoration:none;display:block;min-width:0}.cover{position:relative;aspect-ratio:16/9;background:var(--btr-placeholder,rgba(128,128,128,.10));border-radius:6px;overflow:hidden}.cover img{width:100%;height:100%;object-fit:cover;display:block}.duration{position:absolute;right:8px;bottom:5px;font-size:12px;color:white;text-shadow:0 1px 3px black;background:#0008;border-radius:3px;padding:0 3px}.title{font-size:15px;line-height:22px;margin-top:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:44px}.card:hover .title{color:var(--brand_blue,#00aeec)}.meta{opacity:.64;font-size:12px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;margin-top:4px}
button{transition:background-color .16s ease,color .16s ease,border-color .16s ease,opacity .16s ease,transform .12s ease}button:active:not(:disabled){transform:scale(.97)}
.refresh{border-radius:999px;padding:4px 14px}.refresh[aria-busy=true]{color:var(--brand_blue,#00aeec)}
.status:not(:empty){animation:btr-in .22s ease-out}
#btr-flow-history{animation:btr-in .26s cubic-bezier(.2,.75,.25,1)}.card .cover img{transition:transform .3s cubic-bezier(.2,.75,.25,1)}.card:hover .cover img{transform:scale(1.04)}.title{transition:color .16s ease}
@keyframes btr-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
@media(max-width:680px){.toolbar{gap:2px}.status{max-width:100%;flex-basis:100%}.history-head{align-items:flex-start}.grid{row-gap:18px}.title{font-size:14px}}
`;
  function mountSkin() { if(root()&&!skin.isConnected)root().append(skin); }
  function toggle(name,wanted) { const r=root(); if(r&&r.hasAttribute(name)!==!!wanted)r.toggleAttribute(name,!!wanted); }
  function clearMarks() {
    for(const n of document.querySelectorAll('[data-btr-ready],[data-btr-ad],[data-btr-native-refresh],[data-btr-grid]')) {
      for(const a of ['data-btr-ready','data-btr-ad','data-btr-native-refresh','data-btr-grid'])n.removeAttribute(a);
    }
  }
  function detectDark() {
    // Temporarily remove our own OLED override before measuring; avoid latching black after native light is chosen.
    const had=root().hasAttribute('data-btr-oled'); if(had)root().removeAttribute('data-btr-oled');
    let dark=false;
    for(const node of [document.body,root()]) {
      if(!node)continue;
      const cs=getComputedStyle(node), rgb=cs.backgroundColor.match(/[\d.]+/g);
      if(rgb&&rgb.length>=3&&(rgb.length<4||Number(rgb[3])>.1)) {
        dark=(Number(rgb[0])*.2126+Number(rgb[1])*.7152+Number(rgb[2])*.0722)<110; break;
      }
      const marker=node.getAttribute('data-theme')||node.getAttribute('theme');
      if(marker==='dark'||marker==='light'){dark=marker==='dark';break;}
    }
    if(had)root().setAttribute('data-btr-oled','');
    return dark;
  }
  let lastDark=false, lastColumns={count:5,gap:'20px'};
  const infinite=globalThis.__BTR_HOME_INFINITE__?.create({
    anchor:()=>grid?.closest('.recommended-container_floor-aside,.recommended-container')||grid,
    nativeLinks:()=>grid?[...grid.querySelectorAll('a[href*="/video/BV"]')].map(a=>a.href):[],
    enabled:()=>active()&&settings.homeInfinite&&!!grid?.isConnected,
    settings:()=>settings,
    hidden:()=>root().hasAttribute('data-btr-history-open'),
    theme:()=>({dark:lastDark,oled:root().hasAttribute('data-btr-oled')}),
    columns:()=>lastColumns
  });
  function theme() {
    if(!document.body)return;
    const dark=detectDark(); lastDark=dark; toggle('data-btr-oled',active()&&settings.homeTheme==='oled'&&dark);
    infinite?.theme();
    if(bar) {
      bar.style.setProperty('--btr-text',dark?'#e3e5e7':'#18191c');
      bar.style.setProperty('--btr-placeholder',root().hasAttribute('data-btr-oled')?'#000':dark?'#222':'#f1f2f3');
      bar.style.colorScheme=dark?'dark':'light';
    }
  }
  function applySkin() {
    mountSkin(); toggle('data-btr-home-clean',active());
    toggle('data-btr-hide-carousel',active()&&settings.homeHideCarousel);
    toggle('data-btr-hide-banner',active()&&settings.homeHideBanner);
    toggle('data-btr-hide-ads',active()&&settings.homeHideAds);
    toggle('data-btr-infinite',active()&&settings.homeInfinite); theme();
  }
  function isAd(node) {
    // Explicit promotion badges only. Never classify by video title or link keywords.
    return !!node.querySelector('.bili-video-card__info--ad,.bili-video-card__info--ad-text,.bili-video-card__stats--ad,[data-ad-id]');
  }
  function cardFrom(node) {
    const a=node.querySelector('.bili-video-card__info--tit a,a[href*="/video/"]');
    const title=node.querySelector('.bili-video-card__info--tit,.title');
    const image=node.querySelector('.bili-video-card__image img,.bili-video-card__cover img,picture img,img');
    return core.card({url:a?.href,title:title?.getAttribute('title')||a?.getAttribute('title')||title?.textContent||a?.textContent,
      image:image?.currentSrc||image?.getAttribute('data-src')||image?.getAttribute('src')||'',
      author:node.querySelector('.bili-video-card__info--author,.up-name,.up')?.textContent,
      duration:node.querySelector('.bili-video-card__stats__duration,.duration')?.textContent,
      stats:[...node.querySelectorAll('.bili-video-card__stats--text')].map(n=>n.textContent).join(' · ')});
  }
  function collect() {
    if(!grid?.isConnected)return [];
    const nodes=[...grid.querySelectorAll(CARD)].filter(n=>!owns(n)&&!n.closest('.recommended-swipe'));
    const result=[];
    for(const n of nodes.slice(0,144)) {
      const holder=n.closest('.feed-card')||n, ad=isAd(n), c=cardFrom(n);
      if(ad!==holder.hasAttribute('data-btr-ad'))holder.toggleAttribute('data-btr-ad',ad);
      if(!!c!==holder.hasAttribute('data-btr-ready'))holder.toggleAttribute('data-btr-ready',!!c);
      if(c&&!(ad&&settings.homeHideAds))result.push(c);
    }
    return core.cards(result);
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    if(!settings.homeHistory)return;
    const token=saveGeneration, epoch=clearEpoch;
    // Debounce data writes; prune only at startup, not on every mutation or click.
    saveTimer=setTimeout(()=>{
      const value={at:Date.now(),epoch,snapshots:core.history(snapshots)};
      saveChain=saveChain.catch(()=>{}).then(async()=>{
        if(token!==saveGeneration||!settings.homeHistory||epoch!==clearEpoch)return;
        await chrome.storage.local.set({[storageKey]:value});
      }).catch(()=>notify('历史暂未写入浏览器；当前标签页仍可回看。',true));
    },250);
  }
  function clearHistory(epoch) {
    clearEpoch=Number(epoch)||0; saveGeneration++; clearTimeout(saveTimer);
    snapshots=[]; index=-1; liveReady=true; candidateKey=''; // Current native page still exists; do not re-save it as the next refresh baseline.
    clearTimeout(settleTimer); finishTransaction(); closeHistory(); render();
    // Do not immediately recapture the page after the user explicitly clears history.
  }
  function notify(text,error=false) {status=text;statusError=error;render();}
  function render() {
    if(!bar)return;
    refs.back.hidden=refs.next.hidden=refs.count.hidden=!settings.homeHistory;
    refs.back.disabled=busy||index<=0;
    refs.next.disabled=busy||index<0||index>=snapshots.length-1;
    refs.count.textContent=snapshots.length?`${index+1} / ${snapshots.length}`:'—';
    refs.count.title='本标签页保存的推荐批次；不是分页请求';
    refs.refresh.textContent=busy?'更新中…':'换一批';refs.refresh.disabled=busy;refs.refresh.setAttribute('aria-busy',String(busy));
    refs.status.textContent=status;refs.status.classList.toggle('error',statusError);
    refs.nav.setAttribute('aria-busy',String(busy));
  }
  function columnCount() {
    if(!grid||!bar)return;
    // While browsing history the native grid is hidden, so keep the last known count.
    if(root().hasAttribute('data-btr-history-open'))return;
    const cs=getComputedStyle(grid), parts=cs.gridTemplateColumns.split(/\s+/).filter(Boolean);
    const count=parts[0]==='none'?Math.max(1,Math.floor(grid.clientWidth/250)):parts.length;
    bar.style.setProperty('--btr-columns',String(Math.max(1,Math.min(10,count))));
    bar.style.setProperty('--btr-gap',cs.columnGap==='normal'?'20px':cs.columnGap);
    lastColumns={count:Math.max(1,Math.min(10,count)),gap:cs.columnGap==='normal'?'20px':cs.columnGap};infinite?.theme();
  }
  function ensureBar() {
    if(!grid?.parentElement)return;
    if(!bar) {
      bar=el('div');bar.id='btr-flow-toolbar';bar.dataset.btrFlowOwned='';
      shadow=bar.attachShadow({mode:'open'});shadow.append(el('style',uiCSS));
      refs.nav=el('nav',null,'toolbar');refs.nav.setAttribute('aria-label','推荐批次');
      refs.status=el('span','', 'status');refs.status.setAttribute('role','status');refs.status.setAttribute('aria-live','polite');
      refs.back=button('← 上一批',()=>show(index-1),'只回看本地快照，不重新请求推荐');
      refs.next=button('下一批 →',()=>show(index+1),'前进到已保存的下一批');
      refs.count=el('span','—','count');
      refs.refresh=button('换一批',refresh,'使用 B 站原生换一换，不刷新整个页面');refs.refresh.className='refresh';
      refs.settings=button('设置',()=>chrome.runtime.sendMessage({type:'flow-open-options'}).catch(()=>notify('请从扩展图标打开增强设置。',true)),'哔哩节流阀设置');
      refs.nav.append(refs.status,refs.back,refs.count,refs.next,el('span',null,'separator'),refs.refresh,refs.settings);
      shadow.append(refs.nav);
    }
    if(bar.parentNode!==grid.parentNode||bar.nextElementSibling!==grid)grid.before(bar);
    toggle('data-btr-home-ui',true); columnCount();render();theme();infinite?.sync();
  }
  function closeHistory() {view?.remove();view=null;toggle('data-btr-history-open',false);infinite?.sync();}
  function show(wanted) {
    if(busy||wanted<0||wanted>=snapshots.length||!bar)return;
    const wasHistory=!!view; if(!wasHistory)liveScroll=window.scrollY;
    index=wanted;closeHistory();render();
    if(wanted===snapshots.length-1&&liveReady) {
      if(wasHistory)window.scrollTo({top:liveScroll,behavior:'instant'});
      return;
    }
    view=el('section');view.id='btr-flow-history';view.setAttribute('aria-label','已保存的推荐');
    const head=el('header',null,'history-head');
    head.append(el('p',`${new Date(snapshots[index].at).toLocaleString()} · 已保存快照（无悬停预览）`),button('返回当前推荐',()=>show(snapshots.length-1)));
    view.append(head);const cards=el('div',null,'grid');
    for(const c of snapshots[index].cards) {
      const a=el('a',null,'card');a.href=c.url;a.target='_blank';a.rel='noopener noreferrer';
      const cover=el('div',null,'cover');
      if(c.image){const img=el('img');img.src=c.image;img.alt='';img.loading='lazy';img.decoding='async';cover.append(img);}
      if(c.duration)cover.append(el('span',c.duration,'duration'));
      a.append(cover,el('div',c.title,'title'),el('div',[c.author,c.stats].filter(Boolean).join(' · '),'meta'));cards.append(a);
    }
    view.append(cards);shadow.append(view);toggle('data-btr-history-open',true);infinite?.sync();
    // History lives in normal flow, never covers the search, navigation or bottom video row.
    if(bar.getBoundingClientRect().top<64)bar.scrollIntoView({block:'start',behavior:'instant'});
  }
  function accept(items,replaceLatest=false) {
    if(items.length<2)return;
    if(settings.homeHistory) {
      const atLatest=index>=snapshots.length-1, old=snapshots[index];
      if(replaceLatest&&snapshots.length)snapshots=[...snapshots.slice(0,-1),{...snapshots.at(-1),cards:items}];
      else snapshots=core.append(snapshots,items);
      if(atLatest||index<0)index=snapshots.length-1;
      else index=Math.max(0,snapshots.indexOf(old));
      scheduleSave();
    }
    liveReady=true; render();
  }
  function finishTransaction() {
    clearTimeout(deadlineTimer);transaction=null;busy=false;render();
  }
  function settle() {
    clearTimeout(settleTimer);
    if(!active()||!grid?.isConnected)return;
    const items=collect(), key=core.key(items);
    if(items.length<2)return;
    if(candidateKey!==key){candidateKey=key;settleTimer=setTimeout(settle,QUIET_MS);return;}
    if(transaction) {
      if(key===transaction.beforeKey)return;
      const minimum=Math.max(2,Math.min(transaction.count,6));
      if(items.length<minimum)return;
      const fromHistory=!!view;
      finishTransaction();index=snapshots.length-1;closeHistory();accept(items,false);index=snapshots.length-1;
      notify('');if(fromHistory)window.scrollTo({top:liveScroll,behavior:'instant'});
      return;
    }
    if(!liveReady){accept(items);return;}
    const last=snapshots.at(-1)?.cards||[];
    if(!settings.homeHistory)return;
    if(core.key(last)===key) {
      // Update lazy-loaded cover/author data without adding a batch or continuous storage churn.
      if(JSON.stringify(last)!==JSON.stringify(items))accept(items,true);
    } else if(core.grows(last,items))accept(items,true);
    else {
      // Native refresh can also be invoked by the site's keyboard/UI or an updated selector.
      accept(items,false);
    }
  }
  function scheduleSettle(records) {
    if(records&&!records.some(r=>!owns(r.target)&&
      (r.type!=='attributes'||['href','src','data-src'].includes(r.attributeName))))return;
    candidateKey='';clearTimeout(settleTimer);settleTimer=setTimeout(settle,QUIET_MS);
  }
  const REFRESH_TEXT=/^\s*换\s*[一1]\s*[换批]\s*$/;
  const REFRESH_WRAP='.feed-roll-btn,.flexible-roll-btn,.roll-btn,.refresh-btn,button,[role="button"]';
  // B 站 wraps the control as div.feed-roll-btn > button.roll-btn > svg + span「换一换」, with the
  // handler on the inner button. Clicking a wrapper never reaches a child's handler, so the click
  // target is the innermost element showing the text: its click bubbles through every ancestor.
  function findRefresh() {
    const scope=grid?.closest('.recommended-container_floor-aside,.recommended-container');
    if(!scope)return null;
    const walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);
    const seen=new Set();
    for(let t=walker.nextNode();t;t=walker.nextNode()) {
      if(!t.data.includes('换'))continue;
      let leaf=t.parentElement;
      // Climb while the text is split across siblings (e.g. <span>换一</span><span>换</span>).
      while(leaf&&leaf!==scope&&!REFRESH_TEXT.test(leaf.textContent||''))leaf=leaf.parentElement;
      if(!leaf||leaf===scope||seen.has(leaf)||owns(leaf)||leaf.closest('.feed-card,.bili-video-card'))continue;
      seen.add(leaf);
      const control=leaf.closest('button,[role="button"]');
      if(control?.disabled||control?.getAttribute('aria-disabled')==='true')continue;
      const wrap=leaf.closest('.feed-roll-btn,.flexible-roll-btn')||leaf.closest(REFRESH_WRAP)||leaf;
      if(!scope.contains(wrap))continue;
      // Our own hiding makes the control rect-less; otherwise skip controls the site keeps hidden.
      if(!wrap.hasAttribute('data-btr-native-refresh')&&!leaf.getClientRects().length)continue;
      return {target:leaf,wrap};
    }
    return null;
  }
  function tagRefresh() {
    const next=findRefresh();
    if(nativeRefresh&&nativeRefresh!==next?.wrap)nativeRefresh.removeAttribute('data-btr-native-refresh');
    nativeRefresh=next?.wrap||null;nativeTarget=next?.target||null;
    if(next&&bar)next.wrap.setAttribute('data-btr-native-refresh','');
  }
  function begin() {
    if(busy||!active()||!grid)return false;
    const items=collect();
    // Lock synchronously, before storage promises or native handlers run.
    busy=true;transaction={id:++generation,beforeKey:core.key(items),count:items.length};
    if(!liveReady)accept(items);else if(settings.homeHistory&&items.length>=2&&core.grows(snapshots.at(-1)?.cards||[],items))accept(items,true);
    index=snapshots.length-1;closeHistory();notify('');candidateKey='';render();
    const id=transaction.id;
    deadlineTimer=setTimeout(()=>{
      if(transaction?.id!==id)return;
      finishTransaction();notify('这次未检测到完整的新推荐；保留历史，可稍后重试。',true);
    },REFRESH_TIMEOUT);
    return true;
  }
  function refresh() {
    if(busy)return;
    tagRefresh();
    if(!nativeRefresh){notify('未找到原生换一换；没有刷新页面，请使用 B 站原生按钮或手动刷新。',true);return;}
    if(!begin())return;
    try {
      issuingNative=true;
      if(typeof nativeTarget.click==='function')nativeTarget.click();
      else nativeTarget.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
      scheduleSettle();
    }
    catch(_){finishTransaction();notify('原生换一换未能执行，请稍后重试。',true);}
    finally {issuingNative=false;}
  }
  function nativeClick(event) {
    if(!active()||owns(event.target))return;
    if(issuingNative||!event.target?.closest)return;
    const hit=nativeRefresh?.contains(event.target)?nativeRefresh:findRefresh()?.wrap;
    if(!hit?.contains(event.target))return;
    if(busy){event.preventDefault();event.stopImmediatePropagation();return;}
    begin();scheduleSettle();
  }
  function chooseGrid() {
    return [...document.querySelectorAll(GRID)].find(n=>!owns(n)) ||
      [...document.querySelectorAll('.recommended-container')].find(n=>!owns(n)&&n.querySelector(CARD)) || null;
  }
  function connectGrid(next) {
    gridObserver?.disconnect();resizeObserver?.disconnect();grid?.removeAttribute('data-btr-grid');
    if(transaction){finishTransaction();notify('推荐区域已重建，正在读取当前内容。');}
    grid=next;candidateKey='';
    if(!grid){bar?.remove();toggle('data-btr-home-ui',false);infinite?.sync();return;}
    grid.setAttribute('data-btr-grid','');ensureBar();tagRefresh();collect();
    gridObserver=new MutationObserver(scheduleSettle);
    gridObserver.observe(grid,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['href','src','data-src']});
    resizeObserver=new ResizeObserver(()=>{clearTimeout(paintTimer);paintTimer=setTimeout(columnCount,80);});resizeObserver.observe(grid);
    scheduleSettle();
  }
  function scanMount() {
    clearTimeout(mountTimer);
    if(!active())return;
    const next=chooseGrid();
    if(next!==grid)connectGrid(next);
    else if(grid){ensureBar();tagRefresh();}
  }
  function stopHome() {
    clearTimeout(settleTimer);clearTimeout(mountTimer);clearTimeout(paintTimer);finishTransaction();
    gridObserver?.disconnect();mountObserver?.disconnect();resizeObserver?.disconnect();
    gridObserver=mountObserver=resizeObserver=null;closeHistory();bar?.remove();bar=shadow=null;refs={};grid=null;
    nativeRefresh?.removeAttribute('data-btr-native-refresh');nativeRefresh=nativeTarget=null;clearMarks();
    toggle('data-btr-home-ui',false);toggle('data-btr-oled',false);infinite?.stop();
  }
  function syncRoute() {
    applySkin();
    if(!active()||!document.body){stopHome();return;}
    if(!mountObserver) {
      // Mount discovery sees child-list changes only; the hot-path observer is limited to the recommendation grid.
      mountObserver=new MutationObserver(records=>{
        if(records.some(r=>!owns(r.target)&&!grid?.contains(r.target))) {
          clearTimeout(mountTimer);mountTimer=setTimeout(scanMount,180);
        }
      });mountObserver.observe(document.body,{childList:true,subtree:true});
    }
    scanMount();
  }
  // Display-only telemetry: page messages never grant permissions or change proxy configuration.
  window.addEventListener('message',e=>{
    if(e.source!==window||e.origin!==location.origin||!e.data)return;
    const p=e.data.payload||{},n=v=>Math.max(0,Math.min(1e15,Number(v)||0));
    if(e.data.channel==='__BTR_FLOW_V1__'&&e.data.type==='telemetry')
      telemetry={policy:{name:String(p.policy?.name||'').slice(0,60),cap:n(p.policy?.cap),ahead:n(p.policy?.ahead),decodeWarning:p.policy?.decodeWarning===true},ahead:n(p.ahead),stalls:n(p.stalls),bitrate:n(p.bitrate),received:n(p.received),errors:n(p.errors),droppedRatio:n(p.droppedRatio)};
    if(e.data.channel==='__BILI_RANGE_ACCELERATOR_V1__'&&e.data.type==='stats')
      stats={activeThreads:n(p.activeThreads),totalSpeedBps:n(p.totalSpeedBps),bufferedAhead:n(p.bufferedAhead),quality:String(p.quality||'').slice(0,30),playerState:String(p.playerState||'').slice(0,30)};
  });
  chrome.runtime.onMessage.addListener((m,sender,reply)=>{
    if(sender.id!==chrome.runtime.id)return false;
    if(m?.type==='flow-get-state'){reply({telemetry,stats,historyCount:snapshots.length,home:isHome()});return false;}
    if(m?.type==='flow-clear-history'){clearHistory(Date.now());reply({ok:true});}
    return false;
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='sync'&&Object.keys(core.defaults).some(k=>changes[k])) {
      const priorHistory=settings.homeHistory;
      settings=core.settings({...settings,...Object.fromEntries(Object.keys(core.defaults).filter(k=>changes[k]).map(k=>[k,changes[k].newValue]))});
      if(!settings.homeHistory){saveGeneration++;clearTimeout(saveTimer);closeHistory();}
      if(!priorHistory&&settings.homeHistory)liveReady=false;
      syncRoute();scheduleSettle();
    }
    if(area==='local') {
      if(changes.flowHistoryClearedAt){clearHistory(changes.flowHistoryClearedAt.newValue);}
      const record=changes[storageKey];
      if(record?.newValue&&(Number(record.newValue.epoch)||0)!==clearEpoch)
        chrome.storage.local.remove(storageKey).catch(()=>{}); // Reject an in-flight write from before Clear.
      else if(record&&!record.newValue&&!changes.flowHistoryClearedAt)clearHistory(clearEpoch);
    }
  });
  async function start() {
    try {
      const s=await chrome.storage.sync.get(core.defaults);settings=core.settings(s);
      const data=await chrome.storage.local.get([storageKey,'flowHistoryClearedAt']);clearEpoch=Number(data.flowHistoryClearedAt)||0;
      if((Number(data[storageKey]?.epoch)||0)===clearEpoch)snapshots=core.history(data[storageKey]?.snapshots);
      index=snapshots.length-1;
    } catch(_){status='设置或历史暂时无法读取，使用原生主题。';statusError=true;}
    ready=true;syncRoute();
    // Bounded maintenance, once per page, never on each UI mutation.
    chrome.storage.local.get(null).then(all=>{
      const records=Object.entries(all).filter(([k])=>k.startsWith('flowHistory:')).sort((a,b)=>(b[1]?.at||0)-(a[1]?.at||0));
      const expired=records.filter(([k,v],i)=>k!==storageKey&&(i>=20||Date.now()-(v?.at||0)>core.TTL)).map(([k])=>k);
      if(expired.length)return chrome.storage.local.remove(expired);
    }).catch(()=>{});
  }
  function domReady() {
    mountSkin();
    themeObserver=new MutationObserver(theme);
    for(const n of [root(),document.body])if(n)themeObserver.observe(n,{attributes:true,attributeFilter:['class','style','data-theme','theme','data-dark']});
    syncRoute();
  }
  mountSkin();start();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',domReady,{once:true});else domReady();
  document.addEventListener('click',nativeClick,true);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&view){show(snapshots.length-1);refs.back?.focus();}
  });
  window.addEventListener('popstate',()=>{lastPath=location.pathname;syncRoute();});
  // A low-frequency path comparison avoids patching the site's History API in an isolated world.
  routeTimer=setInterval(()=>{if(lastPath!==location.pathname){lastPath=location.pathname;liveReady=false;syncRoute();}},1000);
  window.addEventListener('pagehide',()=>{
    clearTimeout(saveTimer);
    if(settings.homeHistory&&snapshots.length){const value={at:Date.now(),epoch:clearEpoch,snapshots:core.history(snapshots)};chrome.storage.local.set({[storageKey]:value}).catch(()=>{});}
  });
  window.addEventListener('pageshow',e=>{if(e.persisted)syncRoute();});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',theme);
})();
