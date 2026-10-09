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
  /** Token CSS for an extension page: follows the OS theme. */
  const page = () => `:root{${base};${decl(LIGHT)};color-scheme:light}@media (prefers-color-scheme:dark){:root{${decl(DARK)};color-scheme:dark}}`;

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
    return a.finished.then(() => el.remove(), () => el.remove());
  }
  /** Replace a status line's text and replay its entrance, even if the text is unchanged. */
  function flash(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', kind === 'error');
    el.classList.toggle('ok', kind === 'ok');
    animate(el, [{opacity: 0, transform: 'translateY(-3px)'}, {opacity: 1, transform: 'none'}], {duration: MOTION.mid});
  }

  /* ---------- Bilibili theme detection (content scripts) ---------- */
  function luminanceDark(node) {
    const m = getComputedStyle(node).backgroundColor.match(/[\d.]+/g);
    if (!m || m.length < 3 || (m.length >= 4 && Number(m[3]) <= .1)) return null;
    return (Number(m[0]) * .2126 + Number(m[1]) * .7152 + Number(m[2]) * .0722) < 110;
  }
  /** True when the Bilibili page itself is dark, independent of the OS setting. */
  function isDark() {
    if (typeof document === 'undefined') return false;
    const html = document.documentElement;
    // Our own OLED override must not decide the theme it depends on.
    const had = html?.hasAttribute('data-btr-oled');
    if (had) html.removeAttribute('data-btr-oled');
    let dark = null;
    try {
      for (const n of [document.body, html]) {
        if (!n) continue;
        const marker = n.getAttribute('data-theme') || n.getAttribute('theme');
        if (marker === 'dark' || marker === 'light') { dark = marker === 'dark'; break; }
        const l = luminanceDark(n);
        if (l != null) { dark = l; break; }
      }
    } finally { if (had) html.setAttribute('data-btr-oled', ''); }
    return dark ?? darkOS.matches;
  }
  // One observer per isolated world, shared by every surface that cares about the theme.
  const listeners = new Set();
  let observer = null, last = null, pending = 0;
  function notify() {
    pending = 0;
    const d = isDark();
    if (d === last) return;
    last = d;
    for (const f of listeners) { try { f(d); } catch (_) {} }
  }
  const schedule = () => { if (!pending) pending = requestAnimationFrame(notify); };
  function startObserver() {
    if (observer || typeof MutationObserver !== 'function' || !document.documentElement) return;
    observer = new MutationObserver(schedule);
    const opts = {attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'theme', 'data-dark']};
    observer.observe(document.documentElement, opts);
    const body = () => { if (document.body) observer.observe(document.body, opts); };
    if (document.body) body(); else document.addEventListener('DOMContentLoaded', () => { body(); schedule(); }, {once: true});
    // B 站 may swap a theme stylesheet without touching attributes.
    if (document.head) observer.observe(document.head, {childList: true});
    darkOS.addEventListener?.('change', schedule);
  }
  /** Subscribe to Bilibili theme changes. Calls back immediately with the current value. */
  function onTheme(fn) {
    listeners.add(fn); startObserver();
    if (last == null) last = isDark();
    fn(last);
    return () => listeners.delete(fn);
  }

  const api = Object.freeze({LIGHT, DARK, MOTION, EASE, EASE_IN, FONT, scoped, page, reduced, animate, fadeOut, flash, isDark, onTheme});
  root.__BTR_UI__ = api;
  // Extension pages get the tokens as :root custom properties before first paint.
  try {
    if (typeof document !== 'undefined' && typeof location !== 'undefined' && !/^https?:$/.test(location.protocol) && document.head) {
      const st = document.createElement('style'); st.id = 'btr-tokens'; st.textContent = page(); document.head.prepend(st);
    }
  } catch (_) {}
  if (typeof module === 'object') module.exports = api;
})(globalThis);
