/* BiliThrottle infinite feed — isolated world. Opt-in (home settings → 无限下滑).
 * Fetches more homepage recommendations from B 站's own feed API as the reader nears the bottom,
 * several requests at once, and appends them below the native grid as numbered batches.
 * The native grid, its cards and handlers are never touched; ads, live rooms and duplicates are dropped.
 */
(function () {
  'use strict';
  const feed = globalThis.__BTR_FEED_CORE__;
  if (!feed || globalThis.__BTR_HOME_INFINITE__) return;

  const GAP_MS = 700, TIMEOUT_MS = 10000, KEY_TTL = 12 * 3600000, MAX_FAILS = 3, PAGE = 12, STAGGER_MS = 250;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const CSS = `
:host{display:block;box-sizing:border-box;margin-top:8px;font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--btr-text,#18191c)}
*{box-sizing:border-box}[hidden]{display:none!important}
.batch{content-visibility:auto;contain-intrinsic-size:auto 900px;margin-top:8px}
.batch.enter{animation:btr-rise .42s cubic-bezier(.2,.75,.25,1) both}
.divider{display:flex;align-items:center;gap:12px;margin:18px 0 16px;color:var(--btr-muted,#9499a0);font-size:12px}
.divider::before,.divider::after{content:"";flex:1;height:1px;background:var(--btr-line,rgba(128,128,128,.22))}
.chip{display:inline-flex;align-items:center;gap:6px;padding:3px 12px;border-radius:999px;background:var(--btr-chip,rgba(251,114,153,.1));color:#fb7299;font-weight:600;font-variant-numeric:tabular-nums}
.chip small{font-weight:400;color:var(--btr-muted,#9499a0)}
.grid{display:grid;grid-template-columns:repeat(var(--btr-columns,5),minmax(0,1fr));column-gap:var(--btr-gap,20px);row-gap:24px}
.card{color:inherit;text-decoration:none;display:block;min-width:0}
.cover{position:relative;aspect-ratio:16/9;border-radius:6px;overflow:hidden;background:var(--btr-placeholder,#f1f2f3)}
.cover img{width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .3s ease,transform .3s cubic-bezier(.2,.75,.25,1)}
.cover img.loaded{opacity:1}
.card:hover .cover img{transform:scale(1.04)}
.stats{position:absolute;left:0;right:0;bottom:0;display:flex;gap:10px;padding:14px 8px 5px;font-size:12px;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.6))}
.stats .dur{margin-left:auto}
.title{font-size:15px;line-height:22px;margin-top:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:44px;transition:color .16s ease}
.card:hover .title{color:var(--brand_blue,#00aeec)}
.meta{color:var(--btr-muted,#9499a0);font-size:13px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta .followed{color:#fb7299;margin-right:4px}
.foot{display:flex;justify-content:center;align-items:center;gap:10px;min-height:72px;color:var(--btr-muted,#9499a0);font-size:13px}
.foot .why{font:11px ui-monospace,Menlo,monospace;opacity:.75;padding:2px 6px;border-radius:4px;background:var(--btr-chip,rgba(251,114,153,.1))}
.foot{flex-wrap:wrap}
.foot button{font:inherit;padding:6px 16px;border-radius:999px;border:1px solid var(--btr-line,rgba(128,128,128,.3));background:transparent;color:inherit;cursor:pointer;transition:border-color .16s ease,color .16s ease}
.foot button:hover{border-color:#fb7299;color:#fb7299}
.dots{display:inline-flex;gap:5px}.dots i{width:6px;height:6px;border-radius:50%;background:#fb7299;animation:btr-dot 1s ease-in-out infinite}
.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
.side{position:fixed;right:18px;top:50%;z-index:1000;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:2px;min-width:64px;padding:10px 10px 9px;border-radius:16px;
  background:var(--btr-side,rgba(255,255,255,.92));box-shadow:0 6px 24px rgba(0,0,0,.14);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);cursor:pointer;user-select:none;
  transition:opacity .25s ease,transform .25s cubic-bezier(.2,.75,.25,1)}
.side.tight{right:4px;min-width:44px;padding:7px 5px;opacity:.88}.side.tight b{font-size:17px}.side.tight .total{display:none}
.side:not(.tight){right:auto}
.side.off{opacity:0;transform:translate(12px,-50%);pointer-events:none}
.side small{font-size:11px;color:var(--btr-muted,#9499a0)}
.side b{font-size:22px;line-height:1.15;color:#fb7299;font-variant-numeric:tabular-nums}
.side b.bump{animation:btr-bump .3s cubic-bezier(.2,.75,.25,1)}
.side .total{font-size:11px;color:var(--btr-muted,#9499a0);font-variant-numeric:tabular-nums}
.side .live{width:6px;height:6px;border-radius:50%;background:#fb7299;margin-top:3px;opacity:0;transition:opacity .2s ease}
.side.loading .live{opacity:1;animation:btr-dot 1s ease-in-out infinite}
@keyframes btr-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes btr-dot{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
@keyframes btr-bump{from{transform:translateY(5px);opacity:.3}to{transform:none;opacity:1}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.cover img{opacity:1}}
@media(max-width:900px){.side{right:8px;min-width:54px;padding:8px 7px}.side b{font-size:18px}}
`;

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function create(host) {
    let box = null, shadow = null, list = null, foot = null, side = null, sentinel = null;
    let current = null, sections = [];
    let batches = 0, idx = 1, loading = false, paused = false, fails = 0, timer = 0, keys = null, buffer = [];
    const seen = new Set();

    async function wbiKeys(force) {
      if (keys && !force) return keys;
      try {
        const {flowWbiKeys: c} = await chrome.storage.local.get('flowWbiKeys');
        if (!force && c && Date.now() - c.at < KEY_TTL && /^[0-9a-f]{32}$/.test(c.img) && /^[0-9a-f]{32}$/.test(c.sub)) return (keys = {img: c.img, sub: c.sub});
      } catch (_) {}
      const res = await fetch(feed.NAV, {credentials: 'include'});
      const k = feed.keysFromNav(await res.json());
      if (!k) throw new Error('nav');
      keys = k;
      chrome.storage.local.set({flowWbiKeys: {...k, at: Date.now()}}).catch(() => {});
      return k;
    }

    async function getJSON(url) {
      const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const r = await fetch(url, {credentials: 'include', signal: ctrl.signal});
        if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.kind = r.status === 412 || r.status === 429 ? 'risk' : 'error'; e.code = r.status; throw e; }
        return await r.json();
      } finally { clearTimeout(t); }
    }

    // One request asks for exactly what B 站's own homepage asks for (12 cards); bigger batches are
    // several such requests merged, never a larger page size the server would reject.
    async function request(n) {
      const params = feed.rcmdParams(n, PAGE, innerWidth, innerHeight);
      let json = await getJSON(`${feed.RCMD}?${feed.signWbi(params, await wbiKeys(false))}`);
      if (feed.classify(json) === 'error') {
        json = await getJSON(`${feed.RCMD}?${feed.signWbi(params, await wbiKeys(true))}`);
        if (feed.classify(json) === 'error') json = await getJSON(`${feed.RCMD_LEGACY}?fresh_type=3&version=1&ps=${PAGE}&fresh_idx=${n}&fresh_idx_1h=${n}`);
      }
      const kind = feed.classify(json);
      if (kind !== 'ok') { const e = new Error(String(json?.message || kind)); e.kind = kind; e.code = json?.code; throw e; }
      return json.data?.item || json.data?.items || [];
    }

    function nativeSeen() {
      for (const a of host.nativeLinks()) { const m = String(a).match(/BV[0-9A-Za-z]{10}/); if (m) seen.add(m[0]); }
    }

    // Run `count` requests with at most `lanes` in flight, starts staggered like a person scrolling.
    async function pool(count, lanes) {
      const ids = Array.from({length: count}, () => idx++), out = new Array(count);
      let next = 0;
      const worker = async (w) => {
        await new Promise(r => setTimeout(r, w * STAGGER_MS));
        while (next < count) {
          const i = next++;
          try { out[i] = {ok: true, items: await request(ids[i])}; } catch (e) { out[i] = {ok: false, error: e}; }
        }
      };
      await Promise.all(Array.from({length: Math.min(lanes, count)}, (_, w) => worker(w)));
      return out;
    }

    const isNear = () => !!sentinel?.isConnected && sentinel.getBoundingClientRect().top < innerHeight * 2.5;

    async function round() {
      clearTimeout(timer);
      if (loading || paused || !box?.isConnected || !host.enabled() || !isNear()) return;
      loading = true; status('loading'); side?.classList.add('loading');
      const s = host.settings(), size = s.homeInfiniteSize, lanes = s.homeInfiniteThreads;
      const count = Math.max(lanes, Math.ceil(Math.max(0, size - buffer.length) / PAGE));
      nativeSeen();
      const results = await pool(count, lanes);
      loading = false; side?.classList.remove('loading');
      if (!box?.isConnected || !host.enabled()) return;
      let fresh = 0, risk = null, error = null;
      for (const r of results) {
        if (r.ok) { const cards = feed.cards(r.items, seen); fresh += cards.length; buffer.push(...cards); }
        else if (r.error?.kind === 'risk') risk = r.error;
        else error = r.error;
      }
      while (buffer.length >= size) append(buffer.splice(0, size));
      if (risk) { paused = true; status('risk', risk); return; }
      if (!fresh) {
        if (++fails >= MAX_FAILS) { paused = true; status('error', error); return; }
      } else fails = 0;
      status('idle');
      timer = setTimeout(round, GAP_MS);
    }

    function status(kind, err) {
      if (!foot) return;
      foot.replaceChildren();
      if (kind === 'loading') {
        const dots = el('span', 'dots'); dots.append(el('i'), el('i'), el('i'));
        foot.append(dots, el('span', null, `正在同时加载 ${host.settings().homeInfiniteThreads} 批推荐…`));
      } else if (kind === 'risk' || kind === 'error') {
        foot.append(el('span', null, kind === 'risk' ? 'B 站暂时限制了推荐请求，已暂停自动加载，过一会儿再试。' : '暂时没取到新推荐，已暂停自动加载。'));
        // Show B 站's own answer so a report says exactly what went wrong.
        if (err) foot.append(el('code', 'why', `B 站返回 ${err.code ?? ''} ${String(err.message || '').slice(0, 60)}`.trim()));
        const retry = el('button', null, '重试'); retry.type = 'button';
        retry.onclick = () => { paused = false; fails = 0; round(); };
        foot.append(retry);
      } else foot.append(el('span', null, batches ? `已加载 ${batches + 1} 批 · 继续下滑自动加载` : '继续下滑，自动加载更多推荐'));
    }

    function card(c) {
      const a = el('a', 'card'); a.href = c.url; a.target = '_blank'; a.rel = 'noopener';
      const cover = el('div', 'cover');
      if (c.cover) {
        const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
        img.onload = () => img.classList.add('loaded'); img.src = c.cover; cover.append(img);
      }
      const stats = el('div', 'stats');
      stats.append(el('span', null, `▶ ${c.views}`), el('span', null, `弹 ${c.danmaku}`), el('span', 'dur', c.duration));
      cover.append(stats);
      const meta = el('div', 'meta');
      if (c.followed) meta.append(el('span', 'followed', '已关注'));
      meta.append(document.createTextNode([c.author, c.date].filter(Boolean).join(' · ')));
      a.append(cover, el('div', 'title', c.title), meta);
      a.title = c.title;
      return a;
    }

    function append(cards) {
      const n = ++batches + 1; // The native grid is batch 1.
      const sec = el('section', 'batch'); sec.dataset.batch = String(n);
      const div = el('div', 'divider'), chip = el('span', 'chip', `第 ${n} 批`);
      const at = new Date();
      chip.append(el('small', null, `${cards.length} 个视频 · ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`));
      div.append(chip);
      const grid = el('div', 'grid'); for (const c of cards) grid.append(card(c));
      sec.append(div, grid);
      if (!reduced.matches) { sec.classList.add('enter'); sec.addEventListener('animationend', () => sec.classList.remove('enter'), {once: true}); }
      list.append(sec); sections.push(sec);
      current?.observe(sec);
      updateSide();
    }

    let shown = 1, total = 1;
    function updateSide(n) {
      if (!side) return;
      if (n != null && n !== shown) {
        shown = n; const b = side.querySelector('b'); b.textContent = String(n);
        if (!reduced.matches) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
      }
      total = batches + 1;
      side.querySelector('.total').textContent = `共 ${total} 批`;
    }

    // The batch crossing the middle of the viewport is "current"; above the feed the native grid is batch 1.
    const visible = new Set();
    function track(entries) {
      for (const e of entries) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); }
      const nums = [...visible].map(s => Number(s.dataset.batch)).filter(Boolean);
      const top = box.getBoundingClientRect().top;
      updateSide(nums.length ? Math.max(...nums) : 1);
      place();
      side.classList.toggle('off', top > innerHeight * .6 && !nums.length);
    }

    // Sit in the page gutter beside the feed when there is room; otherwise shrink against the edge.
    function place() {
      if (!side || !box) return;
      const right = box.getBoundingClientRect().right, room = innerWidth - right;
      side.classList.toggle('tight', room < 84);
      side.style.left = room >= 84 ? `${Math.round(right + Math.min(24, (room - 64) / 2))}px` : '';
    }
    addEventListener('resize', () => place(), {passive: true});

    function mount() {
      const anchor = host.anchor();
      if (!anchor) return;
      if (!box) {
        box = el('div'); box.id = 'btr-flow-feed'; box.dataset.btrFlowOwned = '';
        shadow = box.attachShadow({mode: 'open'});
        shadow.append(el('style', null, CSS));
        list = el('div', 'list'); foot = el('div', 'foot'); foot.setAttribute('role', 'status'); foot.setAttribute('aria-live', 'polite');
        sentinel = el('div'); sentinel.style.height = '1px';
        side = el('div', 'side off'); side.setAttribute('role', 'button'); side.tabIndex = 0;
        side.title = '当前所在的推荐批次；点击回到这一批的开头';
        side.append(el('small', null, '第'), el('b', null, '1'), el('small', null, '批'), el('span', 'total', '共 1 批'), el('span', 'live'));
        const jump = () => { const s = sections.find(x => Number(x.dataset.batch) === shown); (s || anchor).scrollIntoView({behavior: reduced.matches ? 'auto' : 'smooth', block: 'start'}); };
        side.addEventListener('click', jump);
        side.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); } });
        shadow.append(list, foot, sentinel, side);

        new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) round(); }, {rootMargin: '0px 0px 150% 0px'}).observe(sentinel);
        current = new IntersectionObserver(track, {rootMargin: '-45% 0px -45% 0px'});
        status('idle');
      }
      if (box.previousElementSibling !== anchor || !box.isConnected) anchor.after(box);
      theme(); place();
    }

    function theme() {
      if (!box) return;
      const t = host.theme(), cols = host.columns();
      const v = {'--btr-text': t.dark ? '#e3e5e7' : '#18191c', '--btr-muted': t.dark ? '#9499a0' : '#9499a0', '--btr-line': t.dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)',
        '--btr-placeholder': t.oled ? '#000' : t.dark ? '#222' : '#f1f2f3', '--btr-side': t.oled ? 'rgba(0,0,0,.85)' : t.dark ? 'rgba(36,37,42,.92)' : 'rgba(255,255,255,.92)',
        '--btr-chip': t.dark ? 'rgba(251,114,153,.16)' : 'rgba(251,114,153,.1)', '--btr-columns': String(cols.count), '--btr-gap': cols.gap};
      for (const [k, val] of Object.entries(v)) box.style.setProperty(k, val);
      box.style.colorScheme = t.dark ? 'dark' : 'light';
    }

    function sync() {
      if (!host.enabled()) { stop(); return; }
      mount();
      box && box.toggleAttribute('hidden', host.hidden());
    }

    function stop() {
      clearTimeout(timer);
      if (!box) return;
      box.remove(); box = shadow = list = foot = side = sentinel = null; current?.disconnect(); current = null;
      sections = []; visible.clear(); seen.clear(); buffer = []; batches = 0; paused = false; fails = 0; loading = false;
    }

    return {sync, stop, theme, get batches() { return batches; }};
  }

  globalThis.__BTR_HOME_INFINITE__ = {create};
})();
