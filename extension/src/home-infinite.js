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
  const ui = globalThis.__BTR_UI__;
  const EASE = 'cubic-bezier(.2,.75,.25,1)';
  const FONT = ui ? ui.FONT : '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
  const SHOT = 'https://api.bilibili.com/x/player/videoshot';
  const TOVIEW = 'https://api.bilibili.com/x/v2/history/toview/add';
  const DISLIKE_KEY = 'flowDislikes', UP_KEY = 'flowHiddenUps', MAX_DISLIKES = 500;

  /* Shadow UI: footer status and the floating "第 N 批" indicator. */
  const CSS = `
:host{display:block;box-sizing:border-box;font:13px/1.5 ${FONT};color:var(--btr-text,#18191c)}
*{box-sizing:border-box}[hidden]{display:none!important}
.foot{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:10px;min-height:72px;padding:8px 0;color:var(--btr-muted,#61666d);font-size:13px;text-align:center}
.foot .msg{flex-basis:100%}
.foot .msg b{display:block;color:var(--btr-text,#18191c);font-size:14px;margin-bottom:2px}
.foot button{font:inherit;padding:6px 16px;border-radius:999px;border:1px solid var(--btr-line,rgba(128,128,128,.3));background:transparent;color:inherit;cursor:pointer;transition:border-color .14s ease,color .14s ease,background-color .14s ease}
.foot button:hover{border-color:#fb7299;color:#fb7299}
.foot button.primary{background:#fb7299;border-color:#fb7299;color:#fff}
.foot button.primary:hover{background:#e8618a;color:#fff}
.foot button:focus-visible{outline:2px solid #fb7299;outline-offset:2px}
.foot details{flex-basis:100%;font-size:12px}
.foot summary{cursor:pointer;display:inline-block;color:var(--btr-muted,#61666d)}
.foot code{display:inline-block;margin-top:6px;font:11px ui-monospace,Menlo,monospace;padding:2px 6px;border-radius:4px;background:var(--btr-chip,rgba(251,114,153,.1));overflow-wrap:anywhere}
.dots{display:inline-flex;gap:5px}.dots i{width:6px;height:6px;border-radius:50%;background:#fb7299;animation:btr-dot 1s ease-in-out infinite}
.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
.side{position:fixed;right:18px;top:50%;z-index:1000;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:2px;min-width:64px;padding:10px 10px 9px;border-radius:16px;
  background:var(--btr-side,rgba(255,255,255,.92));box-shadow:0 6px 24px rgba(0,0,0,.14);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);cursor:pointer;user-select:none;
  transition:opacity .22s ease,transform .22s ${EASE}}
.side:focus-visible{outline:2px solid #fb7299;outline-offset:2px}
.side.tight{right:4px;min-width:44px;padding:7px 5px;opacity:.88}.side.tight b{font-size:17px}.side.tight .total{display:none}
.side:not(.tight){right:auto}
.side.off{opacity:0;transform:translate(12px,-50%);pointer-events:none}
.side small{font-size:12px;color:var(--btr-muted,#61666d)}
.side b{font-size:22px;line-height:1.15;color:#fb7299;font-variant-numeric:tabular-nums}
.side .total{font-size:12px;color:var(--btr-muted,#61666d);font-variant-numeric:tabular-nums}
.side .live{width:6px;height:6px;border-radius:50%;background:#fb7299;margin-top:3px;opacity:0;transition:opacity .2s ease}
.side.loading .live{opacity:1;animation:btr-dot 1s ease-in-out infinite}
@keyframes btr-dot{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media(max-width:900px){.side{right:8px;min-width:54px;padding:8px 7px}.side b{font-size:18px}}
`;

  /* Light DOM: the cards use B 站's own markup and classes, so the site's stylesheet styles them
   * exactly like the native feed. Only layout glue and our extras are defined here. */
  const LIGHT_CSS = `
#btr-flow-feed{display:block;margin-top:8px;color:var(--text1,#18191c)}
#btr-flow-feed [hidden]{display:none!important}
#btr-flow-feed .btr-batch{margin-top:8px}
/* Only batches already scrolled past skip rendering; fresh ones always paint at once. */
#btr-flow-feed .btr-batch.btr-cv{content-visibility:auto;contain-intrinsic-size:auto 900px}
#btr-flow-feed .btr-divider{display:flex;align-items:center;gap:12px;margin:18px 0 16px;color:var(--btr-muted,#61666d);font-size:12px}
#btr-flow-feed .btr-divider::before,#btr-flow-feed .btr-divider::after{content:"";flex:1;height:1px;background:var(--btr-line,rgba(128,128,128,.22))}
#btr-flow-feed .btr-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 12px;border-radius:999px;background:var(--btr-chip,rgba(251,114,153,.1));color:#fb7299;font-weight:600;font-variant-numeric:tabular-nums}
#btr-flow-feed .btr-chip small{font-weight:400;font-size:12px;color:var(--btr-muted,#61666d)}
#btr-flow-feed .btr-grid{display:grid;grid-template-columns:repeat(var(--btr-columns,5),minmax(0,1fr));column-gap:var(--btr-gap,20px);row-gap:var(--btr-row-gap,20px)}
#btr-flow-feed .btr-grid>.feed-card{min-width:0;margin:0!important;display:block}
#btr-flow-feed .bili-video-card__image--wrap{position:relative}
#btr-flow-feed .bili-video-card__image--wrap{background:var(--btr-placeholder,#f1f2f3);border-radius:var(--btr-radius,6px)}
#btr-flow-feed .bili-video-card__cover img{opacity:0;transition:opacity .3s ease}
#btr-flow-feed .bili-video-card__cover img.btr-loaded{opacity:1}
/* Watch later & not interested: shown on hover, like the native card. */
#btr-flow-feed .bili-watch-later{display:none;cursor:pointer}
#btr-flow-feed .bili-video-card:hover .bili-watch-later,#btr-flow-feed .bili-watch-later.btr-done{display:flex}
#btr-flow-feed .bili-watch-later__tip--lab{display:none}
#btr-flow-feed .bili-watch-later:hover .bili-watch-later__tip--lab,#btr-flow-feed .bili-watch-later.btr-done .bili-watch-later__tip--lab{display:block}
#btr-flow-feed .bili-video-card__info--no-interest{display:none;cursor:pointer}
#btr-flow-feed .bili-video-card:hover .bili-video-card__info--no-interest,#btr-flow-feed .bili-video-card.btr-menu-open .bili-video-card__info--no-interest{display:flex}
#btr-flow-feed .bili-video-card__info{position:relative}
#btr-flow-feed .bili-video-card__wrap{position:relative}
/* ⋮ menu, styled like B 站's own card popover. */
#btr-flow-feed .btr-menu{position:fixed;z-index:1000;min-width:150px;padding:6px 0;border-radius:8px;background:var(--btr-menu-bg,#fff);border:1px solid var(--btr-line,rgba(0,0,0,.08));box-shadow:0 6px 20px rgba(0,0,0,.12);font-size:14px;color:var(--btr-text,#18191c);transform-origin:100% 0}
#btr-flow-feed .btr-menu button{display:flex;align-items:center;gap:8px;width:100%;padding:8px 14px;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;white-space:nowrap}
#btr-flow-feed .btr-menu button:hover,#btr-flow-feed .btr-menu button:focus-visible{background:var(--btr-menu-hover,#f1f2f3);color:#fb7299;outline:none}
#btr-flow-feed .btr-menu small{margin-left:auto;padding-left:10px;font-size:12px;color:var(--btr-muted,#9499a0)}
/* Hidden-by-you state, B 站-style: the cover blurs under a dark veil with 「已减少此类推荐」 and 撤销. It
   stays until you close it, scroll it away, or ~8 s pass while you are not on it; then the row reflows. */
#btr-flow-feed .btr-gone-card{position:relative;min-width:0;display:flex;flex-direction:column;cursor:default;user-select:none}
#btr-flow-feed .btr-gone-cover{position:relative;overflow:hidden;border-radius:var(--btr-radius,6px);background:var(--btr-placeholder,#f1f2f3);aspect-ratio:16/9;flex:none}
#btr-flow-feed .btr-gone-bg{position:absolute;inset:-20px;background:center/cover no-repeat;filter:blur(16px) saturate(.8);transform:scale(1.05)}
#btr-flow-feed .btr-gone{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(0,0,0,.45);color:#fff;font-size:14px;line-height:20px;text-align:center}
#btr-flow-feed .btr-gone .undo{min-width:76px;padding:4px 16px;border-radius:999px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.12);color:#fff;font:inherit;font-size:13px;cursor:pointer;transition:background-color .15s ease,border-color .15s ease}
#btr-flow-feed .btr-gone .undo:hover,#btr-flow-feed .btr-gone .undo:focus-visible{background:rgba(255,255,255,.28);border-color:#fff;outline:none}
#btr-flow-feed .btr-gone .x{position:absolute;top:6px;right:6px;width:24px;height:24px;display:grid;place-items:center;border:0;border-radius:50%;background:rgba(0,0,0,.25);color:#fff;font:16px/1 sans-serif;cursor:pointer;transition:background-color .15s ease}
#btr-flow-feed .btr-gone .x:hover,#btr-flow-feed .btr-gone .x:focus-visible{background:rgba(0,0,0,.5);outline:none}
#btr-flow-feed .btr-gone-info{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;color:var(--btr-muted,#9499a0)}
#btr-flow-feed .btr-gone-info span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#btr-flow-feed .btr-gone-info button{flex:none;padding:2px 10px;border:0;border-radius:6px;background:var(--btr-menu-hover,#f1f2f3);color:var(--btr-text,#18191c);font:inherit;font-size:12px;cursor:pointer}
#btr-flow-feed .btr-gone-info button:hover,#btr-flow-feed .btr-gone-info button:focus-visible{color:#fb7299;outline:none}
/* Hover preview: Bilibili's own storyboard frames, scrubbed by the pointer. */
#btr-flow-feed .btr-shot{position:absolute;inset:0;z-index:2;border-radius:inherit;background-repeat:no-repeat;pointer-events:none;opacity:0;transition:opacity .14s ease}
#btr-flow-feed .btr-shot.on{opacity:1}
#btr-flow-feed .btr-shot i{position:absolute;left:0;bottom:0;height:3px;width:100%;background:#fb7299;transform-origin:0 50%;transform:scaleX(0)}
/* Skeletons reuse B 站's own skeleton classes; the fallback below only applies if they are unstyled. */
#btr-flow-feed .btr-skel .bili-video-card__skeleton--cover{aspect-ratio:16/9;border-radius:6px;background:var(--graph_bg_regular,rgba(128,128,128,.12))}
#btr-flow-feed .btr-skel .bili-video-card__skeleton--text{height:16px;margin:10px 0 0;border-radius:4px;background:var(--graph_bg_regular,rgba(128,128,128,.12))}
#btr-flow-feed .btr-skel .bili-video-card__skeleton--text.short{width:50%}
#btr-flow-feed .btr-skel .bili-video-card__skeleton--light{height:14px;width:40%;margin:8px 0 0;border-radius:4px;background:var(--graph_bg_thin,rgba(128,128,128,.08))}
#btr-flow-feed .btr-skel{animation:btr-skel 1.4s ease-in-out infinite}
@keyframes btr-skel{0%,100%{opacity:1}50%{opacity:.55}}
#btr-flow-feed .btr-flash{position:absolute;left:50%;top:50%;z-index:5;transform:translate(-50%,-50%);padding:6px 12px;border-radius:999px;background:rgba(24,25,28,.86);color:#fff;font-size:12px;white-space:nowrap;pointer-events:none}
@media(prefers-reduced-motion:reduce){#btr-flow-feed *{animation:none!important;transition:none!important}#btr-flow-feed .bili-video-card__cover img{opacity:1}}
`;

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  const svgNS = 'http://www.w3.org/2000/svg';
  function svg(path, cls, box = '0 0 24 24') {
    const s = document.createElementNS(svgNS, 'svg'); s.setAttribute('viewBox', box); s.setAttribute('width', '24'); s.setAttribute('height', '24'); s.setAttribute('fill', 'currentColor');
    if (cls) s.setAttribute('class', cls);
    const p = document.createElementNS(svgNS, 'path'); p.setAttribute('d', path); s.append(p); return s;
  }
  // Fallback glyphs, used only if the native card's icons cannot be borrowed.
  const GLYPH = {
    play: 'M8 5.5v13l10.5-6.5z', danmaku: 'M4 5h16v11H9l-4 3v-3H4zM7 9h10M7 12h7',
    later: 'M12 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7zm-1 4v6l5 3 1-1.7-4-2.3V7z', up: 'M4 6h16v12H4zM8 10v4m0 0h2m4-4v4h2a2 2 0 0 0 0-4h-2',
    more: 'M12 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm0 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm0 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
    sad: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm-3 6v2m6-2v2m-6 5c1.5-1.5 4.5-1.5 6 0', undo: 'M8 4 4 8l4 4M4 8h10a6 6 0 0 1 0 12H8'
  };
  /* Our own controls on and over the cards. B 站's page (especially when logged in) listens for clicks
     on whole cards; to make sure a click on 撤销 / a menu item / 稍后再看 never reaches the card link or a
     page listener, the press is claimed at the very top of the capture phase and dispatched here. */
  const BOUND = new WeakMap();
  function bind(node, fn) { node.dataset.btrAct = ''; BOUND.set(node, fn); }
  if (!globalThis.__BTR_ACT_GUARD__) {
    globalThis.__BTR_ACT_GUARD__ = true;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'dblclick']) {
      addEventListener(type, e => {
        const n = e.target?.closest?.('#btr-flow-feed [data-btr-act]');
        if (!n) return;
        e.stopImmediatePropagation(); e.preventDefault();
        if (type === 'pointerdown' && n.matches('button,[tabindex]')) n.focus({preventScroll: true});
        if (type === 'click' && e.button === 0) { const fn = BOUND.get(n); if (fn) fn(e); }
      }, true);
    }
  }
  const csrf = () => (document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/) || [])[1] || '';

  function create(host) {
    let box = null, shadow = null, list = null, foot = null, side = null, sentinel = null;
    let current = null, sections = [];
    let batches = 0, idx = 1, loading = false, paused = false, fails = 0, timer = 0, keys = null, buffer = [];
    // Batches are a whole number of grid rows: 24 in a 5-column grid becomes 25, leftovers wait for the next batch.
    const cols = () => { const n = Number(host.columns()?.count); return n >= 1 && n <= 10 ? Math.floor(n) : 5; };
    const target = size => { const c = cols(); return Math.max(c, Math.round(size / c) * c); };
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
      loading = true; status('loading'); side?.classList.add('loading'); skeleton(true);
      const s = host.settings(), size = target(s.homeInfiniteSize), lanes = s.homeInfiniteThreads;
      const count = Math.max(lanes, Math.ceil(Math.max(0, size - buffer.length) / PAGE));
      nativeSeen();
      const results = await pool(count, lanes);
      loading = false; side?.classList.remove('loading');
      if (!box?.isConnected || !host.enabled()) { skeleton(false); return; }
      let fresh = 0, risk = null, error = null;
      for (const r of results) {
        if (r.ok) { const cards = feed.cards(r.items, seen).filter(c => !hidden(c)); fresh += cards.length; buffer.push(...cards); }
        else if (r.error?.kind === 'risk') risk = r.error;
        else error = r.error;
      }
      let added = 0;
      const want = target(host.settings().homeInfiniteSize); // The window may have been resized meanwhile.
      while (buffer.length >= want) { append(buffer.splice(0, want)); added++; }
      // The skeleton row stays under the newest batch as long as more can come, so reaching the
      // bottom always shows "more is on its way", never a blank hole. It goes only when loading pauses.
      if (risk || (!fresh && fails + 1 >= MAX_FAILS)) skeleton(false);
      if (risk) { paused = true; status('risk', risk); return; }
      if (!fresh) {
        if (++fails >= MAX_FAILS) { paused = true; status('error', error); return; }
      } else fails = 0;
      status('idle');
      // Still near the end without a full batch: fetch the rest right away (skeletons stay up meanwhile).
      timer = setTimeout(round, added || !fresh ? GAP_MS : 120);
    }

    function retry() { paused = false; fails = 0; round(); }
    function status(kind, err) {
      if (!foot) return;
      foot.replaceChildren();
      if (kind === 'loading') {
        const dots = el('span', 'dots'); dots.append(el('i'), el('i'), el('i'));
        foot.append(dots, el('span', null, `正在加载第 ${batches + 2} 批推荐…`));
      } else if (kind === 'risk' || kind === 'error') {
        // Plain words first; B 站's raw answer is one click away for bug reports.
        const msg = el('div', 'msg'), b = el('b', null, kind === 'risk' ? '刷得有点快，B 站让我们先歇一会儿' : '暂时没取到新的推荐');
        msg.append(b, el('span', null, kind === 'risk' ? '已暂停自动加载，不会继续请求。过几分钟再试，或者换成更稳的加载速度。' : '已暂停自动加载。可能是网络波动，稍后点「重试」即可。'));
        foot.append(msg);
        const again = el('button', null, '重试'); again.type = 'button'; again.onclick = retry;
        const threads = host.settings().homeInfiniteThreads;
        if (kind === 'risk' && threads > 1) {
          const calm = el('button', 'primary', '切到「稳」再试'); calm.type = 'button';
          calm.onclick = async () => { try { await chrome.storage.sync.set({homeInfiniteThreads: 1}); } catch (_) {} retry(); };
          foot.append(calm);
        }
        foot.append(again);
        if (err) {
          const d = el('details'), sum = el('summary', null, '技术详情');
          d.append(sum, el('code', null, `B 站返回 ${err.code ?? ''} ${String(err.message || '').slice(0, 80)}`.trim()));
          foot.append(d);
        }
      } else foot.append(el('span', null, batches ? `已加载 ${batches + 1} 批 · 继续下滑自动加载` : '继续下滑，自动加载更多推荐'));
    }

    /* ---------- native look: borrow B 站's markup details from a real card ---------- */
    let hints = null;
    function nativeHints() {
      if (hints) return hints;
      const native = [...document.querySelectorAll('.feed-card')].find(n => !n.closest('#btr-flow-feed') && n.querySelector('.bili-video-card__image--link[href*="/video/"]'));
      const pick = sel => { const n = native?.querySelector(sel); return n ? n.cloneNode(true) : null; };
      const attrs = el => el ? [...el.attributes].filter(a => a.name.startsWith('data-v-')).map(a => a.name) : [];
      const stats = native ? [...native.querySelectorAll('.bili-video-card__stats--item svg')].map(n => n.cloneNode(true)) : [];
      const h = {
        feedAttrs: attrs(native), innerAttrs: attrs(native?.querySelector('.bili-feed-card')),
        play: stats[0] || null, danmaku: stats[1] || null, later: pick('.bili-watch-later svg'), up: pick('.bili-video-card__info--owner svg'),
        more: pick('.bili-video-card__info--no-interest svg'), sad: pick('.bili-video-card__no-interest--left svg'), undo: pick('.revert-btn svg'),
        radio: native?.querySelector('.bili-video-card')?.style.getPropertyValue('--cover-radio') || '56.25%'
      };
      if (native) hints = h; // Cache only a real reading; retry while the page is still rendering.
      return h;
    }
    const icon = (h, name, cls, box) => { const n = h[name] ? h[name].cloneNode(true) : svg(GLYPH[name], cls, box); if (cls) n.setAttribute('class', cls); return n; };

    function picture(c, title) {
      const pic = el('picture', 'v-img bili-video-card__cover');
      const img = el('img'); img.alt = title; img.loading = 'lazy'; img.decoding = 'async';
      img.addEventListener('load', () => img.classList.add('btr-loaded'), {once: true});
      img.addEventListener('error', () => img.classList.add('btr-loaded'), {once: true});
      if (c.coverBase) {
        for (const [ext, type] of [['avif', 'image/avif'], ['webp', 'image/webp']]) {
          const src = el('source'); src.type = type; src.srcset = `${c.coverBase}@672w_378h_1c_!web-home-common-cover.${ext}`; pic.append(src);
        }
        img.src = `${c.coverBase}@672w_378h_1c_!web-home-common-cover`;
      } else if (c.cover) img.src = c.cover;
      pic.append(img);
      return pic;
    }

    // Same DOM and classes as B 站's current homepage card (.feed-card > .bili-feed-card > .bili-video-card).
    function card(c) {
      const h = nativeHints();
      const outer = el('div', 'feed-card'); for (const a of h.feedAttrs) outer.setAttribute(a, '');
      const inner = el('div', 'bili-feed-card'); for (const a of h.innerAttrs) inner.setAttribute(a, '');
      const v = el('div', 'bili-video-card is-rcmd'); v.style.setProperty('--cover-radio', h.radio);
      v.dataset.bvid = c.bvid; if (c.aid) v.dataset.aid = String(c.aid); if (c.mid) v.dataset.mid = String(c.mid);
      const wrap = el('div', 'bili-video-card__wrap');

      const link = el('a', 'bili-video-card__image--link'); link.href = c.url; link.target = '_blank'; link.rel = 'noopener';
      const image = el('div', 'bili-video-card__image'), iwrap = el('div', 'bili-video-card__image--wrap');
      const lw = el('div', 'bili-watch-later--wrap'), later = el('div', 'bili-watch-later bili-watch-later--pip');
      later.setAttribute('role', 'button'); later.tabIndex = 0; later.setAttribute('aria-label', '添加至稍后再看');
      const laterLab = el('span', 'bili-watch-later__tip--lab', '添加至稍后再看');
      later.append(icon(h, 'later', 'bili-watch-later__icon', '0 0 20 20'), laterLab); lw.append(later);
      iwrap.append(lw, picture(c, c.title), el('div', 'v-inline-player'));
      const mask = el('div', 'bili-video-card__mask'), stats = el('div', 'bili-video-card__stats'), left = el('div', 'bili-video-card__stats--left');
      for (const [name, val] of [['play', c.views], ['danmaku', c.danmaku]]) {
        const item = el('span', 'bili-video-card__stats--item'); item.append(icon(h, name, 'bili-video-card__stats--icon'), el('span', 'bili-video-card__stats--text', val)); left.append(item);
      }
      stats.append(left, el('span', 'bili-video-card__stats__duration', c.duration)); mask.append(stats);
      image.append(iwrap, mask); link.append(image);

      const info = el('div', 'bili-video-card__info'), right = el('div', 'bili-video-card__info--right');
      const more = el('div', 'bili-video-card__info--no-interest'); more.setAttribute('role', 'button'); more.tabIndex = 0; more.title = '更多操作';
      more.setAttribute('aria-label', '更多操作'); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
      more.append(icon(h, 'more', null));
      const tit = el('h3', 'bili-video-card__info--tit'); tit.title = c.title;
      const ta = el('a', null, c.title); ta.href = c.url; ta.target = '_blank'; ta.rel = 'noopener'; tit.append(ta);
      const bottom = el('div', 'bili-video-card__info--bottom');
      if (c.followed) bottom.append(el('span', 'bili-video-card__info--icon-text', '已关注'));
      const owner = el('a', 'bili-video-card__info--owner'); owner.target = '_blank'; owner.rel = 'noopener';
      if (c.mid) owner.href = `https://space.bilibili.com/${c.mid}`;
      const au = el('span', 'bili-video-card__info--author', c.author); au.title = c.author;
      owner.append(icon(h, 'up', null), au); if (c.date) owner.append(el('span', 'bili-video-card__info--date', `· ${c.date}`));
      bottom.append(owner);
      right.append(more, tit, bottom); info.append(right);
      wrap.append(link, info); v.append(wrap); inner.append(v); outer.append(inner);

      const act = (n, fn) => { bind(n, () => { if (openMenu && openMenu.more !== n) closeMenu(); fn(); }); n.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fn(); } }); };
      act(later, () => watchLater(c, later, laterLab));
      act(more, () => menu(c, v, more, later, laterLab));
      preview(c, iwrap, link);
      return outer;
    }

    /* ---------- watch later (B 站's own API, the page's login and CSRF token) ---------- */
    async function watchLater(c, btn, lab) {
      if (btn.classList.contains('btr-busy')) return;
      const token = csrf();
      const done = (text, ok) => {
        lab.textContent = text; btn.classList.add('btr-done'); btn.classList.toggle('btr-ok', !!ok);
        clearTimeout(btn._t); btn._t = setTimeout(() => { btn.classList.remove('btr-done'); lab.textContent = ok ? '已在稍后再看' : '添加至稍后再看'; }, 1800);
      };
      if (!token) { done('请先登录 B 站'); return; }
      btn.classList.add('btr-busy');
      try {
        const body = new URLSearchParams(c.aid ? {aid: String(c.aid), csrf: token} : {bvid: c.bvid, csrf: token});
        const r = await fetch(TOVIEW, {method: 'POST', credentials: 'include', body});
        const j = await r.json().catch(() => null);
        if (j?.code === 0) done('已添加至稍后再看', true);
        else if (j?.code === -101) done('请先登录 B 站');
        else if (j?.code === 90001) done('稍后再看列表已满');
        else done(j?.message ? `没加上：${String(j.message).slice(0, 20)}` : '没加上，请稍后再试');
      } catch (_) { done('网络异常，请稍后再试'); }
      finally { btn.classList.remove('btr-busy'); }
    }

    /* ---------- ⋮ menu: watch later / not interested / hide this uploader (the last two are local only;
       B 站's web feedback API is not public, so nothing is sent to its recommender) ---------- */
    let dislikes = new Set(), blockedUps = new Set();
    chrome.storage.local.get([DISLIKE_KEY, UP_KEY]).then(d => {
      if (Array.isArray(d[DISLIKE_KEY])) dislikes = new Set(d[DISLIKE_KEY].filter(x => typeof x === 'string'));
      if (Array.isArray(d[UP_KEY])) blockedUps = new Set(d[UP_KEY].map(String));
    }).catch(() => {});
    const hidden = c => dislikes.has(c.bvid) || (c.mid && blockedUps.has(String(c.mid)));
    const persist = () => chrome.storage.local.set({[DISLIKE_KEY]: [...dislikes].slice(-MAX_DISLIKES), [UP_KEY]: [...blockedUps].slice(-MAX_DISLIKES)}).catch(() => {});

    let openMenu = null;
    function closeMenu(focusBack) {
      if (!openMenu) return;
      const {node, v, more} = openMenu; openMenu = null;
      v.classList.remove('btr-menu-open'); more.setAttribute('aria-expanded', 'false');
      if (ui) ui.fadeOut(node, 120, [{opacity: 1, transform: 'none'}, {opacity: 0, transform: 'scale(.96)'}]); else node.remove();
      if (focusBack) more.focus({preventScroll: true});
    }
    document.addEventListener('pointerdown', e => { if (openMenu && !openMenu.node.contains(e.target) && !openMenu.more.contains(e.target)) closeMenu(); }, true);
    addEventListener('scroll', () => closeMenu(), {passive: true});
    function menu(c, v, more, later, laterLab) {
      const again = openMenu?.v === v; closeMenu();
      if (again) return;
      const node = el('div', 'btr-menu'); node.setAttribute('role', 'menu');
      const item = (text, note, fn) => {
        const b = el('button', null, text); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.tabIndex = -1;
        if (note) b.append(el('small', null, note));
        bind(b, e => { const key = !e || e.detail === 0; closeMenu(key); fn(key); });
        node.append(b); return b;
      };
      item('添加至稍后再看', null, () => watchLater(c, later, laterLab));
      item('不感兴趣', '仅本插件', key => gone(c, v, 'video', key));
      if (c.mid && c.author) item(`不想看「${c.author.length > 8 ? c.author.slice(0, 8) + '…' : c.author}」`, '仅本插件', key => gone(c, v, 'up', key));
      node.addEventListener('keydown', e => {
        const items = [...node.querySelectorAll('button')], i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
        else if (e.key === 'Tab') { e.preventDefault(); closeMenu(true); }
      });
      // The menu lives outside the card (fixed, at the end of our feed root), so presses on its items
      // can never be read by B 站 listeners as presses on the card.
      box.append(node);
      const r = more.getBoundingClientRect(), w = node.offsetWidth, hgt = node.offsetHeight;
      const below = r.bottom + 6 + hgt <= innerHeight - 8;
      node.style.top = `${Math.round(below ? r.bottom + 6 : Math.max(8, r.top - 6 - hgt))}px`;
      node.style.left = `${Math.round(Math.min(innerWidth - w - 8, Math.max(8, r.right - w)))}px`;
      node.style.transformOrigin = below ? 'top right' : 'bottom right';
      v.classList.add('btr-menu-open'); more.setAttribute('aria-expanded', 'true');
      openMenu = {node, v, more};
      if (ui) ui.animate(node, [{opacity: 0, transform: 'scale(.96) translateY(-4px)'}, {opacity: 1, transform: 'none'}], {duration: 140});
      node.querySelector('button').focus({preventScroll: true});
    }

    // The card steps out and a plain placeholder (one short line + 撤销) takes its cell; after a few
    // seconds it folds away and, when a spare card is waiting, a fresh one takes its place so the row
    // stays full. The placeholder is not a B 站 card, holds no link and sits inside no link, and the
    // detached card's links lose their href / target — so no page listener, delegated window.open or
    // middle-click can turn 撤销 into "open the video". 撤销 puts the very same card back.
    function stripLinks(node) {
      for (const a of node.querySelectorAll('a[href]')) {
        a.dataset.btrHref = a.getAttribute('href'); a.removeAttribute('href');
        if (a.hasAttribute('target')) { a.dataset.btrTarget = a.getAttribute('target'); a.removeAttribute('target'); }
        a.style.pointerEvents = 'none';
      }
    }
    function restoreLinks(node) {
      for (const a of node.querySelectorAll('a[data-btr-href]')) {
        a.setAttribute('href', a.dataset.btrHref); delete a.dataset.btrHref;
        if (a.dataset.btrTarget != null) { a.setAttribute('target', a.dataset.btrTarget); delete a.dataset.btrTarget; }
        a.style.pointerEvents = '';
      }
    }
    // Placeholders that are still waiting for the user (undo / dismiss).
    // No timer ever folds a placeholder that is on screen; it goes on ×, 知道了, or when the user
    // scrolls it away — and only after it has been on screen for MIN_VISIBLE in total and has
    // stayed fully out of the viewport for OUT_FOR. Live, a 2.5 s "after the pointer leaves"
    // timer and an instant IntersectionObserver fold made it vanish after ~2–3 s.
    const MIN_VISIBLE = 8000, OUT_FOR = 1000, USER_SCROLL_WINDOW = 1200;
    let lastUserInput = -Infinity;
    for (const t of ['wheel', 'touchmove', 'keydown', 'pointerdown']) addEventListener(t, () => { lastUserInput = performance.now(); }, {capture: true, passive: true});
    function gone(c, v, kind, viaKey) {
      const outer = v.closest('.feed-card');
      if (!outer || !outer.isConnected) return;
      if (kind === 'up') blockedUps.add(String(c.mid)); else dislikes.add(c.bvid);
      persist();
      const h = Math.round(outer.getBoundingClientRect().height);
      const ph = el('div', 'btr-gone-card'); ph.setAttribute('role', 'listitem');
      if (h) ph.style.height = `${h}px`;
      const cov = el('div', 'btr-gone-cover');
      const ratio = getComputedStyle(v).getPropertyValue('--cover-radio').trim();
      if (/^[\d.]+%$/.test(ratio)) cov.style.aspectRatio = String(100 / parseFloat(ratio));
      const img = v.querySelector('img'), src = img?.currentSrc || img?.src || '';
      const bg = el('div', 'btr-gone-bg');
      if (/^https:\/\/[^/"')\s]*hdslb\.com\/[^"')\s]*$/.test(src)) bg.style.backgroundImage = `url("${src}")`;
      const layer = el('div', 'btr-gone'); layer.setAttribute('role', 'status');
      const msg = el('div', null, kind === 'up' ? '已减少该 UP 主的推荐' : '已减少此类推荐');
      const undo = el('button', 'undo', '撤销'); undo.type = 'button';
      const x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', '关闭提示');
      layer.append(x, msg, undo); cov.append(bg, layer);
      const info = el('div', 'btr-gone-info');
      const note = el('span', null, kind === 'up' ? `不再显示「${c.author}」· 仅本插件` : '仅本插件生效，不影响 B 站推荐');
      note.title = '只在本插件里隐藏，不会发给 B 站，也不影响 B 站的推荐算法';
      const okBtn = el('button', null, '知道了'); okBtn.type = 'button';
      info.append(note, okBtn); ph.append(cov, info);
      bind(ph, () => {}); // Presses anywhere on the placeholder stop here.
      stripLinks(outer);
      outer.replaceWith(ph);
      if (ui) ui.animate(layer, [{opacity: 0}, {opacity: 1}], {duration: 220});
      if (viaKey) undo.focus({preventScroll: true});

      let done = false, focused = false, timer = 0, userScrollAt = -Infinity, outSince = 0;
      let visibleMs = 0, visibleSince = 0; // Time on screen, summed over every stretch in view.
      const onScreen = () => { const r = ph.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && r.height > 0; };
      const onScroll = () => {
        const now = performance.now();
        if (now - lastUserInput >= USER_SCROLL_WINDOW) return; // Layout / script scrolls do not count.
        userScrollAt = now;
        if (!done && !visibleSince && !timer) timer = setTimeout(check, OUT_FOR); // Off screen already: re-check once the user moves on.
      };
      addEventListener('scroll', onScroll, {passive: true});
      ph.addEventListener('focusin', () => { focused = true; });
      ph.addEventListener('focusout', e => { if (!ph.contains(e.relatedTarget)) focused = false; });
      function check() {
        timer = 0;
        if (done || !ph.isConnected) return;
        if (onScreen()) return; // Layout flicker: it is back (or never left).
        // The user must have scrolled it away (a scroll of theirs since just before it left), it must
        // have been on screen long enough, and it must be off screen for OUT_FOR now.
        if (userScrollAt < outSince - 300 || focused || visibleMs < MIN_VISIBLE) return; // Waits off screen.
        if (performance.now() - Math.max(outSince, 0) < OUT_FOR) { timer = setTimeout(check, OUT_FOR); return; }
        dismiss(true);
      }
      const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(es => {
        for (const e of es) {
          const now = performance.now();
          if (e.isIntersecting) { if (!visibleSince) visibleSince = now; clearTimeout(timer); timer = 0; }
          else {
            if (visibleSince) { visibleMs += now - visibleSince; visibleSince = 0; }
            outSince = now;
            clearTimeout(timer); timer = setTimeout(check, OUT_FOR);
          }
        }
      }) : null;
      io?.observe(ph);

      function finish() { done = true; clearTimeout(timer); io?.disconnect(); removeEventListener('scroll', onScroll); }
      function dismiss(offscreen) {
        if (done) return; finish();
        const others = kind === 'up' ? [...(list?.querySelectorAll(`.bili-video-card[data-mid="${String(c.mid).replace(/[^0-9]/g, "")}"]`) || [])].map(n => n.closest('.feed-card')).filter(Boolean) : [];
        refill([ph, ...others], !offscreen);
      }
      bind(x, () => dismiss()); bind(okBtn, () => dismiss());
      bind(undo, () => {
        if (done || !ph.isConnected) return;
        finish();
        if (kind === 'up') blockedUps.delete(String(c.mid)); else dislikes.delete(c.bvid);
        persist();
        ph.replaceWith(outer);
        // Links come back a moment later, after this press (and any trailing mouseup/click) is over.
        setTimeout(() => restoreLinks(outer), 0);
        if (ui) ui.animate(outer, [{opacity: 0}, {opacity: 1}], {duration: 180});
        outer.querySelector('.bili-video-card__info--no-interest')?.focus({preventScroll: true});
      });
    }

    /** Remove `nodes` and top each grid back up with spare cards at its end. With `animate`, the
     * removed cells fade, then the following cards glide to their new cells (FLIP). */
    function refill(nodes, animate) {
      nodes = nodes.filter(n => n.isConnected);
      if (!nodes.length) return;
      const grids = [...new Set(nodes.map(n => n.parentElement).filter(Boolean))];
      const apply = () => {
        const cells = grids.flatMap(g => [...g.children]).filter(n => !nodes.includes(n));
        const before = new Map(animate ? cells.map(n => [n, n.getBoundingClientRect()]) : []);
        for (const n of nodes) n.remove();
        const added = [];
        for (const g of grids) {
          const missing = nodes.filter(n => n.__grid === g).length;
          for (let k = 0; k < missing; k++) {
            const spare = buffer.findIndex(c => !hidden(c));
            if (spare < 0) break;
            const fresh = card(buffer.splice(spare, 1)[0]); fresh.setAttribute('role', 'listitem'); g.append(fresh); added.push(fresh);
          }
        }
        if (!animate || reduced.matches) return;
        for (const [n, r] of before) {
          const r2 = n.getBoundingClientRect(), dx = r.left - r2.left, dy = r.top - r2.top;
          if ((dx || dy) && r2.bottom > -200 && r2.top < innerHeight + 200) n.animate([{transform: `translate(${dx}px,${dy}px)`}, {transform: 'none'}], {duration: 320, easing: EASE});
        }
        for (const n of added) reveal(n, 0);
      };
      for (const n of nodes) n.__grid = n.parentElement;
      if (!animate || !ui || reduced.matches) { apply(); return; }
      let left = nodes.length;
      for (const n of nodes) {
        const a = n.animate([{opacity: 1, transform: 'none'}, {opacity: 0, transform: 'scale(.94)'}], {duration: 200, easing: EASE, fill: 'forwards'});
        let fired = false; const next = () => { if (fired) return; fired = true; if (--left === 0) apply(); };
        a.onfinish = next; setTimeout(next, 320); // Background tabs don't tick animations.
      }
    }

    /* ---------- hover preview: storyboard frames from B 站's videoshot API ---------- */
    const shots = new Map();
    async function storyboard(c) {
      if (shots.has(c.bvid)) return shots.get(c.bvid);
      const p = fetch(`${SHOT}?bvid=${c.bvid}&index=1`, {credentials: 'include'}).then(r => r.json()).then(j => {
        const d = j?.code === 0 ? j.data : null;
        if (!d || !Array.isArray(d.image) || !d.image.length || !d.img_x_len || !d.img_y_len) return null;
        const per = d.img_x_len * d.img_y_len, sheets = d.image.map(u => String(u).replace(/^\/\//, 'https://')).filter(u => /^https:\/\/[^/]*hdslb\.com\//.test(u));
        if (!sheets.length) return null;
        const total = Math.max(1, Math.min(sheets.length * per, Array.isArray(d.index) && d.index.length > 1 ? d.index.length - 1 : sheets.length * per));
        return {sheets, x: d.img_x_len, y: d.img_y_len, per, total};
      }).catch(() => null);
      shots.set(c.bvid, p);
      return p;
    }
    function preview(c, wrap, link) {
      let layer = null, bar = null, data = null, dwell = 0, inside = false, frame = -1;
      const paint = x => {
        if (!data || !layer) return;
        const r = wrap.getBoundingClientRect(), f = Math.min(data.total - 1, Math.max(0, Math.floor((x - r.left) / r.width * data.total)));
        if (f === frame) return; frame = f;
        const sheet = Math.floor(f / data.per), k = f % data.per, col = k % data.x, row = Math.floor(k / data.x);
        layer.style.backgroundImage = `url("${data.sheets[sheet]}")`;
        layer.style.backgroundSize = `${data.x * 100}% ${data.y * 100}%`;
        layer.style.backgroundPosition = `${data.x > 1 ? col / (data.x - 1) * 100 : 0}% ${data.y > 1 ? row / (data.y - 1) * 100 : 0}%`;
        bar.style.transform = `scaleX(${(f + 1) / data.total})`;
      };
      let lastX = 0;
      link.addEventListener('pointerenter', e => {
        if (e.pointerType !== 'mouse') return;
        inside = true; lastX = e.clientX;
        clearTimeout(dwell);
        // Wait a moment like the native card, so sweeping across the grid fires no requests.
        dwell = setTimeout(async () => {
          data = await storyboard(c);
          if (!inside || !data) return;
          layer = el('div', 'btr-shot'); bar = el('i'); layer.append(bar); wrap.append(layer); frame = -1; paint(lastX);
          requestAnimationFrame(() => layer?.classList.add('on'));
        }, 450);
      });
      link.addEventListener('pointermove', e => { lastX = e.clientX; if (layer) paint(e.clientX); }, {passive: true});
      link.addEventListener('pointerleave', () => { inside = false; clearTimeout(dwell); const l = layer; layer = null; if (l) { l.classList.remove('on'); setTimeout(() => l.remove(), 160); } });
    }

    /* ---------- skeletons while a batch is on its way ---------- */
    let skel = null;
    function skeleton(on, instant) {
      if (!list) return;
      if (!on) { const s = skel; skel = null; if (s) { if (ui && !instant) ui.fadeOut(s, 140); else s.remove(); } return; }
      if (skel) return;
      skel = el('div', 'btr-grid btr-skeletons'); skel.setAttribute('aria-hidden', 'true');
      const n = cols() * 2; // Two rows: enough to cover the gap below the fold while the batch is on its way.
      for (let i = 0; i < n; i++) {
        const v = el('div', 'bili-video-card btr-skel'), sk = el('div', 'bili-video-card__skeleton'), info = el('div', 'bili-video-card__skeleton--info'), r = el('div', 'bili-video-card__skeleton--right');
        r.append(el('p', 'bili-video-card__skeleton--text'), el('p', 'bili-video-card__skeleton--text short'), el('p', 'bili-video-card__skeleton--light'));
        info.append(r); sk.append(el('div', 'bili-video-card__skeleton--cover'), info); v.append(sk);
        if (i) v.style.animationDelay = `${(i % cols()) * 90}ms`;
        skel.append(v);
      }
      skel.style.marginTop = '24px';
      list.after(skel);
    }

    /* ---------- reveal: cards are always visible; the fade-up plays only for cards on screen ----------
       Cards already in view animate immediately (staggered); cards below the fold animate the moment
       they cross into view. Nothing ever waits at opacity 0 for an observer, so there are no blank holes. */
    const animateIn = (n, i) => n.animate?.([{opacity: 0, transform: 'translateY(12px)'}, {opacity: 1, transform: 'none'}], {duration: 320, delay: Math.min(i, 11) * 30, easing: EASE, fill: 'backwards'});
    const revealer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      const shown = entries.filter(e => e.isIntersecting).map(e => e.target);
      shown.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      shown.forEach((n, i) => { revealer.unobserve(n); animateIn(n, i); });
    }) : null;
    function reveal(node, i) {
      if (reduced.matches) return;
      const r = node.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) animateIn(node, i);
      else if (r.top >= innerHeight) revealer?.observe(node);
    }

    function append(cards) {
      const n = ++batches + 1; // The native grid is batch 1.
      const sec = el('section', 'btr-batch'); sec.dataset.batch = String(n);
      const div = el('div', 'btr-divider'), chip = el('span', 'btr-chip', `第 ${n} 批`);
      const at = new Date();
      chip.append(el('small', null, `${cards.length} 个视频 · ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`));
      div.append(chip);
      const grid = el('div', 'btr-grid'); grid.setAttribute('role', 'list');
      const nodes = cards.map(c => { const node = card(c); node.setAttribute('role', 'listitem'); return node; });
      grid.append(...nodes);
      sec.append(div, grid);
      list.append(sec); sections.push(sec);
      let i = 0; for (const node of nodes) { if (node.getBoundingClientRect().top < innerHeight) reveal(node, i++); else reveal(node, 0); }
      current?.observe(sec);
      updateSide();
    }

    let shown = 1, total = 1;
    function updateSide(n) {
      if (!side) return;
      if (n != null && n !== shown) {
        shown = n; const b = side.querySelector('b'); b.textContent = String(n);
        if (!reduced.matches) b.animate([{transform: 'translateY(5px)', opacity: .3}, {transform: 'none', opacity: 1}], {duration: 220, easing: EASE});
      }
      total = batches + 1;
      side.querySelector('.total').textContent = `共 ${total} 批`;
      side.setAttribute('aria-label', `当前第 ${shown} 批，共 ${total} 批。按回车回到这一批开头`);
    }

    // The batch crossing the middle of the viewport is "current"; above the feed the native grid is batch 1.
    const visible = new Set();
    function track(entries) {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target);
        if (!e.isIntersecting && e.boundingClientRect.bottom < 0) e.target.classList.add('btr-cv');
      }
      const nums = [...visible].map(s => Number(s.dataset.batch)).filter(Boolean);
      const top = box.getBoundingClientRect().top;
      // Middle of the screen on a divider or the skeleton row: stay on the last batch that started above it.
      let n = nums.length ? Math.max(...nums) : 1;
      if (!nums.length) for (const sec of sections) { if (sec.getBoundingClientRect().top < innerHeight / 2) n = Number(sec.dataset.batch); else break; }
      updateSide(n);
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
        const style = el('style', null, LIGHT_CSS);
        list = el('div', 'btr-feed-list');
        const uiHost = el('div', 'btr-feed-ui');
        shadow = uiHost.attachShadow({mode: 'open'});
        shadow.append(el('style', null, CSS));
        foot = el('div', 'foot'); foot.setAttribute('role', 'status'); foot.setAttribute('aria-live', 'polite');
        sentinel = el('div'); sentinel.style.height = '1px';
        side = el('div', 'side off'); side.setAttribute('role', 'button'); side.tabIndex = 0;
        side.title = '当前所在的推荐批次；点击回到这一批的开头';
        side.append(el('small', null, '第'), el('b', null, '1'), el('small', null, '批'), el('span', 'total', '共 1 批'), el('span', 'live'));
        const jump = () => { const s = sections.find(x => Number(x.dataset.batch) === shown); (s || anchor).scrollIntoView({behavior: reduced.matches ? 'auto' : 'smooth', block: 'start'}); };
        side.addEventListener('click', jump);
        side.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); } });
        shadow.append(foot, side);
        box.append(style, list, uiHost, sentinel);

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
      const v = {'--btr-text': t.dark ? '#e3e5e7' : '#18191c', '--btr-muted': t.dark ? '#a2a7ae' : '#61666d', '--btr-line': t.dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)',
        '--btr-placeholder': t.oled ? '#000' : t.dark ? '#222' : '#f1f2f3', '--btr-side': t.oled ? 'rgba(0,0,0,.85)' : t.dark ? 'rgba(36,37,42,.92)' : 'rgba(255,255,255,.92)',
        '--btr-chip': t.dark ? 'rgba(251,114,153,.16)' : 'rgba(251,114,153,.1)', '--btr-menu-bg': t.oled ? '#111' : t.dark ? '#232527' : '#fff', '--btr-menu-hover': t.dark ? 'rgba(255,255,255,.08)' : '#f1f2f3', '--btr-gone': t.oled ? 'rgba(0,0,0,.72)' : t.dark ? 'rgba(24,25,28,.72)' : 'rgba(255,255,255,.72)', '--btr-columns': String(cols.count), '--btr-gap': cols.gap, '--btr-row-gap': cols.rowGap || '20px'};
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
      closeMenu(); box.remove(); box = shadow = list = foot = side = sentinel = skel = null; current?.disconnect(); current = null;
      sections = []; visible.clear(); seen.clear(); buffer = []; batches = 0; paused = false; fails = 0; loading = false;
    }

    return {sync, stop, theme, get batches() { return batches; }, get state() { return box ? {loaded: batches + 1, current: shown, paused, loading} : null; }};
  }

  globalThis.__BTR_HOME_INFINITE__ = {create};
})();
