/* BiliThrottle UI kit — shared design tokens, motion values and Bilibili theme detection.
 * Loaded by every surface: the isolated-world content scripts (quick panel, focus overlay, homepage)
 * and the extension pages (popup, options, welcome). One source for colours, type and motion.
 */
(function (root) {
  'use strict';
  if (root.__BTR_UI__) return;

  // Colours follow Bilibili's own palette (text1/2/3, brand pink) so injected UI blends in.
  const LIGHT = {
    'brand': '#fb7299', 'brand-hover': '#e8618a', 'brand-soft': 'rgba(251,114,153,.12)', 'brand-ring': 'rgba(251,114,153,.35)',
    'blue': '#00aeec',
    'text1': '#18191c', 'text2': '#61666d', 'text3': '#9499a0',
    'bg': '#ffffff', 'bg-float': 'rgba(255,255,255,.96)', 'bg2': '#f6f7f8', 'soft': '#f1f2f3', 'soft2': '#e3e5e7',
    'line': '#e3e5e7', 'danger': '#e2484c', 'warn-bg': '#fff4e0', 'warn-fg': '#7a5212', 'ok': '#2e9e5b',
    'shadow': '0 18px 50px rgba(0,0,0,.18)'
  };
  const DARK = {
    'brand': '#fb7299', 'brand-hover': '#ff8cae', 'brand-soft': 'rgba(251,114,153,.18)', 'brand-ring': 'rgba(251,114,153,.45)',
    'blue': '#00aeec',
    'text1': '#e3e5e7', 'text2': '#a2a7ae', 'text3': '#7d8188',
    'bg': '#1f2026', 'bg-float': 'rgba(31,32,38,.96)', 'bg2': '#17181c', 'soft': '#2a2b31', 'soft2': '#34363d',
    'line': '#2f3035', 'danger': '#ff6b6f', 'warn-bg': '#2b2312', 'warn-fg': '#e7cf9c', 'ok': '#5ccf8a',
    'shadow': '0 18px 50px rgba(0,0,0,.5)'
  };
  const MOTION = {fast: 140, mid: 220, slow: 320};
  const EASE = 'cubic-bezier(.2,.75,.25,1)';
  const EASE_IN = 'cubic-bezier(.4,0,1,1)';
  const FONT = '-apple-system,BlinkMacSystemFont,"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei","Segoe UI",sans-serif';

  const decl = map => Object.entries(map).map(([k, v]) => `--btr-${k}:${v}`).join(';');
  const base = `--btr-ease:${EASE};--btr-ease-in:${EASE_IN};--btr-fast:${MOTION.fast}ms;--btr-mid:${MOTION.mid}ms;--btr-slow:${MOTION.slow}ms;--btr-font:${FONT}`;
  /** Token CSS for a shadow root: light on `sel`, dark on `sel.dark`. */
  const scoped = (sel = '.root') => `${sel}{${base};${decl(LIGHT)}}${sel}.dark{${decl(DARK)}}`;
  /** Token CSS for an extension page: <html data-theme="dark|light"> decides; without it, the OS theme. */
  const page = () => `:root{${base};${decl(LIGHT)};color-scheme:light}:root[data-theme=dark]{${decl(DARK)};color-scheme:dark}@media (prefers-color-scheme:dark){:root:not([data-theme]){${decl(DARK)};color-scheme:dark}}`;

  const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : {matches: false};
  const darkOS = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : {matches: false, addEventListener() {}};

  /** Play a WAAPI animation unless the user asked for reduced motion. Returns the Animation or null. */
  function animate(el, frames, opts) {
    if (!el || reduced.matches || typeof el.animate !== 'function') return null;
    return el.animate(frames, {easing: EASE, ...opts});
  }
  /** Fade an element out and remove it. */
  function fadeOut(el, ms = MOTION.mid, frames) {
    if (!el) return Promise.resolve();
    const a = animate(el, frames || [{opacity: 1}, {opacity: 0}], {duration: ms, easing: EASE_IN, fill: 'forwards'});
    if (!a) { el.remove(); return Promise.resolve(); }
    // Background tabs may never tick the animation: remove on a timer as well.
    const t = setTimeout(() => el.remove(), ms + 120);
    return a.finished.then(() => { clearTimeout(t); el.remove(); }, () => { clearTimeout(t); el.remove(); });
  }
  /** Replace a status line's text and replay its entrance, even if the text is unchanged. */
  function flash(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', kind === 'error');
    el.classList.toggle('ok', kind === 'ok');
    animate(el, [{opacity: 0, transform: 'translateY(-3px)'}, {opacity: 1, transform: 'none'}], {duration: MOTION.mid});
  }

  /* ---------- Bilibili theme detection (content scripts) ----------
     How B 站 signals its theme today (checked against the live site, 2026-10):
       - homepage (laputa-home): toggles class `bili_dark` on <html>; tokens such as --bg1 / --Ga0 flip with it
       - video & older pages: swap <link> stylesheets bili-theme/light(.css|_u.css) <-> bili-theme/dark(...)
         by changing the link's href (an attribute change, not an insertion), the new sheet loads async
       - the server-side cookie `theme_style` only matters at page load (already reflected by the above)
     Order: explicit markers -> theme tokens (not transitioned, so no mid-fade misreads) -> painted background -> OS. */
  function rgbDark(text) {
    const t = String(text || '').trim();
    let r, g, b, a = 1;
    const hex = t.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    if (hex) { const h = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1]; r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16); }
    else { const m = t.match(/[\d.]+/g); if (!/^rgba?\(/.test(t) || !m || m.length < 3) return null; [r, g, b] = m.map(Number); if (m.length >= 4) a = Number(m[3]); }
    if (a <= .1) return null;
    return (r * .2126 + g * .7152 + b * .0722) < 110;
  }
  const luminanceDark = node => rgbDark(getComputedStyle(node).backgroundColor);
  function themeLinks() {
    let dark = false, light = false;
    for (const l of document.querySelectorAll('link[rel~="stylesheet"][href*="bili-theme/"]')) {
      if (l.disabled || (l.media && l.media !== 'all' && !matchMedia(l.media).matches)) continue;
      const name = (l.getAttribute('href').split('bili-theme/')[1] || '').toLowerCase();
      if (/^dark/.test(name)) dark = true; else if (/^light/.test(name)) light = true;
    }
    return dark ? true : light ? false : null;
  }
  /** True when the Bilibili page itself is dark, independent of the OS setting. */
  function isDark() {
    if (typeof document === 'undefined') return false;
    const html = document.documentElement, body = document.body;
    if (!html) return darkOS.matches;
    if (html.classList.contains('bili_dark') || body?.classList.contains('bili_dark')) return true;
    for (const n of [html, body]) {
      const marker = n?.getAttribute('data-theme') || n?.getAttribute('theme');
      if (marker === 'dark' || marker === 'light') return marker === 'dark';
    }
    const linked = themeLinks();
    if (linked != null) return linked;
    // Our own OLED override must not decide the theme it depends on.
    const had = html.hasAttribute('data-btr-oled');
    if (had) html.removeAttribute('data-btr-oled');
    try {
      const cs = getComputedStyle(html);
      for (const v of ['--bg1', '--Ga0']) { const d = rgbDark(cs.getPropertyValue(v)); if (d != null) return d; }
      for (const n of [body, html]) { if (!n) continue; const l = luminanceDark(n); if (l != null) return l; }
    } finally { if (had) html.setAttribute('data-btr-oled', ''); }
    return darkOS.matches;
  }
  // One observer per isolated world, shared by every surface that cares about the theme.
  const listeners = new Set();
  let observer = null, last = null, pending = 0, poll = 0;
  const late = [];
  function notify() {
    pending = 0;
    const d = isDark();
    if (d === last) return;
    last = d;
    record(d);
    for (const f of listeners) { try { f(d); } catch (_) {} }
  }
  // Content scripts remember B 站's last theme so the popup / options / welcome pages can match it.
  let recorded = null;
  function record(d) {
    try {
      if (!/^https?:$/.test(location.protocol) || recorded === d || !root.chrome?.storage?.local) return;
      recorded = d;
      chrome.storage.local.get('biliTheme').then(v => { if (v.biliTheme?.dark !== d) return chrome.storage.local.set({biliTheme: {dark: d, at: Date.now()}}); }).catch(() => {});
    } catch (_) {}
  }
  // Check now, and again once a swapped stylesheet has had time to load / a CSS fade to settle.
  function schedule() {
    if (!pending) pending = requestAnimationFrame(notify);
    while (late.length) clearTimeout(late.pop());
    late.push(setTimeout(notify, 350), setTimeout(notify, 1200));
  }
  function startObserver() {
    if (observer || typeof MutationObserver !== 'function' || !document.documentElement) return;
    observer = new MutationObserver(schedule);
    const opts = {attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'theme', 'data-dark']};
    observer.observe(document.documentElement, opts);
    const later = () => {
      if (document.body) observer.observe(document.body, opts);
      // Stylesheets added, removed, or re-pointed (href / media / disabled) anywhere in <head>.
      if (document.head) observer.observe(document.head, {childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'media', 'disabled']});
      schedule();
    };
    if (document.body) later(); else document.addEventListener('DOMContentLoaded', later, {once: true});
    // A stylesheet finishing its download changes the painted colours: load events don't bubble, so capture.
    document.addEventListener('load', e => { if (e.target?.tagName === 'LINK') schedule(); }, true);
    darkOS.addEventListener?.('change', schedule);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
    // Last resort for theme switches we cannot observe: a cheap check every 4 s while the tab is visible.
    poll = setInterval(() => { if (!document.hidden && listeners.size) notify(); }, 4000);
  }
  /** Subscribe to Bilibili theme changes. Calls back immediately with the current value. */
  function onTheme(fn) {
    listeners.add(fn); startObserver();
    if (last == null) { last = isDark(); record(last); }
    fn(last);
    return () => listeners.delete(fn);
  }

  const api = Object.freeze({LIGHT, DARK, MOTION, EASE, EASE_IN, FONT, scoped, page, reduced, animate, fadeOut, flash, isDark, onTheme});
  root.__BTR_UI__ = api;
  // Extension pages get the tokens as :root custom properties before first paint, and a theme:
  // 跟随 B 站 (default: the last theme the content scripts saw on B 站, else the OS) / 跟随系统 / 浅色 / 深色.
  try {
    if (typeof document !== 'undefined' && typeof location !== 'undefined' && !/^https?:$/.test(location.protocol) && document.head) {
      const st = document.createElement('style'); st.id = 'btr-tokens'; st.textContent = page(); document.head.prepend(st);
      const html = document.documentElement, CACHE = 'btr-ui-theme';
      const set = mode => {
        if (mode === 'dark' || mode === 'light') html.dataset.theme = mode; else delete html.dataset.theme;
        try { localStorage.setItem(CACHE, mode || ''); } catch (_) {}
      };
      // Synchronous first guess from the last visit avoids a light flash on a dark setup.
      try { const c = localStorage.getItem(CACHE); if (c === 'dark' || c === 'light') html.dataset.theme = c; } catch (_) {}
      const store = root.chrome?.storage;
      const resolve = async () => {
        if (!store) return;
        try {
          const [{uiTheme = 'bili'}, {biliTheme}] = await Promise.all([store.sync.get({uiTheme: 'bili'}), store.local.get('biliTheme')]);
          if (uiTheme === 'dark' || uiTheme === 'light') set(uiTheme);
          else if (uiTheme === 'bili' && typeof biliTheme?.dark === 'boolean') set(biliTheme.dark ? 'dark' : 'light');
          else set(darkOS.matches ? 'dark' : 'light');
        } catch (_) {}
      };
      resolve();
      store?.onChanged?.addListener((c, area) => { if ((area === 'sync' && c.uiTheme) || (area === 'local' && c.biliTheme)) resolve(); });
      darkOS.addEventListener?.('change', resolve);
    }
  } catch (_) {}
  if (typeof module === 'object') module.exports = api;
})(globalThis);
