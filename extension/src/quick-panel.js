/* BiliThrottle quick panel — isolated world, top frame of every B 站 page.
 * One floating button opens a small panel with the switches people actually reach for:
 * 刹车 (watch limits) · 首页 (cleanup / infinite feed) · 油门 (playback). Everything is written to
 * chrome.storage.sync, so the page scripts, popup and options page pick it up live.
 */
(function () {
  'use strict';
  const home = globalThis.__BTR_HOME_CORE__, focus = globalThis.__BTR_FOCUS_CORE__;
  if (!home || !focus || window.top !== window || globalThis.__BTR_QUICK__) return;

  const VERSION = chrome.runtime.getManifest().version;
  const PLAY = {enabled: true, mode: 'auto', strategy: 'auto', liveEnabled: true, quickFab: true};
  const DEFAULTS = {...home.defaults, ...focus.defaults, ...PLAY};
  const PRESETS = [
    {name: '自律', hint: '每 5 小时 45 分 · 每周 5 小时', v: {focusWindowMinutes: 45, focusWeeklyHours: 5, focusWindowVideos: 0, focusSessionMinutes: 25, focusBreakMinutes: 5}},
    {name: '适中', hint: '每 5 小时 90 分 · 每周 10 小时', v: {focusWindowMinutes: 90, focusWeeklyHours: 10, focusWindowVideos: 0, focusSessionMinutes: 25, focusBreakMinutes: 5}},
    {name: '放纵', hint: '每 5 小时 3 小时 · 每周 20 小时', v: {focusWindowMinutes: 180, focusWeeklyHours: 20, focusWindowVideos: 0, focusSessionMinutes: 50, focusBreakMinutes: 10}}
  ];
  const EASE = 'cubic-bezier(.2,.75,.25,1)';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const isHome = () => location.hostname === 'www.bilibili.com' && /^\/(?:index\.html)?$/.test(location.pathname);
  const isPlayer = () => /\/(?:video|bangumi\/play|list|medialist|festival|cheese\/play)\//.test(location.pathname) || location.hostname === 'live.bilibili.com';

  let s = {...DEFAULTS}, usage = null, host = null, shadow = null, fab = null, panel = null, tab = '', open = false, posY = null;

  const CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0}
.root{--bg:rgba(255,255,255,.96);--fg:#18191c;--muted:#9499a0;--line:rgba(0,0,0,.07);--soft:#f4f5f7;--soft2:#e9eaec;--pink:#fb7299;--pink2:#ff9dbb;
  font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--fg)}
.root.dark{--bg:rgba(30,31,36,.96);--fg:#e3e5e7;--muted:#8a8f99;--line:rgba(255,255,255,.08);--soft:#2a2b31;--soft2:#34363d}
.fab{position:fixed;right:22px;z-index:2147483000;width:48px;height:48px;border:0;padding:0;border-radius:50%;cursor:pointer;display:grid;place-items:center;
  background:linear-gradient(140deg,var(--pink2),var(--pink));color:#fff;box-shadow:0 6px 20px rgba(251,114,153,.42);touch-action:none;
  transition:transform .18s ${EASE},box-shadow .18s ease}
.fab:hover{transform:scale(1.06);box-shadow:0 8px 26px rgba(251,114,153,.52)}
.fab:active{transform:scale(.96)}
.fab:focus-visible{outline:3px solid rgba(251,114,153,.45);outline-offset:3px}
.fab.dragging{transition:none;cursor:grabbing}
.fab svg.icon{width:26px;height:26px}
.fab .ring{position:absolute;inset:-5px;width:58px;height:58px;transform:rotate(-90deg);pointer-events:none}
.fab .ring circle{fill:none;stroke-width:3}
.fab .ring .track{stroke:rgba(251,114,153,.18)}
.fab .ring .bar{stroke:var(--pink);stroke-linecap:round;transition:stroke-dashoffset .6s ${EASE}}
.fab .ring.full .bar{stroke:#e2484c}
.fab.pulse::after{content:"";position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 0 rgba(251,114,153,.55);animation:pulse 1.8s ease-out infinite}
@keyframes pulse{to{box-shadow:0 0 0 16px rgba(251,114,153,0)}}
.tip{position:fixed;right:84px;z-index:2147483000;max-width:240px;padding:12px 14px;border-radius:14px;background:var(--bg);color:var(--fg);box-shadow:0 10px 30px rgba(0,0,0,.18);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.tip b{display:block;margin-bottom:2px}
.tip p{color:var(--muted);font-size:12px}
.tip button{margin-top:8px;border:0;border-radius:999px;padding:4px 12px;background:var(--pink);color:#fff;font:inherit;font-size:12px;cursor:pointer}
.tip::after{content:"";position:absolute;right:-6px;top:50%;width:12px;height:12px;background:inherit;transform:translateY(-50%) rotate(45deg);border-radius:2px}
.panel:focus{outline:none}
.tabs button:focus-visible{outline:2px solid var(--pink);outline-offset:-2px}
.panel{position:fixed;right:22px;z-index:2147483001;width:348px;max-width:calc(100vw - 24px);max-height:min(640px,calc(100vh - 32px));display:flex;flex-direction:column;
  border-radius:20px;background:var(--bg);box-shadow:0 18px 50px rgba(0,0,0,.22),0 0 0 1px var(--line);backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2);
  transform-origin:100% 100%;overflow:hidden}
.head{display:flex;align-items:center;gap:10px;padding:14px 14px 10px 16px}
.logo{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(140deg,var(--pink2),var(--pink));color:#fff;flex:none}
.logo svg{width:20px;height:20px}
.head h2{font-size:15px;font-weight:700;line-height:1.2}
.head small{display:block;color:var(--muted);font-size:11px;font-weight:400}
.x{margin-left:auto;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;transition:background-color .15s ease}
.x:hover{background:var(--soft)}
.tabs{position:relative;display:grid;grid-template-columns:repeat(3,1fr);margin:0 14px 6px;padding:3px;border-radius:12px;background:var(--soft)}
.tabs button{position:relative;z-index:1;border:0;background:transparent;color:var(--muted);font:inherit;font-weight:600;padding:6px 0;border-radius:9px;cursor:pointer;transition:color .2s ease}
.tabs button[aria-selected=true]{color:var(--fg)}
.tabs .slider{position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px)/3);border-radius:9px;background:var(--bg);box-shadow:0 1px 4px rgba(0,0,0,.12);transition:transform .28s ${EASE}}
.body{overflow:auto;padding:4px 14px 6px;overscroll-behavior:contain}
.page{animation:page .24s ${EASE}}
@keyframes page{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.lead{color:var(--muted);font-size:12px;margin:6px 2px 10px}
.row{display:flex;align-items:center;gap:12px;padding:10px 2px;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
.row .t{flex:1;min-width:0}
.row .t b{display:block;font-weight:600}
.row .t span{display:block;color:var(--muted);font-size:11.5px;line-height:1.45}
.group{margin:4px 0 10px;padding:2px 12px;border-radius:14px;background:var(--soft)}
.group.off{opacity:.55}
.switch{position:relative;flex:none;width:40px;height:23px}
.switch input{position:absolute;inset:0;margin:0;opacity:0;cursor:pointer;z-index:1}
.switch i{position:absolute;inset:0;border-radius:999px;background:var(--soft2);transition:background-color .2s ease}
.switch i::after{content:"";position:absolute;top:3px;left:3px;width:17px;height:17px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .22s ${EASE}}
.switch input:checked+i{background:var(--pink)}
.switch input:checked+i::after{transform:translateX(17px)}
.switch input:focus-visible+i{outline:2px solid var(--pink);outline-offset:2px}
.seg{display:flex;gap:2px;padding:2px;border-radius:10px;background:var(--soft2);flex:none}
.seg button{border:0;background:transparent;color:var(--muted);font:inherit;font-size:12px;padding:3px 9px;border-radius:8px;cursor:pointer;transition:background-color .18s ease,color .18s ease}
.seg button[aria-pressed=true]{background:var(--bg);color:var(--fg);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.meter{padding:10px 2px 4px}
.meter .h{display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}
.meter .h b{color:var(--fg);font-variant-numeric:tabular-nums}
.meter .track{height:7px;margin:6px 0 4px;border-radius:999px;background:var(--soft2);overflow:hidden}
.meter .track i{display:block;height:100%;width:0;border-radius:inherit;background:linear-gradient(90deg,var(--pink2),var(--pink));transition:width .6s ${EASE}}
.meter .track i.full{background:#e2484c}
.meter small{color:var(--muted);font-size:11px}
.presets{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0 6px}
.presets button{border:1px solid var(--line);background:var(--bg);color:var(--fg);font:inherit;border-radius:12px;padding:8px 4px 6px;cursor:pointer;text-align:center;transition:border-color .18s ease,background-color .18s ease,transform .12s ease}
.presets button:hover{border-color:var(--pink)}
.presets button:active{transform:scale(.97)}
.presets button[aria-pressed=true]{border-color:var(--pink);background:rgba(251,114,153,.1);color:var(--pink)}
.presets b{display:block;font-size:13px}
.presets span{display:block;font-size:10.5px;color:var(--muted);line-height:1.35;margin-top:2px}
.wide{width:100%;margin:8px 0 4px;border:0;border-radius:12px;padding:9px;background:var(--soft);color:var(--fg);font:inherit;font-weight:600;cursor:pointer;transition:background-color .18s ease}
.wide:hover{background:var(--soft2)}
.foot{display:flex;gap:4px;align-items:center;padding:8px 12px 12px;border-top:1px solid var(--line)}
.foot button{border:0;background:transparent;color:var(--muted);font:inherit;font-size:12px;padding:5px 8px;border-radius:8px;cursor:pointer;transition:background-color .15s ease,color .15s ease}
.foot button:hover{background:var(--soft);color:var(--fg)}
.foot .grow{flex:1}
.toast{position:fixed;right:22px;z-index:2147483002;padding:8px 14px;border-radius:999px;background:rgba(24,25,28,.92);color:#fff;font-size:12px;pointer-events:none}
button:focus-visible{outline:2px solid var(--pink);outline-offset:2px}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;
  const ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3.5 9 6M17 3.5 15 6"/><rect x="2.5" y="6" width="19" height="15" rx="4.5"/><path d="M7 16.5a5 5 0 0 1 10 0"/><path d="m12 16.5 2.6-3"/></svg>';

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function btn(text, cls, fn) { const b = el('button', cls, text); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; }
  const save = obj => chrome.storage.sync.set(obj).catch(() => toast('保存失败，请稍后再试'));

  function dark() {
    for (const n of [document.body, document.documentElement]) {
      if (!n) continue;
      const m = getComputedStyle(n).backgroundColor.match(/[\d.]+/g);
      if (m && m.length >= 3 && (m.length < 4 || Number(m[3]) > .1)) return (m[0] * .2126 + m[1] * .7152 + m[2] * .0722) < 110;
    }
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /* ---------- controls ---------- */
  function sw(key, label, hint, invert) {
    const r = el('div', 'row'), t = el('div', 't'), lab = el('label', 'switch'), input = el('input'), id = `q-${key}`;
    input.type = 'checkbox'; input.id = id; input.setAttribute('role', 'switch');
    input.checked = invert ? !s[key] : !!s[key];
    input.addEventListener('change', () => save({[key]: invert ? !input.checked : input.checked}));
    const b = el('b', null, label); t.append(b); if (hint) t.append(el('span', null, hint));
    const l = el('label'); l.htmlFor = id; l.append(t); l.style.flex = '1'; l.style.cursor = 'pointer';
    lab.append(input, el('i')); r.append(l, lab);
    return r;
  }
  function seg(key, label, hint, options) {
    const r = el('div', 'row'), t = el('div', 't'), g = el('div', 'seg');
    t.append(el('b', null, label)); if (hint) t.append(el('span', null, hint));
    for (const [value, text] of options) {
      const b = btn(text, null, () => save({[key]: value}));
      b.setAttribute('aria-pressed', String(String(s[key]) === String(value)));
      g.append(b);
    }
    g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
    r.append(t, g);
    return r;
  }
  function meter(label, m, extra) {
    const w = el('div', 'meter'), h = el('div', 'h'), tr = el('div', 'track'), fill = el('i');
    h.append(el('span', null, label), el('b', null, m.limit ? `已用 ${m.percent}%` : `已看 ${focus.fmt(m.seconds)}`));
    tr.append(fill);
    requestAnimationFrame(() => { fill.style.width = `${m.limit ? m.percent : 0}%`; });
    if (m.limit && m.seconds >= m.limit) fill.className = 'full';
    w.append(h, tr, el('small', null, `${m.limit ? `${focus.fmt(m.seconds)} / ${focus.fmt(m.limit)} · ` : ''}${focus.fmtReset(m.resetAt)}${m.resetAt ? ' 重置' : ''}${extra || ''}`));
    return w;
  }

  /* ---------- pages ---------- */
  function brake() {
    const p = el('div', 'page');
    p.append(el('p', 'lead', '像 Claude Code 一样计量：5 小时窗口 + 每周额度，到点自动重置。'));
    p.append(sw('focusEnabled', '启用观看额度', '额度用完时暂停视频并提示'));
    if (usage?.window) {
      const g = el('div', 'group' + (s.focusEnabled ? '' : ' off'));
      g.append(meter('当前 5 小时窗口', usage.window, usage.videoLimit ? ` · 视频 ${usage.videos}/${usage.videoLimit}` : ''), meter('本周', usage.week));
      p.append(g);
    }
    const pr = el('div', 'presets');
    for (const preset of PRESETS) {
      const b = btn('', null, () => save({...preset.v, focusEnabled: true}));
      b.append(el('b', null, preset.name), el('span', null, preset.hint));
      b.setAttribute('aria-pressed', String(Object.entries(preset.v).every(([k, v]) => s[k] === v)));
      pr.append(b);
    }
    p.append(pr);
    const g = el('div', 'group');
    g.append(sw('focusStrict', '严格模式', '不给“再看 5 分钟 / 跳过休息”'),
      seg('focusSessionMinutes', '番茄钟', `连续看满后休息 ${s.focusBreakMinutes} 分钟`, [[0, '关'], [25, '25'], [45, '45']]));
    p.append(g);
    return p;
  }
  function homepage() {
    const p = el('div', 'page');
    p.append(el('p', 'lead', isHome() ? '改动立即作用在当前首页。' : '这些设置作用在 B 站首页。'));
    p.append(sw('homeInfinite', '无限下滑', '快到底时自动加载更多推荐，按「第 N 批」接在下面'));
    if (s.homeInfinite) {
      const g = el('div', 'group');
      g.append(seg('homeInfiniteSize', '每批视频数', '每次请求 12 个，与 B 站相同', [[12, '12'], [24, '24'], [36, '36']]),
        seg('homeInfiniteThreads', '加载速度', '同时请求数；越快越容易被限流', [[1, '稳'], [2, '标准'], [3, '快']]));
      p.append(g);
    }
    const g = el('div', 'group');
    g.append(sw('homeEnabled', '首页净化与操作栏', '关闭即恢复 B 站原生首页'),
      sw('homeHideCarousel', '移除大图轮播'), sw('homeHideAds', '隐藏广告卡片', '只按明确的广告标记'),
      sw('homeHistory', '换一批可回看', '本地保存每一批推荐'), sw('homeHideBanner', '收起顶部季节横幅'));
    p.append(g);
    p.append(seg('homeTheme', '首页背景', 'B 站深色模式下可换成纯黑', [['native', '原生'], ['oled', '纯黑']]));
    return p;
  }
  function throttle() {
    const p = el('div', 'page');
    p.append(el('p', 'lead', '多 CDN / Range 并发加速，清晰度仍由 B 站播放器决定。'));
    p.append(sw('enabled', '视频加速', '出现黑屏时先关掉这里试试'));
    const g = el('div', 'group' + (s.enabled ? '' : ' off'));
    g.append(seg('mode', 'CDN 路线', null, [['auto', '自动'], ['mainland', '大陆'], ['overseas', '海外']]),
      seg('strategy', '观看策略', null, [['auto', '自动'], ['smooth', '稳播'], ['fast', '起播'], ['economy', '省流']]),
      sw('liveEnabled', '直播加速'));
    p.append(g);
    if (isPlayer()) p.append(btn('高级播放设置（线程数、播放内核、诊断）', 'wide', () => {
      close();
      window.postMessage({channel: '__BILI_RANGE_ACCELERATOR_V1__', type: 'open-settings', payload: {toggle: true}}, '*');
    }));
    return p;
  }

  /* ---------- shell ---------- */
  function ensureHost() {
    if (host?.isConnected) return;
    host = el('div'); host.id = 'btr-quick'; host.dataset.btrFlowOwned = '';
    shadow = host.attachShadow({mode: 'open'});
    shadow.append(el('style', null, CSS));
    const root = el('div', 'root'); shadow.append(root);
    document.documentElement.append(host);
    document.documentElement.toggleAttribute('data-btr-quick', true);
  }
  const root = () => shadow.querySelector('.root');

  function fabY() { return posY ?? Math.max(120, Math.round(innerHeight * .18)); }
  function placeFab() { if (fab) fab.style.bottom = `${fabY()}px`; }

  function renderFab() {
    ensureHost();
    root().classList.toggle('dark', dark());
    if (!s.quickFab) { fab?.remove(); fab = null; return; }
    if (!fab) {
      fab = btn('', 'fab'); fab.innerHTML = ICON + '<svg class="ring" viewBox="0 0 58 58" aria-hidden="true"><circle class="track" cx="29" cy="29" r="26"/><circle class="bar" cx="29" cy="29" r="26"/></svg>';
      fab.setAttribute('aria-label', '哔哩节流阀快捷面板'); fab.title = '哔哩节流阀 · 快捷面板（Alt+T）';
      fab.addEventListener('click', e => { if (fab.dataset.dragged) { delete fab.dataset.dragged; return; } toggle(); });
      drag(fab);
      root().append(fab); placeFab();
    }
    const ring = fab.querySelector('.ring'), bar = ring.querySelector('.bar'), C = 2 * Math.PI * 26;
    const m = usage?.window;
    const show = s.focusEnabled && m?.limit;
    ring.style.display = show ? '' : 'none';
    if (show) {
      bar.setAttribute('stroke-dasharray', String(C));
      bar.setAttribute('stroke-dashoffset', String(C * (1 - Math.min(1, m.seconds / m.limit))));
      ring.classList.toggle('full', m.seconds >= m.limit);
      fab.title = `哔哩节流阀 · 5 小时窗口已用 ${m.percent}%（Alt+T）`;
    }
  }

  // Vertical drag so the button never sits on top of something the reader needs.
  function drag(b) {
    let startY = 0, startBottom = 0, moved = false;
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      startY = e.clientY; startBottom = fabY(); moved = false; b.setPointerCapture(e.pointerId);
    });
    b.addEventListener('pointermove', e => {
      if (!b.hasPointerCapture(e.pointerId)) return;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dy) < 5) return;
      moved = true; b.classList.add('dragging');
      posY = Math.max(16, Math.min(innerHeight - 64, startBottom - dy)); placeFab();
      if (open) positionPanel();
    });
    b.addEventListener('pointerup', e => {
      if (!b.hasPointerCapture(e.pointerId)) return;
      b.releasePointerCapture(e.pointerId); b.classList.remove('dragging');
      if (moved) { b.dataset.dragged = '1'; chrome.storage.local.set({flowQuickY: posY}).catch(() => {}); }
    });
  }

  function positionPanel() {
    if (!panel) return;
    const bottom = fab ? fabY() + 60 : 24;
    const room = innerHeight - bottom - 16;
    if (room >= 360) { panel.style.bottom = `${bottom}px`; panel.style.top = ''; }
    else { panel.style.bottom = '16px'; panel.style.right = fab ? '84px' : '22px'; }
  }

  function render() {
    if (!panel) return;
    const body = panel.querySelector('.body'), switched = body.dataset.tab !== tab, keep = switched ? 0 : body.scrollTop;
    const page = tab === 'brake' ? brake() : tab === 'home' ? homepage() : throttle();
    if (!switched) page.style.animation = 'none'; // Re-render after a toggle: no entrance motion.
    body.replaceChildren(page); body.dataset.tab = tab;
    body.scrollTop = keep;
    const tabs = [...panel.querySelectorAll('.tabs button')];
    tabs.forEach((b, i) => { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); if (b.dataset.tab === tab) panel.querySelector('.slider').style.transform = `translateX(${i * 100}%)`; });
  }

  function build() {
    panel = el('div', 'panel'); panel.tabIndex = -1; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '哔哩节流阀快捷面板');
    const head = el('div', 'head'), logo = el('div', 'logo'); logo.innerHTML = ICON;
    const h = el('div'); const title = el('h2', null, '哔哩节流阀'); title.append(el('small', null, `油门帮你踩，刹车也帮你踩 · v${VERSION}`)); h.append(title);
    head.append(logo, h, btn('×', 'x', close));
    head.querySelector('.x').setAttribute('aria-label', '关闭');
    const tabs = el('div', 'tabs'); tabs.setAttribute('role', 'tablist');
    tabs.append(el('span', 'slider'));
    for (const [id, text] of [['brake', '刹车'], ['home', '首页'], ['play', '油门']]) {
      const b = btn(text, null, () => { tab = id; chrome.storage.local.set({flowQuickTab: id}).catch(() => {}); render(); });
      b.dataset.tab = id; b.setAttribute('role', 'tab'); tabs.append(b);
    }
    const foot = el('div', 'foot');
    foot.append(btn('完整设置', null, () => chrome.runtime.sendMessage({type: 'flow-open-options'}).catch(() => {})),
      btn('使用指南', null, () => chrome.runtime.sendMessage({type: 'flow-open-welcome'}).catch(() => {})),
      el('span', 'grow'),
      btn(s.quickFab ? '隐藏悬浮按钮' : '显示悬浮按钮', null, () => {
        const next = !s.quickFab; save({quickFab: next});
        toast(next ? '悬浮按钮已显示' : '已隐藏，可从扩展图标再打开快捷面板'); if (!next) close();
      }));
    panel.append(head, tabs, el('div', 'body'), foot);
    root().append(panel);
  }

  async function refreshUsage() {
    try { const r = await chrome.runtime.sendMessage({type: 'focus-check'}); if (r?.window) usage = r; } catch (_) {}
  }

  async function openPanel(which) {
    ensureHost(); root().classList.toggle('dark', dark());
    await refreshUsage();
    if (which) tab = which;
    if (!panel) build();
    open = true; positionPanel(); render();
    if (!reduced.matches) panel.animate([{opacity: 0, transform: 'translateY(10px) scale(.96)'}, {opacity: 1, transform: 'none'}], {duration: 240, easing: EASE});
    panel.focus({preventScroll: true}); // Focus the dialog itself; Tab then walks into the controls.
    dismissTip();
  }
  function close() {
    if (!panel || !open) return;
    open = false;
    const p = panel; panel = null;
    if (reduced.matches) { p.remove(); return; }
    p.animate([{opacity: 1, transform: 'none'}, {opacity: 0, transform: 'translateY(8px) scale(.97)'}], {duration: 160, easing: 'ease-in', fill: 'forwards'}).finished.then(() => p.remove(), () => p.remove());
    fab?.focus({preventScroll: true});
  }
  function toggle(which) { if (open && (!which || which === tab)) close(); else openPanel(which || tab); }

  let toastTimer;
  function toast(text) {
    ensureHost(); root().querySelector('.toast')?.remove(); clearTimeout(toastTimer);
    const t = el('div', 'toast', text); t.style.bottom = `${(fab ? fabY() : 24) + 60}px`; root().append(t);
    if (!reduced.matches) t.animate([{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'none'}], {duration: 200, easing: EASE});
    toastTimer = setTimeout(() => t.remove(), 2600);
  }

  // One-time hint next to the button for new users.
  let tip = null;
  function showTip() {
    if (!fab || tip) return;
    tip = el('div', 'tip'); tip.setAttribute('role', 'status');
    tip.append(el('b', null, '常用开关都在这里'), el('p', null, '观看额度、无限下滑、首页净化、播放加速——点一下就能开关。按钮可以上下拖动。'));
    tip.append(btn('知道了', null, dismissTip));
    tip.style.bottom = `${fabY() + 2}px`;
    root().append(tip); fab.classList.add('pulse');
    if (!reduced.matches) tip.animate([{opacity: 0, transform: 'translateX(8px)'}, {opacity: 1, transform: 'none'}], {duration: 300, easing: EASE});
  }
  function dismissTip() {
    if (!tip) return;
    tip.remove(); tip = null; fab?.classList.remove('pulse');
    chrome.storage.local.set({flowQuickTipSeen: true}).catch(() => {});
  }

  document.addEventListener('keydown', e => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 't' || e.key === 'T' || e.code === 'KeyT')) { e.preventDefault(); toggle(); }
    else if (e.key === 'Escape' && open) close();
  }, true);
  document.addEventListener('pointerdown', e => { if (open && host && !e.composedPath().includes(host)) close(); }, true);
  addEventListener('resize', () => { placeFab(); if (open) positionPanel(); }, {passive: true});

  chrome.runtime.onMessage.addListener((m, sender) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (m?.type === 'flow-quick-open') openPanel(m.tab || tab);
    return false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !Object.keys(changes).some(k => k in DEFAULTS)) return;
    for (const k of Object.keys(DEFAULTS)) if (changes[k]) s[k] = changes[k].newValue;
    s = {...s, ...home.settings(s), ...focus.settings(s)};
    if (panel) { refreshUsage().then(render); const f = panel.querySelector('.foot button:last-child'); if (f) f.textContent = s.quickFab ? '隐藏悬浮按钮' : '显示悬浮按钮'; }
    renderFab();
  });

  async function start() {
    try {
      const [sync, local] = await Promise.all([chrome.storage.sync.get(DEFAULTS), chrome.storage.local.get(['flowQuickY', 'flowQuickTab', 'flowQuickTipSeen'])]);
      s = {...sync, ...home.settings(sync), ...focus.settings(sync)};
      if (Number.isFinite(local.flowQuickY)) posY = local.flowQuickY;
      tab = isHome() ? 'home' : isPlayer() ? 'play' : ['brake', 'home', 'play'].includes(local.flowQuickTab) ? local.flowQuickTab : 'brake';
      await refreshUsage();
      renderFab();
      if (!local.flowQuickTipSeen) setTimeout(showTip, 1200);
    } catch (_) {}
    setInterval(() => { if (!document.hidden && s.focusEnabled) refreshUsage().then(() => { renderFab(); if (open && tab === 'brake') render(); }); }, 30000);
  }

  globalThis.__BTR_QUICK__ = {open: which => openPanel(which), close, toggle};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
})();
