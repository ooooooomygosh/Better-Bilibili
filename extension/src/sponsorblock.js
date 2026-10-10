/* BiliThrottle 空降助手 — skips sponsor / self-promo / intro … segments on B 站 video pages,
 * draws them on the progress bar, offers undo, and lets you submit new segments.
 *
 * Behaviour, categories, server API and privacy model are taken from BilibiliSponsorBlock
 * (https://github.com/hanydd/BilibiliSponsorBlock), Copyright (C) hanydd and BilibiliSponsorBlock
 * contributors, a port of SponsorBlock (https://github.com/ajayyy/SponsorBlock), Copyright (C)
 * Ajay Ramachandran and contributors. Ported from their src/content/{skipScheduler,skipNotification,
 * previewBarManager,segmentSubmission}.ts and rewritten as a plain isolated-world script styled
 * with BiliThrottle's UI kit.
 *
 * Privacy: lookups send only a 4-char sha256 prefix of the BV id (k-anonymity), never cookies.
 * The anonymous submitter id is created only when you first submit, kept in chrome.storage.local
 * (not synced), and sent only with submissions.
 *
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE and THIRD_PARTY_NOTICES.md.
 */
(function () {
  'use strict';
  const sb = globalThis.__BTR_SB_CORE__, ui = globalThis.__BTR_UI__;
  if (!sb || !ui || window.top !== window || globalThis.__BTR_SB__) return;
  globalThis.__BTR_SB__ = true;
  const VERSION = chrome.runtime.getManifest().version;
  const isVideoPage = () => /^\/(?:video|list)\//.test(location.pathname);

  let s = sb.settings({}), href = '', bvid = null, cid = null, raw = null, segs = [], done = new Set();
  let video = null, timer = 0, mutedBy = null, poiShown = false, toastSeg = null, draft = null, loadId = 0;
  let host = null, shadow = null, rootEl = null, toastEl = null, bar = null;

  const CSS = `
:host{all:initial}
${ui.scoped('.root')}
*{box-sizing:border-box;margin:0}
.root{position:absolute;right:16px;bottom:72px;z-index:80;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;
  font:13px/1.45 var(--btr-font);color:var(--btr-text1)}
.toast{pointer-events:auto;display:flex;align-items:center;gap:10px;max-width:360px;padding:9px 10px 9px 14px;border-radius:12px;background:var(--btr-bg-float);
  box-shadow:var(--btr-shadow);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--btr-line)}
.dot{width:10px;height:10px;border-radius:3px;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,.15) inset}
.msg{flex:1;min-width:0}.msg b{font-weight:600}.msg small{display:block;color:var(--btr-text3);font-size:12px}
button{font:inherit;font-size:12px;border:0;border-radius:999px;padding:5px 12px;cursor:pointer;background:var(--btr-soft);color:var(--btr-text1);
  transition:background var(--btr-fast) var(--btr-ease),transform var(--btr-fast) var(--btr-ease)}
button:hover{background:var(--btr-soft2)}button:active{transform:scale(.96)}
button.primary{background:var(--btr-brand);color:white}button.primary:hover{background:var(--btr-brand-hover)}
button:focus-visible{outline:2px solid var(--btr-brand-ring);outline-offset:2px}
.x{background:transparent;color:var(--btr-text3);padding:4px 6px}
.timer{position:absolute;left:0;bottom:0;height:2px;background:var(--btr-brand);border-radius:2px;transform-origin:left}
.toast{position:relative;overflow:hidden}
.card{pointer-events:auto;width:300px;padding:12px 14px;border-radius:14px;background:var(--btr-bg-float);box-shadow:var(--btr-shadow);border:1px solid var(--btr-line);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.card h4{font-size:13px;margin-bottom:6px}.card p{color:var(--btr-text2);font-size:12px}
.cats{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.cats button{display:flex;align-items:center;gap:6px}.cats button[aria-pressed=true]{background:var(--btr-brand-soft);color:var(--btr-brand);box-shadow:0 0 0 1px var(--btr-brand-ring) inset}
.acts{display:flex;justify-content:flex-end;gap:6px}
.err{color:var(--btr-danger)!important}`;

  /* ---------- UI ---------- */
  function playerBox() { return video?.closest('.bpx-player-video-area, .bpx-player-primary-area, .bpx-player-container') || video?.parentElement || null; }
  function ensureHost() {
    const box = playerBox(); if (!box) return false;
    if (host?.isConnected && host.parentElement === box) return true;
    host?.remove();
    host = document.createElement('div'); host.id = 'btr-sb'; host.dataset.btrFlowOwned = '';
    shadow = host.attachShadow({mode: 'open'});
    const st = document.createElement('style'); st.textContent = CSS; shadow.append(st);
    rootEl = document.createElement('div'); rootEl.className = 'root'; shadow.append(rootEl);
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    box.append(host);
    ui.onTheme(dark => rootEl.classList.toggle('dark', dark));
    return true;
  }
  const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  function hideToast() { const t = toastEl; toastEl = null; toastSeg = null; if (t) ui.fadeOut(t, ui.MOTION.fast); }
  function toast(seg, title, sub, actions, seconds) {
    if (!ensureHost()) return;
    hideToast();
    const t = h('div', 'toast'); t.setAttribute('role', 'status'); t.dataset.kind = actions[0]?.kind || '';
    const dot = h('i', 'dot'); dot.style.background = sb.BY_NAME[seg.category]?.color || 'var(--btr-brand)';
    const m = h('div', 'msg'); m.append(h('b', null, title)); if (sub) m.append(h('small', null, sub));
    t.append(dot, m);
    for (const a of actions) { const b = h('button', a.primary ? 'primary' : '', a.label); b.dataset.act = a.kind; b.onclick = e => { e.stopPropagation(); a.fn(); }; t.append(b); }
    const x = h('button', 'x', '✕'); x.setAttribute('aria-label', '关闭'); x.onclick = e => { e.stopPropagation(); if (toastSeg) done.add(toastSeg.UUID); hideToast(); }; t.append(x);
    if (seconds) {
      const bar = h('i', 'timer'); bar.style.width = '100%'; t.append(bar);
      ui.animate(bar, [{transform: 'scaleX(1)'}, {transform: 'scaleX(0)'}], {duration: seconds * 1000, easing: 'linear', fill: 'forwards'});
      const tt = setTimeout(() => { if (toastEl === t) hideToast(); }, seconds * 1000);
      t.addEventListener('pointerenter', () => clearTimeout(tt), {once: true});
    }
    rootEl.append(t); toastEl = t; toastSeg = seg;
    ui.animate(t, [{opacity: 0, transform: 'translateY(6px) scale(.98)'}, {opacity: 1, transform: 'none'}], {duration: ui.MOTION.mid});
  }
  const label = seg => sb.BY_NAME[seg.category]?.label || seg.category;
  const range = seg => `${sb.fmt(seg.start)} – ${sb.fmt(seg.end)}`;

  /* ---------- progress-bar markers ---------- */
  function drawBar() {
    bar?.remove(); bar = null;
    if (!s.sbEnabled || !s.sbShowBar || !segs.length || !video) return;
    const d = video.duration; if (!Number.isFinite(d) || d <= 0) return;
    const track = document.querySelector('.bpx-player-progress-schedule') || document.querySelector('.bpx-player-progress');
    if (!track) return;
    if (getComputedStyle(track).position === 'static') track.style.position = 'relative';
    bar = document.createElement('div'); bar.id = 'btr-sb-bar'; bar.dataset.btrFlowOwned = '';
    bar.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3';
    for (const g of segs) {
      const m = document.createElement('div'), poi = g.actionType === 'poi';
      const l = Math.min(100, g.start / d * 100), w = poi ? 0 : Math.max(.25, (Math.min(g.end, d) - g.start) / d * 100);
      m.className = 'btr-sb-seg'; m.dataset.category = g.category; m.title = `${label(g)} ${range(g)}`;
      m.style.cssText = `position:absolute;top:0;bottom:0;left:${l}%;${poi ? 'width:4px;margin-left:-2px;border-radius:2px' : `width:${w}%`};background:${sb.BY_NAME[g.category].color};opacity:${g.option === 'show' ? .45 : .8}`;
      bar.append(m);
    }
    track.append(bar);
  }

  /* ---------- skipping ---------- */
  function skip(seg) {
    const from = video.currentTime, to = Math.min(sb.skipTarget(segs, seg, done), video.duration || Infinity);
    for (const g of segs) if (g.start <= to && g.end <= to + .05 && g.end > from && g.actionType === 'skip') done.add(g.UUID);
    done.add(seg.UUID);
    video.currentTime = to;
    toast(seg, `已跳过「${label(seg)}」`, range(seg), [{label: '撤销', kind: 'undo', fn: () => { video.currentTime = seg.start; hideToast(); }}], s.sbToastSeconds);
  }
  function tick() {
    if (!video || !s.sbEnabled || !segs.length) return;
    const t = video.currentTime;
    const r = sb.decide(segs, t, done);
    const shouldMute = r.type === 'mute';
    if (r.type === 'skip') skip(r.seg);
    else if (r.type === 'prompt' && toastSeg !== r.seg) toast(r.seg, `「${label(r.seg)}」`, `${range(r.seg)} · 按 Enter 跳过`, [{label: '跳过', kind: 'skip', primary: true, fn: () => skip(r.seg)}], 0);
    else if (r.type !== 'prompt' && toastEl?.dataset.kind === 'skip') hideToast();
    if (shouldMute && !mutedBy) { mutedBy = r.seg; if (!video.muted) video.muted = true; else mutedBy = 'already'; }
    else if (!shouldMute && mutedBy) { if (mutedBy !== 'already') video.muted = false; mutedBy = null; }
    const poi = segs.find(g => g.actionType === 'poi');
    if (poi && !poiShown && t < poi.start - 1 && !toastEl) {
      poiShown = true;
      toast(poi, `精彩时刻在 ${sb.fmt(poi.start)}`, '空降助手', [{label: '跳过去', kind: 'poi', primary: true, fn: () => { video.currentTime = poi.start; hideToast(); }}], 8);
    }
  }

  /* ---------- data ---------- */
  async function getCid(id) {
    const p = sb.parsePage(location.href);
    try {
      const r = await fetch(`https://api.bilibili.com/x/player/pagelist?bvid=${id}`, {credentials: 'omit'});
      const j = await r.json(); const page = j?.data?.[p - 1] || j?.data?.[0];
      return page?.cid ?? null;
    } catch (_) { return null; }
  }
  async function load() {
    const id = sb.parseBvid(location.href), my = ++loadId;
    bvid = id; cid = null; raw = null; segs = []; done = new Set(); poiShown = false; hideToast(); drawBar(); draft = null;
    if (!id || !s.sbEnabled) return;
    const [c, data] = await Promise.all([getCid(id), sb.hashPrefix(id).then(px => fetch(`${sb.SERVER}/api/skipSegments/${px}`, {credentials: 'omit'}))
      .then(r => r.status === 200 ? r.json() : []).catch(() => [])]);
    if (my !== loadId) return;
    cid = c; raw = data; refilter();
  }
  function refilter() {
    segs = s.sbEnabled ? sb.pickSegments(raw, bvid, cid, s) : [];
    document.documentElement.dataset.btrSbSegments = String(segs.length);
    drawBar(); tick();
  }

  /* ---------- submission (key ";" marks start, then end) ---------- */
  function openDraft() {
    if (!ensureHost()) return;
    rootEl.querySelector('.card')?.remove();
    const c = h('div', 'card'); c.setAttribute('role', 'dialog'); c.setAttribute('aria-label', '提交空降片段');
    const title = h('h4', null, '提交空降片段'), info = h('p'), cats = h('div', 'cats'), acts = h('div', 'acts');
    const paint = () => { info.textContent = draft.end == null ? `开始 ${sb.fmt(draft.start)}，播放到结束处再按 ; 键（精彩时刻只需开始时间）` : `${sb.fmt(draft.start)} – ${sb.fmt(draft.end)}`; info.className = '';
      for (const b of cats.children) b.setAttribute('aria-pressed', String(b.dataset.c === draft.category)); };
    for (const k of sb.CATEGORIES) { const b = h('button'); b.dataset.c = k.name; const d = h('i', 'dot'); d.style.background = k.color; b.append(d, k.label); b.onclick = () => { draft.category = k.name; paint(); }; cats.append(b); }
    const cancel = h('button', '', '取消'), send = h('button', 'primary', '提交');
    cancel.onclick = () => { draft = null; ui.fadeOut(c, ui.MOTION.fast); };
    send.onclick = async () => {
      if (!draft.category) { info.textContent = '先选一个分类'; info.className = 'err'; return; }
      if (draft.category !== 'poi_highlight' && (draft.end == null || draft.end - draft.start < .5)) { info.textContent = '片段太短，或还没标记结束'; info.className = 'err'; return; }
      send.disabled = true; info.textContent = '正在提交…';
      try {
        let {sbUserID} = await chrome.storage.local.get('sbUserID');
        if (!sbUserID) { sbUserID = sb.newUserId(); await chrome.storage.local.set({sbUserID}); }
        const body = sb.submission({bvid, cid, userID: sbUserID, duration: video.duration, start: draft.start, end: draft.end, category: draft.category, version: VERSION});
        const r = await fetch(`${sb.SERVER}/api/skipSegments`, {method: 'POST', credentials: 'omit', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
        if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 80)}`);
        info.textContent = '已提交，谢谢！'; draft = null; setTimeout(() => ui.fadeOut(c, ui.MOTION.mid), 1200);
        raw = null; load();
      } catch (e) { info.textContent = `提交失败：${e.message}`; info.className = 'err'; send.disabled = false; }
    };
    acts.append(cancel, send); c.append(title, info, cats, acts); rootEl.append(c); paint();
    ui.animate(c, [{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'none'}], {duration: ui.MOTION.mid});
    draft.repaint = paint;
  }
  function onKey(e) {
    if (!video || !s.sbEnabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const tg = e.target; if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
    if (e.key === 'Enter' && toastEl?.dataset.kind === 'skip' && toastSeg) { e.preventDefault(); e.stopPropagation(); skip(toastSeg); }
    else if (e.key === ';' && bvid) {
      e.preventDefault();
      if (!draft) { draft = {start: video.currentTime, end: null, category: null}; openDraft(); }
      else if (draft.end == null) { draft.end = Math.max(draft.start, video.currentTime); draft.repaint?.(); }
    }
  }

  /* ---------- wiring ---------- */
  function attach(v) {
    if (v === video) return;
    if (video) { video.removeEventListener('seeked', tick); video.removeEventListener('durationchange', drawBar); }
    video = v; mutedBy = null;
    if (!v) return;
    v.addEventListener('seeked', tick); v.addEventListener('durationchange', drawBar); v.addEventListener('loadedmetadata', drawBar);
    drawBar();
  }
  function poll() {
    if (!isVideoPage()) { if (bvid) { bvid = null; segs = []; drawBar(); hideToast(); } return; }
    const v = document.querySelector('.bpx-player-video-wrap video, .bpx-player-video-area video, video');
    if (v !== video) attach(v);
    if (location.href !== href) { const prev = sb.parseBvid(href), pp = sb.parsePage(href); href = location.href; if (sb.parseBvid(href) !== prev || sb.parsePage(href) !== pp) load(); }
    if (bar && !bar.isConnected) drawBar(); else if (!bar && segs.length && s.sbShowBar) drawBar();
    if (video && !video.paused) tick();
  }
  chrome.storage.sync.get(sb.defaults).then(v => { s = sb.settings(v); poll(); if (!timer) timer = setInterval(poll, 120); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'sync' || !Object.keys(ch).some(k => k in sb.defaults)) return;
    const wasOn = s.sbEnabled;
    chrome.storage.sync.get(sb.defaults).then(v => { s = sb.settings(v); if (s.sbEnabled && !wasOn) load(); else refilter(); });
  });
  document.addEventListener('keydown', onKey, true);
})();
