/* BiliThrottle quick panel — isolated world, top frame of every B 站 page.
 * One floating button opens a small panel with the switches people actually reach for:
 * 刹车 (watch limits) · 首页 (cleanup / infinite feed) · 油门 (playback). Settings go to
 * chrome.storage.sync; watch-limit settings go through the service worker so the
 * self-discipline lock can hold back changes that loosen them.
 */
(function () {
  'use strict';
  const home = globalThis.__BTR_HOME_CORE__, focus = globalThis.__BTR_FOCUS_CORE__, ui = globalThis.__BTR_UI__;
  const filt = globalThis.__BTR_FILTER_CORE__, clean = globalThis.__BTR_CLEAN_CORE__, sbc = globalThis.__BTR_SB_CORE__;
  if (!home || !focus || !ui || !filt || !clean || !sbc || window.top !== window || globalThis.__BTR_QUICK__) return;

  const VERSION = chrome.runtime.getManifest().version;
  const PLAY = {enabled: true, mode: 'auto', strategy: 'auto', liveEnabled: true, quickFab: true};
  const DEFAULTS = {...home.defaults, ...focus.defaults, ...filt.defaults, ...clean.defaults, ...sbc.defaults, ...PLAY};
  const norm = raw => ({...raw, ...home.settings(raw), ...focus.settings(raw), ...filt.settings(raw), ...clean.settings(raw), ...sbc.settings(raw)});
  const FOCUS_KEYS = new Set(Object.keys(focus.defaults));
  const RELOAD_KEYS = new Set(['enabled', 'liveEnabled']); // Player hooks are installed at page start.
  const PRESETS = [
    {name: '自律', hint: '每 5 小时 45 分 · 每周 5 小时', v: {focusWindowMinutes: 45, focusWeeklyHours: 5, focusWindowVideos: 0, focusSessionMinutes: 25, focusBreakMinutes: 5}},
    {name: '适中', hint: '每 5 小时 90 分 · 每周 10 小时', v: {focusWindowMinutes: 90, focusWeeklyHours: 10, focusWindowVideos: 0, focusSessionMinutes: 25, focusBreakMinutes: 5}},
    {name: '放纵', hint: '每 5 小时 3 小时 · 每周 20 小时', v: {focusWindowMinutes: 180, focusWeeklyHours: 20, focusWindowVideos: 0, focusSessionMinutes: 50, focusBreakMinutes: 10}}
  ];
  const {EASE, MOTION} = ui;
  const reduced = ui.reduced;
  const isHome = () => location.hostname === 'www.bilibili.com' && /^\/(?:index\.html)?$/.test(location.pathname);
  const isPlayer = () => /\/(?:video|bangumi\/play|list|medialist|festival|cheese\/play)\//.test(location.pathname) || location.hostname === 'live.bilibili.com';

  let s = {...DEFAULTS}, usage = null, lock = {locked: false}, host = null, shadow = null, fab = null, panel = null, tab = '', open = false, posY = null;
  let controls = [], structure = '', meterSeen = new Map();

  const CSS = `
:host{all:initial}
${ui.scoped('.root')}
*{box-sizing:border-box;margin:0}
[hidden]{display:none!important}
.root{--bg:var(--btr-bg-float);--fg:var(--btr-text1);--muted:var(--btr-text2);--faint:var(--btr-text3);--line:rgba(0,0,0,.07);--soft:var(--btr-bg2);--soft2:var(--btr-soft2);--pink:var(--btr-brand);--pink2:#ff9dbb;
  font:13px/1.5 var(--btr-font);color:var(--fg)}
.root.dark{--line:rgba(255,255,255,.08);--soft:var(--btr-soft)}
.fab{position:fixed;right:22px;z-index:2147483000;width:48px;height:48px;border:0;padding:0;border-radius:50%;cursor:pointer;display:grid;place-items:center;
  background:linear-gradient(140deg,var(--pink2),var(--pink));color:#fff;box-shadow:0 6px 20px rgba(251,114,153,.42);touch-action:none;
  transition:transform var(--btr-fast) var(--btr-ease),box-shadow var(--btr-fast) ease}
.fab:hover{transform:scale(1.06);box-shadow:0 8px 26px rgba(251,114,153,.52)}
.fab:active{transform:scale(.96)}
.fab:focus-visible{outline:3px solid var(--btr-brand-ring);outline-offset:3px}
.fab.dragging{transition:none;cursor:grabbing}
.fab svg.icon{width:26px;height:26px}
.fab .ring{position:absolute;inset:-5px;width:58px;height:58px;transform:rotate(-90deg);pointer-events:none}
.fab .ring circle{fill:none;stroke-width:3}
.fab .ring .track{stroke:rgba(251,114,153,.18)}
.fab .ring .bar{stroke:var(--pink);stroke-linecap:round;transition:stroke-dashoffset .6s var(--btr-ease)}
.fab .ring.full .bar{stroke:var(--btr-danger)}
.fab.pulse::after{content:"";position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 0 rgba(251,114,153,.55);animation:pulse 1.8s ease-out infinite}
@keyframes pulse{to{box-shadow:0 0 0 16px rgba(251,114,153,0)}}
.tip{position:fixed;right:84px;z-index:2147483000;max-width:240px;padding:12px 14px;border-radius:14px;background:var(--bg);color:var(--fg);box-shadow:0 10px 30px rgba(0,0,0,.18);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.tip b{display:block;margin-bottom:2px}
.tip p{color:var(--muted);font-size:12px}
.tip button{margin-top:8px;border:0;border-radius:999px;padding:4px 12px;background:var(--pink);color:#fff;font:inherit;font-size:12px;cursor:pointer}
.tip::after{content:"";position:absolute;right:-6px;top:50%;width:12px;height:12px;background:inherit;transform:translateY(-50%) rotate(45deg);border-radius:2px}
.panel:focus{outline:none}
.panel{position:fixed;right:22px;z-index:var(--btr-panel-z,1001);width:348px;max-width:calc(100vw - 24px);max-height:min(640px,calc(100vh - 32px));display:flex;flex-direction:column;
  border-radius:20px;background:var(--bg);box-shadow:var(--btr-shadow),0 0 0 1px var(--line);backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2);
  transform-origin:100% 100%;overflow:hidden}
.head{display:flex;align-items:center;gap:10px;padding:14px 14px 10px 16px}
.logo{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(140deg,var(--pink2),var(--pink));color:#fff;flex:none}
.logo svg{width:20px;height:20px}
.head h2{font-size:15px;font-weight:700;line-height:1.2}
.head small{display:block;color:var(--muted);font-size:12px;font-weight:400}
.x{margin-left:auto;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;transition:background-color var(--btr-fast) ease}
.x:hover{background:var(--soft)}
.tabs{position:relative;display:grid;grid-template-columns:repeat(4,1fr);margin:0 14px 6px;padding:3px;border-radius:12px;background:var(--soft)}
.tabs button{position:relative;z-index:1;border:0;background:transparent;color:var(--muted);font:inherit;font-weight:600;padding:6px 0;border-radius:9px;cursor:pointer;transition:color var(--btr-mid) ease}
.tabs button[aria-selected=true]{color:var(--fg)}
.tabs button:focus-visible{outline:2px solid var(--pink);outline-offset:-2px}
.tabs .slider{position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px)/4);border-radius:9px;background:var(--btr-bg);box-shadow:0 1px 4px rgba(0,0,0,.12);transition:transform var(--btr-mid) var(--btr-ease)}
.body{overflow:auto;padding:4px 14px 6px;overscroll-behavior:contain;flex:1 1 auto;min-height:0}
.page{animation:page var(--btr-mid) var(--btr-ease)}
@keyframes page{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.lead{color:var(--muted);font-size:12px;margin:6px 2px 10px}
.row{display:flex;align-items:center;gap:12px;padding:10px 2px;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
.row .t{flex:1;min-width:0}
.row .t b{display:block;font-weight:600}
.row .t span{display:block;color:var(--muted);font-size:12px;line-height:1.45}
.group{margin:4px 0 10px;padding:2px 12px;border-radius:14px;background:var(--soft);transition:opacity var(--btr-mid) ease}
.group.off>:not(.offhint){opacity:.45}
.group[inert]{cursor:not-allowed}
.offhint{display:flex;gap:6px;align-items:center;padding:8px 2px 2px;color:var(--muted);font-size:12px}
.switch{position:relative;flex:none;width:40px;height:23px}
.switch input{position:absolute;inset:0;margin:0;opacity:0;cursor:pointer;z-index:1}
.switch i{position:absolute;inset:0;border-radius:999px;background:var(--soft2);transition:background-color var(--btr-mid) ease}
.switch i::after{content:"";position:absolute;top:3px;left:3px;width:17px;height:17px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform var(--btr-mid) var(--btr-ease)}
.switch input:checked+i{background:var(--pink)}
.switch input:checked+i::after{transform:translateX(17px)}
.switch input:focus-visible+i{outline:2px solid var(--pink);outline-offset:2px}
.seg{position:relative;display:flex;gap:2px;padding:2px;border-radius:10px;background:var(--soft2);flex:none}
.seg .thumb{position:absolute;top:2px;bottom:2px;left:0;width:0;border-radius:8px;background:var(--btr-bg);box-shadow:0 1px 3px rgba(0,0,0,.12);pointer-events:none;opacity:0}
.seg .thumb.ready{transition:transform var(--btr-mid) var(--btr-ease),width var(--btr-mid) var(--btr-ease)}
.seg button{position:relative;z-index:1;border:0;background:transparent;color:var(--muted);font:inherit;font-size:12px;padding:3px 9px;border-radius:8px;cursor:pointer;transition:color var(--btr-fast) ease}
.seg button[aria-pressed=true]{color:var(--fg)}
.seg button:hover{color:var(--fg)}
.meter{padding:10px 2px 4px}
.meter .h{display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}
.meter .h b{color:var(--fg);font-variant-numeric:tabular-nums}
.meter .track{height:7px;margin:6px 0 4px;border-radius:999px;background:var(--soft2);overflow:hidden}
.meter .track i{display:block;height:100%;width:100%;border-radius:inherit;background:linear-gradient(90deg,var(--pink2),var(--pink));transform-origin:0 50%;transform:scaleX(0);transition:transform .6s var(--btr-ease)}
.meter .track i.full{background:var(--btr-danger)}
.meter small{color:var(--muted);font-size:12px}
.presets{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0 6px}
.presets button{border:1px solid var(--line);background:var(--btr-bg);color:var(--fg);font:inherit;border-radius:12px;padding:8px 4px 6px;cursor:pointer;text-align:center;transition:border-color var(--btr-fast) ease,background-color var(--btr-fast) ease,transform var(--btr-fast) ease}
.presets button:hover{border-color:var(--pink)}
.presets button:active{transform:scale(.97)}
.presets button[aria-pressed=true]{border-color:var(--pink);background:var(--btr-brand-soft);color:var(--pink)}
.presets b{display:block;font-size:13px}
.presets span{display:block;font-size:11px;color:var(--muted);line-height:1.35;margin-top:2px}
.wide{width:100%;margin:8px 0 4px;border:0;border-radius:12px;padding:9px;background:var(--soft);color:var(--fg);font:inherit;font-weight:600;cursor:pointer;transition:background-color var(--btr-fast) ease}
.wide:hover{background:var(--soft2)}
.lock{margin:4px 0 10px;padding:10px 12px;border-radius:14px;background:var(--btr-brand-soft);color:var(--fg)}
.lock>b{display:flex;align-items:center;gap:6px}
.lock p{color:var(--muted);font-size:12px;margin-top:2px}
.lock ul{list-style:none;padding:0;margin:8px 0 0;display:grid;gap:6px}
.lock li{display:flex;align-items:center;gap:8px;font-size:12px}
.lock li span{flex:1;min-width:0}
.lock li small{display:block;color:var(--muted)}
.lock .mini{border:1px solid var(--line);background:var(--btr-bg);color:var(--fg);font:inherit;font-size:12px;border-radius:8px;padding:2px 8px;cursor:pointer}
.lock .mini:hover{border-color:var(--pink)}
.lock form{display:flex;gap:6px;margin-top:8px}
.lock input{flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:5px 8px;background:var(--btr-bg);color:var(--fg);font:inherit;font-size:12px}
.lock input:focus{outline:none;border-color:var(--pink);box-shadow:0 0 0 3px var(--btr-brand-soft)}
.lock .pwerr{margin:6px 0 0;font-size:12px;color:var(--btr-danger)}.lock .pwerr[hidden]{display:none}
.lock input[aria-invalid]{border-color:var(--btr-danger)}
.lock form button{border:0;border-radius:8px;padding:5px 10px;background:var(--pink);color:#fff;font:inherit;font-size:12px;cursor:pointer}
.modes{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:2px 0 10px}
.modes button{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;border:1.5px solid var(--line);background:var(--btr-bg);color:var(--fg);font:inherit;border-radius:14px;padding:10px 12px;cursor:pointer;transition:border-color var(--btr-fast) ease,background-color var(--btr-fast) ease,transform var(--btr-fast) ease}
.modes button:hover{border-color:var(--pink)}.modes button:active{transform:scale(.98)}
.modes button[aria-checked=true]{border-color:var(--pink);background:var(--btr-brand-soft)}
.modes b{font-size:13px}.modes button[aria-checked=true] b{color:var(--pink)}
.modes span{font-size:11px;color:var(--muted);line-height:1.4}
.sub{margin:12px 2px 4px;font-size:12px;font-weight:600;color:var(--muted)}
.chips{padding:8px 2px 4px}
.chips .add{display:flex;gap:6px;margin:8px 0 6px}
.chips input{flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:5px 8px;background:var(--btr-bg);color:var(--fg);font:inherit;font-size:12px}
.chips input:focus{outline:none;border-color:var(--pink);box-shadow:0 0 0 3px var(--btr-brand-soft)}
.chips .add button{border:0;border-radius:8px;padding:5px 10px;background:var(--pink);color:#fff;font:inherit;font-size:12px;cursor:pointer}
.chips ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px;max-height:118px;overflow:auto}
.chips li{display:inline-flex;align-items:center;gap:2px;max-width:100%;padding:2px 4px 2px 10px;border-radius:999px;background:var(--btr-bg);border:1px solid var(--line);font-size:12px}
.chips li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chips li button{border:0;background:transparent;color:var(--muted);font:14px/1 sans-serif;width:18px;height:18px;border-radius:50%;cursor:pointer;padding:0}
.chips li button:hover{background:var(--soft2);color:var(--fg)}
.chips .empty{color:var(--faint);font-size:12px;padding:2px 0 4px}
.chips .more{border:0;background:transparent;color:var(--pink);font:inherit;font-size:12px;cursor:pointer;padding:6px 0 0}
.note{margin:6px 2px 10px;padding:8px 10px;border-radius:10px;background:var(--soft);color:var(--muted);font-size:12px;line-height:1.5}
.foot{display:flex;gap:4px;align-items:center;padding:8px 12px 12px;border-top:1px solid var(--line)}
.foot button{border:0;background:transparent;color:var(--muted);font:inherit;font-size:12px;padding:5px 8px;border-radius:8px;cursor:pointer;transition:background-color var(--btr-fast) ease,color var(--btr-fast) ease}
.foot button:hover{background:var(--soft);color:var(--fg)}
.foot .grow{flex:1}
.panel{transition:opacity var(--btr-mid) var(--btr-ease)}.panel.veiled{opacity:0;pointer-events:none}
@media (prefers-reduced-motion:reduce){.panel{transition:none}}
.toast{position:fixed;right:22px;z-index:2147483002;display:flex;align-items:center;gap:10px;max-width:min(360px,calc(100vw - 44px));padding:8px 14px;border-radius:999px;background:rgba(24,25,28,.92);color:#fff;font-size:12px;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.toast button{pointer-events:auto;border:0;border-radius:999px;padding:3px 10px;background:var(--pink);color:#fff;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
button:focus-visible{outline:2px solid var(--pink);outline-offset:2px}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;
  const ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3.5 9 6M17 3.5 15 6"/><rect x="2.5" y="6" width="19" height="15" rx="4.5"/><path d="M7 16.5a5 5 0 0 1 10 0"/><path d="m12 16.5 2.6-3"/></svg>';

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function btn(text, cls, fn) { const b = el('button', cls, text); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; }

  /* ---------- saving ---------- */
  const fmtAt = at => focus.fmtReset(at);
  // Watch-limit keys go through the service worker so the self-discipline lock can defer loosening.
  async function save(obj, password) {
    const f = {}, other = {};
    for (const [k, v] of Object.entries(obj)) (FOCUS_KEYS.has(k) ? f : other)[k] = v;
    try {
      if (Object.keys(other).length) await chrome.storage.sync.set(other);
      if (Object.keys(f).length) {
        const r = await chrome.runtime.sendMessage({type: 'focus-set', changes: f, password});
        if (r?.lock) lock = r.lock;
        if (r?.error) { toast(r.error); patch(); return r; }
        const later = Object.values(r?.deferred || {});
        if (later.length) {
          toast(`自律锁：放宽的改动将在 ${fmtAt(Math.max(...later))} 生效`, {label: '管理', fn: () => openOptions('lock')});
          rebuildOrPatch();
        }
        return r;
      }
    } catch (_) { toast('保存失败，请稍后再试'); patch(); }
    return null;
  }
  /** Ask the service worker to open a page; a worker that is just waking up can drop the first
   * request, so wait for its answer and try once more before telling the user. */
  async function openPage(type, hash) {
    for (let i = 0; i < 2; i++) {
      const r = await Promise.race([
        chrome.runtime.sendMessage({type, hash}).catch(() => null),
        new Promise(res => setTimeout(res, 1500, null))
      ]);
      if (r?.ok) return true;
    }
    toast('没能打开页面，请从扩展图标的菜单进入「选项」');
    return false;
  }
  const openOptions = hash => openPage('flow-open-options', hash);

  /* ---------- controls: build once, then patch in place ---------- */
  function sw(key, label, hint, opts = {}) {
    const r = el('div', 'row'), t = el('div', 't'), lab = el('label', 'switch'), input = el('input'), id = `q-${key}`;
    input.type = 'checkbox'; input.id = id; input.setAttribute('role', 'switch');
    const read = () => !!s[key];
    input.checked = read();
    input.addEventListener('change', () => {
      save({[key]: input.checked});
      if (RELOAD_KEYS.has(key) && isPlayer()) toast('刷新页面后对当前视频生效', {label: '刷新', fn: () => location.reload()});
      if (opts.onChange) opts.onChange(input.checked);
    });
    const b = el('b', null, label); t.append(b);
    const hs = hint ? el('span', null, typeof hint === 'function' ? hint() : hint) : null; if (hs) t.append(hs);
    const l = el('label'); l.htmlFor = id; l.append(t); l.style.flex = '1'; l.style.cursor = 'pointer';
    lab.append(input, el('i')); r.append(l, lab);
    controls.push(() => { if (input.checked !== read()) input.checked = read(); if (hs && typeof hint === 'function') hs.textContent = hint(); });
    return r;
  }
  function seg(key, label, hint, options) {
    const r = el('div', 'row'), t = el('div', 't'), g = el('div', 'seg'), thumb = el('i', 'thumb');
    t.append(el('b', null, label)); if (hint) t.append(el('span', null, typeof hint === 'function' ? hint() : hint));
    g.append(thumb);
    const buttons = options.map(([value, text]) => {
      const b = btn(text, null, () => {
        if (String(s[key]) === String(value)) return;
        save({[key]: value});
        if (!FOCUS_KEYS.has(key)) { s[key] = value; update(); } // Watch limits wait for the lock's answer.
      });
      b.dataset.v = String(value); g.append(b); return b;
    });
    g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
    function update() {
      let on = null;
      for (const b of buttons) { const p = b.dataset.v === String(s[key]); b.setAttribute('aria-pressed', String(p)); if (p) on = b; }
      if (typeof hint === 'function') t.querySelector('span').textContent = hint();
      requestAnimationFrame(() => {
        if (!on || !on.offsetWidth) { thumb.style.opacity = '0'; return; }
        thumb.style.width = `${on.offsetWidth}px`; thumb.style.transform = `translateX(${on.offsetLeft}px)`; thumb.style.opacity = '1';
        if (!thumb.classList.contains('ready')) requestAnimationFrame(() => thumb.classList.add('ready')); // No slide on first paint.
      });
    }
    update(); controls.push(update);
    r.append(t, g);
    return r;
  }
  // Usage meters grow from 0 only the first time they are shown; later updates move from where they were.
  function meter(id, label, get, extra) {
    const w = el('div', 'meter'), h = el('div', 'h'), name = el('span', null, label), val = el('b'), tr = el('div', 'track'), fill = el('i'), note = el('small');
    h.append(name, val); tr.append(fill); w.append(h, tr, note);
    tr.setAttribute('role', 'progressbar'); tr.setAttribute('aria-label', label); tr.setAttribute('aria-valuemin', '0'); tr.setAttribute('aria-valuemax', '100');
    let shown = false;
    function update() {
      const m = get(); if (!m) return;
      const pct = m.limit ? m.percent : 0;
      val.textContent = m.limit ? `已用 ${m.percent}%` : `已看 ${focus.fmt(m.seconds)}`;
      note.textContent = `${m.limit ? `${focus.fmt(m.seconds)} / ${focus.fmt(m.limit)} · ` : ''}${focus.fmtReset(m.resetAt)}${m.resetAt ? ' 重置' : ''}${extra ? extra() : ''}`;
      fill.classList.toggle('full', !!(m.limit && m.seconds >= m.limit));
      tr.setAttribute('aria-valuenow', String(pct));
      const target = `scaleX(${pct / 100})`;
      meterSeen.set(id, pct);
      if (shown) { fill.style.transform = target; return; }
      shown = true; // Two frames so the starting width is committed before the transition runs.
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.transform = target; }));
    }
    // Start where the bar was last time (0 on first open), then animate to the current value.
    fill.style.transform = `scaleX(${(meterSeen.get(id) || 0) / 100})`;
    update(); controls.push(update);
    return w;
  }
  function group(cls, on, offHint, ...children) {
    const g = el('div', 'group' + (cls ? ' ' + cls : ''));
    g.append(...children);
    if (on !== undefined) {
      const hint = el('div', 'offhint', offHint || ''); g.append(hint);
      const apply = () => { const off = !on(); g.classList.toggle('off', off); g.inert = off; hint.hidden = !off; };
      apply(); controls.push(apply);
    }
    return g;
  }

  /* ---------- pages ---------- */
  function lockBox() {
    const box = el('div', 'lock'); box.setAttribute('aria-live', 'polite');
    const title = el('b', null, '🔒 自律锁已开启');
    box.append(title, el('p', null, lock.hasPassword
      ? `收紧立即生效；放宽要等 ${lock.cooldownHours} 小时冷却期，或输入密码。`
      : `收紧立即生效；放宽要等 ${lock.cooldownHours} 小时冷却期。`));
    const pend = Object.entries(lock.pending || {});
    if (pend.length) {
      const ul = el('ul');
      for (const [k, p] of pend) {
        const li = el('li'), t = el('span', null, describe(k, p.value));
        t.append(el('small', null, `${fmtAt(p.effectiveAt)} 生效`));
        li.append(t, btn('撤销', 'mini', async () => { await chrome.runtime.sendMessage({type: 'lock-cancel', key: k}).catch(() => {}); await refreshLock(); rebuildOrPatch(true); toast('已撤销这项放宽'); }));
        ul.append(li);
      }
      box.append(ul);
      if (lock.hasPassword) {
        const f = el('form'), pw = el('input'); pw.type = 'password'; pw.placeholder = '输入密码立即生效'; pw.autocomplete = 'off'; pw.setAttribute('aria-label', '自律锁密码');
        const err = el('p', 'pwerr'); err.id = 'q-pwerr'; err.setAttribute('role', 'alert'); err.hidden = true;
        pw.setAttribute('aria-describedby', 'q-pwerr');
        f.append(pw, btn('立即生效'));
        f.querySelector('button').type = 'submit';
        pw.addEventListener('input', () => { err.hidden = true; pw.removeAttribute('aria-invalid'); });
        f.addEventListener('submit', async e => {
          e.preventDefault();
          if (!pw.value) { pw.focus(); return; }
          const r = await applyPendingNow(pw.value);
          if (r?.error) {
            // Wrong password: say so right under the field and nudge it, keep the panel as it is.
            err.textContent = r.error; err.hidden = false; pw.setAttribute('aria-invalid', 'true'); pw.select();
            ui.animate(pw, [{transform: 'translateX(0)'}, {transform: 'translateX(-6px)'}, {transform: 'translateX(5px)'}, {transform: 'translateX(-3px)'}, {transform: 'translateX(0)'}], {duration: 320, easing: 'ease-out'});
            return;
          }
          pw.value = ''; await refreshLock(); rebuildOrPatch(true); toast('密码正确，已立即生效');
        });
        box.append(f, err);
      }
    }
    return box;
  }
  function describe(k, v) {
    const L = {focusEnabled: v ? '开启观看额度' : '关闭观看额度', focusStrict: v ? '开启严格模式' : '关闭严格模式', remove: '解除自律锁', cooldownHours: `冷却期改为 ${v} 小时`};
    if (L[k]) return L[k];
    const n = {focusWindowMinutes: ['每 5 小时', '分钟'], focusWeeklyHours: ['每周', '小时'], focusWindowVideos: ['每 5 小时视频', '个'], focusSessionMinutes: ['番茄钟', '分钟'], focusBreakMinutes: ['休息', '分钟']}[k] || [k, ''];
    return `${n[0]}改为 ${Number(v) === 0 && k !== 'focusBreakMinutes' ? '不限' : v + ' ' + n[1]}`;
  }
  async function applyPendingNow(password) {
    const p = lock.pending || {}, changes = {};
    for (const [k, x] of Object.entries(p)) if (FOCUS_KEYS.has(k)) changes[k] = x.value;
    let r = null;
    try {
      if (Object.keys(changes).length) r = await chrome.runtime.sendMessage({type: 'focus-set', changes, password});
      if (!r?.error && p.cooldownHours) r = await chrome.runtime.sendMessage({type: 'lock-cooldown', cooldownHours: p.cooldownHours.value, password});
      if (!r?.error && p.remove) r = await chrome.runtime.sendMessage({type: 'lock-remove', password});
    } catch (e) { r = {error: String(e?.message || e)}; }
    if (r?.error) await refreshLock(); // Fail count / lockout changed; the caller keeps the form on screen.
    return r;
  }

  function brake() {
    const p = el('div', 'page');
    p.append(el('p', 'lead', '像 Claude Code 一样计量：5 小时窗口 + 每周额度，到点自动重置。'));
    if (lock.locked) p.append(lockBox());
    p.append(sw('focusEnabled', '启用观看额度', '额度用完时暂停视频并提示'));
    if (usage?.window) {
      p.append(group('', () => s.focusEnabled, '开启「启用观看额度」后开始计量',
        meter('window', '当前 5 小时窗口', () => usage?.window, () => usage?.videoLimit ? ` · 视频 ${usage.videos}/${usage.videoLimit}` : ''),
        meter('week', '本周', () => usage?.week)));
    }
    const pr = el('div', 'presets');
    for (const preset of PRESETS) {
      const b = btn('', null, () => save({...preset.v, focusEnabled: true}));
      b.append(el('b', null, preset.name), el('span', null, preset.hint));
      const upd = () => b.setAttribute('aria-pressed', String(Object.entries(preset.v).every(([k, v]) => s[k] === v)));
      upd(); controls.push(upd);
      pr.append(b);
    }
    p.append(pr);
    p.append(group('', undefined, '', sw('focusStrict', '严格模式', '不给“再看 5 分钟 / 跳过休息”'),
      seg('focusSessionMinutes', '番茄钟', () => `连续看满后休息 ${s.focusBreakMinutes} 分钟`, [[0, '关'], [25, '25'], [45, '45']])));
    if (!lock.locked) p.append(btn('🔒 开启自律锁（防止随手放宽额度）', 'wide', () => openOptions('lock')));
    return p;
  }
  let chipKind = 'keywords';
  const CHIP = {keywords: ['filterKeywords', '关键词', '标题里出现就屏蔽；/正则/ 也行'], ups: ['filterUps', 'UP 主', '名字（完全一致）或 UID'], tags: ['filterTags', '标签', 'B 站视频标签，完全一致']};
  /** Inline editor for the three block lists: pick a list, type + Enter to add, × to remove. */
  function chips() {
    const w = el('div', 'chips');
    const kinds = el('div', 'seg'), thumb = el('i', 'thumb'); kinds.append(thumb); kinds.setAttribute('role', 'group'); kinds.setAttribute('aria-label', '屏蔽列表');
    const kb = Object.entries(CHIP).map(([k, [, label]]) => { const b = btn(label, null, () => { chipKind = k; rebuildOrPatch(true); }); b.dataset.v = k; kinds.append(b); return b; });
    const head = el('div', 'row'); head.style.borderBottom = '0'; head.style.padding = '2px'; const t = el('div', 't'); t.append(el('b', null, '屏蔽列表'));
    head.append(t, kinds);
    const [key, , hint] = CHIP[chipKind];
    const form = el('form', 'add'), input = el('input'); input.placeholder = `添加${CHIP[chipKind][1]}（${hint}）`; input.setAttribute('aria-label', input.placeholder); input.maxLength = 80;
    form.append(input, btn('添加')); form.querySelector('button').type = 'submit';
    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = input.value.trim(); if (!v) { input.focus(); return; }
      const entry = chipKind === 'ups' && /^\d{3,20}$/.test(v) ? filt.upEntry(v) : v;
      const next = filt.add(s[key], entry, chipKind);
      if (!next) { toast('已经在列表里了'); input.select(); return; }
      s[key] = next; save({[key]: next}); input.value = ''; draw(); input.focus();
    });
    const ul = el('ul'); ul.setAttribute('aria-label', `已屏蔽的${CHIP[chipKind][1]}`);
    const empty = el('div', 'empty');
    function draw() {
      const items = s[key] || [];
      ul.replaceChildren(...items.slice().reverse().map(e => {
        const li = el('li'), label = chipKind === 'ups' ? filt.upLabel(e) : chipKind === 'tags' ? `#${e}` : e;
        const x = btn('×', null, () => { const next = filt.remove(s[key], e); s[key] = next; save({[key]: next}); draw(); });
        x.setAttribute('aria-label', `移除 ${label}`); li.title = e; li.append(el('span', null, label), x); return li;
      }));
      empty.textContent = items.length ? '' : (chipKind === 'tags' ? '还没有屏蔽标签。无限下滑卡片的 ⋮ 菜单里也能按标签屏蔽。' : chipKind === 'ups' ? '还没有屏蔽 UP 主。卡片的 ⋮ 菜单里也能一键屏蔽。' : '还没有屏蔽词。');
      empty.hidden = !!items.length;
    }
    draw(); controls.push(draw);
    // The segmented thumb follows the chosen list.
    requestAnimationFrame(() => { const on = kb.find(b => b.dataset.v === chipKind); for (const b of kb) b.setAttribute('aria-pressed', String(b === on)); if (on?.offsetWidth) { thumb.style.width = `${on.offsetWidth}px`; thumb.style.transform = `translateX(${on.offsetLeft}px)`; thumb.style.opacity = '1'; } });
    w.append(head, form, ul, empty, btn('在完整设置里管理全部规则 ›', 'more', () => openOptions('filter')));
    return w;
  }
  function modeCards() {
    const g = el('div', 'modes'); g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', '首页模式');
    const opt = (inf, title, text) => {
      const b = btn('', null, () => { if (s.homeInfinite === inf && s.homeModeChosen) return; save({homeInfinite: inf, homeModeChosen: true}); });
      b.setAttribute('role', 'radio'); b.append(el('b', null, title), el('span', null, text));
      const upd = () => b.setAttribute('aria-checked', String(s.homeInfinite === inf)); upd(); controls.push(upd);
      return b;
    };
    g.append(opt(false, '🔄 换一批', '一屏一屏挑，可回看上一批，自动去掉重复'), opt(true, '♾ 无限下滑', '一路往下刷，自动按批加载，不用点'));
    return g;
  }
  function homepage() {
    const p = el('div', 'page');
    p.append(el('p', 'lead', isHome() ? '改动立即作用在当前首页。' : '这些设置作用在 B 站首页。'));
    p.append(modeCards());
    p.append(s.homeInfinite
      ? group('', () => s.homeEnabled, '开启「首页净化与操作栏」后生效',
        seg('homeInfiniteSize', '每批视频数', '每次请求 12 个，与 B 站相同', [[12, '12'], [24, '24'], [36, '36']]),
        seg('homeInfiniteThreads', '加载速度', '同时请求数；越快越容易被限流', [[1, '稳'], [2, '标准'], [3, '快']]),
        seg('homePreview', '悬停预览', '鼠标停在封面上时：像 B 站一样静音播放，或逐帧拖动预览', [['video', '视频播放'], ['frames', '逐帧预览']]))
      : group('', () => s.homeEnabled, '开启「首页净化与操作栏」后生效',
        sw('homeHistory', '可回看上一批', '本地保存每一批，手滑了能翻回去'),
        sw('filterDedupe', '去掉重复推荐', '前几批出现过的视频，换一批后不再显示')));
    p.append(el('div', 'sub', '屏蔽'));
    p.append(sw('filterEnabled', '启用屏蔽规则', () => `${(s.filterKeywords?.length || 0) + (s.filterUps?.length || 0) + (s.filterTags?.length || 0)} 条规则 · 每次刷新都会过滤`));
    p.append(group('', () => s.filterEnabled, '开启「启用屏蔽规则」后生效', chips()));
    p.append(el('div', 'sub', '卡片'));
    p.append(group('', () => s.homeEnabled, '开启「首页净化与操作栏」后生效',
      sw('homeHideAds', '广告卡片', '只按明确的广告标记'), sw('cleanHomeLive', '直播卡片'), sw('cleanHomeFloor', '番剧 / 影视 / 课堂楼层'),
      sw('cleanHomeCarouselAds', '轮播图里的广告'), sw('homeHideCarousel', '整个大图轮播'), sw('homeHideBanner', '顶部季节横幅')));
    p.append(el('div', 'sub', '外观'));
    p.append(sw('homeEnabled', '首页净化与操作栏', '关闭即恢复 B 站原生首页'));
    p.append(seg('homeTheme', '首页背景', 'B 站深色模式下可换成纯黑', [['native', '原生'], ['oled', '纯黑']]));
    return p;
  }
  function cleaner() {
    const p = el('div', 'page');
    p.append(el('p', 'lead', '去掉 B 站各处的广告和烦人的东西。只按明确的广告标记和广告位隐藏，不按标题判断。'));
    for (const {group: name, rules} of clean.groups()) {
      if (name === '首页') continue; // Those live in the 首页 tab, next to the cards they hide.
      p.append(el('div', 'sub', name));
      p.append(group('', undefined, '', ...rules.map(r => sw(r.key, r.label, r.hint))));
    }
    p.append(el('div', 'note', '和 AdGuard、uBlock Origin 等去广告扩展一起用也没问题，两边隐藏的是同一类东西。如果某个页面排版乱了，先在这里关掉对应开关，或在去广告扩展里暂时停用 B 站规则，看是哪一边引起的。'));
    return p;
  }
  function throttle() {
    const p = el('div', 'page');
    p.append(el('p', 'lead', '多 CDN / Range 并发加速，清晰度仍由 B 站播放器决定。'));
    p.append(sw('enabled', '视频加速', '出现黑屏时先关掉这里试试'));
    p.append(group('', () => s.enabled, '开启「视频加速」后这些选项才生效',
      seg('mode', 'CDN 路线', null, [['auto', '自动'], ['mainland', '大陆'], ['overseas', '海外']]),
      seg('strategy', '观看策略', null, [['auto', '自动'], ['smooth', '稳播'], ['fast', '起播'], ['economy', '省流']]),
      sw('liveEnabled', '直播加速')));
    p.append(el('div', 'sub', '空降助手'));
    p.append(sw('sbEnabled', '空降助手', () => isPlayer() && document.documentElement.dataset.btrSbSegments ? `本视频有 ${document.documentElement.dataset.btrSbSegments} 个片段 · 立即生效` : '跳过恰饭、片头片尾 · 立即生效'));
    const SBO = [['auto', '自动'], ['manual', '手动'], ['show', '仅标记'], ['off', '关']];
    p.append(btn('空降分类、进度条标记与提交', 'wide', () => { close(); openOptions('sponsor'); }));
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
    const r = el('div', 'root'); shadow.append(r);
    document.documentElement.append(host);
    document.documentElement.toggleAttribute('data-btr-quick', true);
    ui.onTheme(dark => r.classList.toggle('dark', dark)); // Follows B 站's own theme live, not the OS.
    shadow.addEventListener('keydown', onKey, true);
    // Typing in our own fields must not reach B 站's shortcuts (F = fullscreen, space = pause…).
    for (const type of ['keydown', 'keypress', 'keyup']) shadow.addEventListener(type, e => { if (editable(e) && !(e.altKey && e.code === 'KeyT')) e.stopPropagation(); });
  }
  const root = () => shadow.querySelector('.root');

  // B 站's own floating dock (刷新内容 / 客服 / 顶部) sits bottom-right too; start above it.
  function dockTop() {
    for (const sel of ['.palette-button-wrap', '.fixed-sidenav-storage']) {
      const n = document.querySelector(sel); if (!n) continue;
      const r = n.getBoundingClientRect();
      if (r.width && r.height && r.right > innerWidth - 160 && r.bottom > innerHeight * .4) return innerHeight - r.top;
    }
    return 0;
  }
  function fabY() {
    if (posY != null) return posY;
    const dock = dockTop();
    return Math.min(innerHeight - 64, Math.max(120, Math.round(innerHeight * .18), dock ? dock + 16 : 0));
  }
  function placeFab() { if (fab) fab.style.bottom = `${fabY()}px`; }

  function renderFab() {
    ensureHost();
    if (!s.quickFab) { fab?.remove(); fab = null; return; }
    if (!fab) {
      fab = btn('', 'fab'); fab.innerHTML = ICON + '<svg class="ring" viewBox="0 0 58 58" aria-hidden="true"><circle class="track" cx="29" cy="29" r="26"/><circle class="bar" cx="29" cy="29" r="26"/></svg>';
      fab.setAttribute('aria-label', '哔哩节流阀快捷面板'); fab.setAttribute('aria-haspopup', 'dialog'); fab.title = '哔哩节流阀 · 快捷面板（Alt+T）';
      fab.addEventListener('click', e => { if (fab.dataset.dragged) { delete fab.dataset.dragged; return; } toggle(); });
      drag(fab);
      root().append(fab); placeFab();
    }
    fab.setAttribute('aria-expanded', String(open));
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

  // Above the button when there is room; otherwise beside it. Every branch sets all three offsets.
  // Bottom edge of B 站's header bar when it is on screen (fixed or scrolled to the top), else 0.
  function headerBottom() {
    let b = 0;
    for (const h of document.querySelectorAll('.bili-header__bar,#biliMainHeader,.bili-header.fixed-header,.mini-header,#bili-header-container')) {
      const r = h.getBoundingClientRect();
      if (r.height && r.bottom > 0 && r.top < 120 && r.height < 240) b = Math.max(b, r.bottom);
    }
    return b;
  }
  const isFull = () => !!document.fullscreenElement || !!document.querySelector('.bpx-player-container[data-screen="web"],.bpx-player-container[data-screen="full"]') || !!document.body?.classList.contains('player-fullscreen-fix');
  /** Place the panel. Called once before it shows (and on resize / fullscreen changes) — never from
   * scroll or content changes, so an open panel doesn't move under the pointer. */
  function positionPanel(tallest = lastTallest) {
    if (!panel) return;
    // Sit just under B 站's header (z-index 1002) so its avatar / message popovers open above the panel,
    // and never reach under the header: the top is clamped below it (at least 64px from the top).
    // In web-fullscreen / fullscreen video, go topmost instead.
    const full = isFull();
    panel.style.setProperty('--btr-panel-z', full ? '2147483001' : '1001');
    const top = full ? 12 : Math.max(64, Math.ceil(headerBottom()) + 8);
    let bottom = fab ? fabY() + 60 : 24, right = 22;
    if (innerHeight - bottom - top < 360) { bottom = 16; right = fab ? 84 : 22; }
    panel.style.top = ''; panel.style.bottom = `${bottom}px`; panel.style.right = `${right}px`;
    panel.style.maxHeight = `${Math.max(160, Math.min(640, innerHeight - bottom - top))}px`;
    // Measured from the corner, then pinned by its top edge: switching tabs (油门 is shorter) only
    // moves the bottom edge and the height glides, instead of the whole panel jumping up or down.
    // Room is reserved for the tallest tab, so a switch never needs to move the top.
    lastTallest = tallest;
    const placedTop = Math.max(top, Math.round(Math.min(panel.getBoundingClientRect().top, innerHeight - bottom - tallest)));
    panel.style.top = `${placedTop}px`; panel.style.bottom = 'auto';
    panel.style.maxHeight = `${Math.max(160, Math.min(640, innerHeight - bottom - placedTop))}px`;
    panelBottomGap = bottom;
  }
  let panelBottomGap = 24, lastTallest = 0;
  /** Natural height of the tallest tab (capped by the panel's max height), measured off screen. */
  function measureTallest() {
    const cur = tab; let tallest = 0;
    for (const [id] of TABS) {
      tab = id; render(); heightAnim?.cancel(); heightAnim = null;
      tallest = Math.max(tallest, panel.getBoundingClientRect().height);
    }
    tab = cur; render(); heightAnim?.cancel(); heightAnim = null;
    return Math.ceil(tallest);
  }

  /** While open, the panel never moves; it only gets shorter if a header slides in over its top. */
  function keepClearOfHeader() {
    if (!panel || isFull()) return;
    const need = Math.max(64, Math.ceil(headerBottom()) + 8), r = panel.getBoundingClientRect();
    if (r.top < need) { panel.style.top = `${need}px`; panel.style.maxHeight = `${Math.max(160, Math.round(Math.min(r.bottom, innerHeight - panelBottomGap) - need))}px`; }
  }

  // B 站's header popovers (avatar, messages, history…) are translucent with a backdrop blur; the panel
  // showing through one looks messy. While the pointer is in the header and a popover overlaps the
  // panel, fade the panel out; it fades back as soon as the popover closes.
  const HEADER = '.bili-header,.bili-header__bar,#biliMainHeader,.mini-header,#bili-header-container';
  let inHeader = false, veilTimer = 0;
  function overlappingPopover() {
    if (!panel) return false;
    const pr = panel.getBoundingClientRect();
    for (const n of document.querySelectorAll('.v-popover,[class*="popover"]')) {
      if (n.closest('#btr-quick')) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 40 || r.height < 40 || r.right <= pr.left || r.left >= pr.right || r.bottom <= pr.top || r.top >= pr.bottom) continue;
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < .05) continue;
      return true;
    }
    return false;
  }
  function veilCheck() {
    const on = open && !!panel && overlappingPopover();
    panel?.classList.toggle('veiled', on);
    if (!on && !inHeader) { clearInterval(veilTimer); veilTimer = 0; }
  }
  document.addEventListener('pointerover', e => {
    const t = e.target;
    inHeader = !!(t && t.closest && t.closest(HEADER));
    if (inHeader && open && !veilTimer) veilTimer = setInterval(veilCheck, 100);
    if (open && panel && (inHeader || veilTimer)) veilCheck();
  }, true);

  const TABS = [['brake', '刹车'], ['home', '首页'], ['clean', '净化'], ['play', '油门']];
  const sig = () => [tab, s.homeInfinite, chipKind, !!usage?.window, lock.locked, lock.hasPassword, lock.cooldownHours, JSON.stringify(lock.pending || {}), isPlayer()].join('|');

  let heightAnim = null;
  function render() {
    if (!panel) return;
    const body = panel.querySelector('.body'), switched = body.dataset.tab !== tab, keep = switched ? 0 : body.scrollTop;
    // Measure before and after so a tab switch (or a toggle revealing more controls) glides to the new height.
    const shown = body.dataset.tab != null && panel.isConnected;
    const from = shown ? panel.getBoundingClientRect().height : 0;
    heightAnim?.cancel(); heightAnim = null;
    controls = [];
    const page = tab === 'brake' ? brake() : tab === 'home' ? homepage() : tab === 'clean' ? cleaner() : throttle();
    if (!switched) page.style.animation = 'none'; // A structural rebuild after a toggle: no entrance motion.
    body.replaceChildren(page); body.dataset.tab = tab;
    body.setAttribute('aria-labelledby', `q-tab-${tab}`);
    body.scrollTop = keep;
    structure = sig();
    if (shown) {
      const to = panel.getBoundingClientRect().height;
      if (Math.abs(to - from) > 2) {
        heightAnim = ui.animate(panel, [{height: `${from}px`}, {height: `${to}px`}], {duration: MOTION.mid});
        if (heightAnim) heightAnim.onfinish = heightAnim.oncancel = () => { heightAnim = null; };
      }
    }
    const tabs = [...panel.querySelectorAll('.tabs button')];
    tabs.forEach((b, i) => {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      if (on) panel.querySelector('.slider').style.transform = `translateX(${i * 100}%)`;
    });
  }
  /** Sync every live control with `s` without rebuilding the DOM, so switch knobs keep their motion. */
  function patch() { for (const f of controls) { try { f(); } catch (_) {} } }
  function rebuildOrPatch(force) { if (!panel) return; if (force || sig() !== structure) render(); else patch(); }

  function selectTab(id, focusIt) {
    tab = id; chrome.storage.local.set({flowQuickTab: id}).catch(() => {}); render();
    if (focusIt) panel.querySelector(`#q-tab-${id}`)?.focus();
  }

  function build() {
    panel = el('div', 'panel'); panel.tabIndex = -1; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false'); panel.setAttribute('aria-label', '哔哩节流阀快捷面板');
    const head = el('div', 'head'), logo = el('div', 'logo'); logo.innerHTML = ICON;
    const h = el('div'); const title = el('h2', null, '哔哩节流阀'); title.append(el('small', null, `油门帮你踩，刹车也帮你踩 · v${VERSION}`)); h.append(title);
    head.append(logo, h, btn('×', 'x', close));
    head.querySelector('.x').setAttribute('aria-label', '关闭');
    const tabs = el('div', 'tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '快捷面板分类');
    tabs.append(el('span', 'slider'));
    for (const [id, text] of TABS) {
      const b = btn(text, null, () => selectTab(id));
      b.dataset.tab = id; b.id = `q-tab-${id}`; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', 'q-panel'); tabs.append(b);
    }
    // Arrow keys move between tabs (roving tabindex), Home / End jump to the ends.
    tabs.addEventListener('keydown', e => {
      const i = TABS.findIndex(([id]) => id === tab);
      const n = TABS.length, next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (next < 0) return;
      e.preventDefault(); selectTab(TABS[next][0], true);
    });
    const body = el('div', 'body'); body.id = 'q-panel'; body.setAttribute('role', 'tabpanel'); body.tabIndex = -1;
    const foot = el('div', 'foot');
    foot.append(btn('完整设置', null, () => openOptions()),
      btn('使用指南', null, () => openPage('flow-open-welcome')),
      el('span', 'grow'),
      btn(s.quickFab ? '隐藏悬浮按钮' : '显示悬浮按钮', 'fabtoggle', () => {
        const next = !s.quickFab; save({quickFab: next});
        toast(next ? '悬浮按钮已显示' : '已隐藏，可从扩展图标再打开快捷面板'); if (!next) close();
      }));
    panel.append(head, tabs, body, foot);
    root().append(panel);
  }

  async function refreshUsage() {
    try { const r = await chrome.runtime.sendMessage({type: 'focus-check'}); if (r?.window) usage = r; } catch (_) {}
  }
  async function refreshLock() {
    try { const r = await chrome.runtime.sendMessage({type: 'lock-state'}); if (r && !r.error) lock = r; } catch (_) {}
  }

  let opening = false, cancelOpen = false;
  async function openPanel(which) {
    ensureHost();
    if (opening) return;
    opening = true; cancelOpen = false;
    try { await openNow(which); } finally { opening = false; }
  }
  async function openNow(which) {
    // Don't let a sleeping service worker delay the panel: wait briefly, then fill in when data arrives.
    const fresh = Promise.all([refreshUsage(), refreshLock()]);
    const inTime = await Promise.race([fresh.then(() => true), new Promise(r => setTimeout(r, 180, false))]);
    if (cancelOpen) { cancelOpen = false; return; } // Alt+T pressed again while it was opening.
    if (!inTime) fresh.then(() => rebuildOrPatch());
    if (which === 'focus') which = 'brake';
    if (which && TABS.some(([id]) => id === which)) tab = which;
    if (!panel) build();
    const wasOpen = open;
    open = true;
    if (!wasOpen) { panel.style.visibility = 'hidden'; positionPanel(); }
    render();
    if (!wasOpen) { panel.style.top = ''; panel.style.bottom = `${panelBottomGap}px`; panel.style.maxHeight = ''; positionPanel(measureTallest()); } // Final placement, before the first paint.
    panel.style.visibility = '';
    // Grow out of the corner it is anchored to: no slide, so it never looks like it jumps into place.
    if (!wasOpen) { panel.style.transformOrigin = 'bottom right'; ui.animate(panel, [{opacity: 0, transform: 'scale(.97)'}, {opacity: 1, transform: 'none'}], {duration: MOTION.mid}); }
    panel.focus({preventScroll: true}); // Focus the dialog itself; Tab then walks into the controls.
    renderFab();
    dismissTip();
  }
  function close() {
    if (!panel || !open) return;
    open = false;
    const p = panel; panel = null; controls = []; structure = '';
    ui.fadeOut(p, MOTION.mid, [{opacity: 1, transform: 'none'}, {opacity: 0, transform: 'translateY(8px) scale(.97)'}]);
    renderFab();
    fab?.focus({preventScroll: true});
  }
  function toggle(which) { if (open && (!which || which === tab)) close(); else openPanel(which || tab); }

  let toastTimer, toastEl = null;
  function toast(text, action) {
    ensureHost(); clearTimeout(toastTimer);
    if (toastEl) { const old = toastEl; toastEl = null; ui.fadeOut(old, MOTION.fast); }
    const t = el('div', 'toast'); t.setAttribute('role', 'status'); t.append(el('span', null, text));
    if (action) t.append(btn(action.label, null, () => { action.fn(); ui.fadeOut(t, MOTION.fast); }));
    t.style.bottom = `${(fab ? fabY() : 24) + 60}px`; root().append(t); toastEl = t;
    ui.animate(t, [{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'none'}], {duration: MOTION.mid});
    toastTimer = setTimeout(() => { if (toastEl === t) toastEl = null; ui.fadeOut(t, MOTION.mid, [{opacity: 1}, {opacity: 0, transform: 'translateY(4px)'}]); }, action ? 5000 : 2600);
  }

  // One-time hint next to the button for new users.
  let tip = null;
  function showTip() {
    if (!fab || tip || open) return;
    tip = el('div', 'tip'); tip.setAttribute('role', 'status');
    tip.append(el('b', null, '常用开关都在这里'), el('p', null, '观看额度、无限下滑、首页净化、播放加速——点一下就能开关。按钮可以上下拖动。'));
    tip.append(btn('知道了', null, dismissTip));
    tip.style.bottom = `${fabY() + 2}px`;
    root().append(tip); fab.classList.add('pulse');
    ui.animate(tip, [{opacity: 0, transform: 'translateX(8px)'}, {opacity: 1, transform: 'none'}], {duration: MOTION.slow});
  }
  function dismissTip() {
    if (!tip) return;
    const t = tip; tip = null; fab?.classList.remove('pulse');
    ui.fadeOut(t, MOTION.mid, [{opacity: 1}, {opacity: 0, transform: 'translateX(8px)'}]);
    chrome.storage.local.set({flowQuickTipSeen: true}).catch(() => {});
  }

  // Typing in B 站's search box, comments or danmaku must never be hijacked by the shortcut.
  function editable(e) {
    const t = e.composedPath()[0];
    return !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
  }
  // Alt+T toggles. Listened for on window (earliest), document and inside our shadow root, so it works
  // whatever has focus (the panel itself, the player) and even if a page handler stops the event later.
  const seenKeys = new WeakSet();
  function onKey(e) {
    if (seenKeys.has(e)) return; seenKeys.add(e);
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 't' || e.key === 'T' || e.code === 'KeyT')) {
      const inPanel = host && e.composedPath().includes(host);
      if (editable(e) && !inPanel) return;
      e.preventDefault(); e.stopPropagation();
      if (e.repeat) return;
      if (opening) cancelOpen = true; else toggle();
    } else if (e.key === 'Escape' && open) { e.stopPropagation(); close(); }
    else if (e.key === 'Tab' && open && panel && e.composedPath().includes(host)) {
      // Keep keyboard focus inside the panel while it is open.
      const items = [...panel.querySelectorAll('button,input,[tabindex="0"]')].filter(n => !n.disabled && !n.closest('[inert]') && n.offsetParent !== null && n.tabIndex >= 0);
      if (!items.length) return;
      const i = items.indexOf(shadow.activeElement);
      const to = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === -1 || i === items.length - 1 ? 0 : i + 1);
      e.preventDefault(); items[to].focus();
    }
  }
  addEventListener('keydown', onKey, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', e => { if (open && host && !e.composedPath().includes(host)) close(); }, true);
  addEventListener('resize', () => { placeFab(); if (open) positionPanel(); }, {passive: true});
  // The native dock appears lazily (e.g. after the first scroll); follow it until the user drags the button.
  let dockFrame = 0;
  addEventListener('scroll', () => {
    if (dockFrame || ((!fab || posY != null) && !open)) return;
    dockFrame = requestAnimationFrame(() => { dockFrame = 0; if (fab && posY == null && !open) placeFab(); if (open) keepClearOfHeader(); });
  }, {passive: true});
  document.addEventListener('fullscreenchange', () => { if (open) positionPanel(); });

  chrome.runtime.onMessage.addListener((m, sender) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (m?.type === 'flow-quick-open') openPanel(m.tab || tab);
    return false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.focusLock) { refreshLock().then(() => rebuildOrPatch()); return; }
    if (area !== 'sync' || !Object.keys(changes).some(k => k in DEFAULTS)) return;
    for (const k of Object.keys(DEFAULTS)) if (changes[k]) s[k] = changes[k].newValue;
    s = norm(s);
    if (panel) {
      const f = panel.querySelector('.foot .fabtoggle'); if (f) f.textContent = s.quickFab ? '隐藏悬浮按钮' : '显示悬浮按钮';
      rebuildOrPatch(); // Patch immediately, so switches never snap back and forth.
      if (Object.keys(changes).some(k => FOCUS_KEYS.has(k))) refreshUsage().then(() => rebuildOrPatch());
    }
    renderFab();
  });

  async function start() {
    try {
      const [sync, local] = await Promise.all([chrome.storage.sync.get(DEFAULTS), chrome.storage.local.get(['flowQuickY', 'flowQuickTab', 'flowQuickTipSeen'])]);
      s = norm(sync);
      if (Number.isFinite(local.flowQuickY)) posY = local.flowQuickY;
      tab = isHome() ? 'home' : isPlayer() ? 'play' : ['brake', 'home', 'clean', 'play'].includes(local.flowQuickTab) ? local.flowQuickTab : 'brake';
      await refreshUsage();
      renderFab();
      if (!local.flowQuickTipSeen) setTimeout(showTip, 1200);
    } catch (_) {}
    setInterval(() => { if (!document.hidden && s.focusEnabled) refreshUsage().then(() => { renderFab(); if (open && tab === 'brake') rebuildOrPatch(); }); }, 30000);
  }

  globalThis.__BTR_QUICK__ = {open: which => openPanel(which), close, toggle};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
})();
