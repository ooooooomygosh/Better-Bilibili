/* BiliThrottle 全站净化 — isolated world, every B 站 page, document_start.
 * Injects one stylesheet (inert until its attributes are set) and switches rules on per page.
 * The last state is mirrored in this origin's localStorage so the rules apply before chrome.storage
 * answers: ads never flash in and then disappear.
 */
(function () {
  'use strict';
  const core = globalThis.__BTR_CLEAN_CORE__;
  if (!core || globalThis.__BTR_CLEANER__ || window.top !== window) return;
  globalThis.__BTR_CLEANER__ = true;
  const FLAGS = 'btr-clean-flags';
  const html = () => document.documentElement;
  const where = () => location.hostname + location.pathname;
  let settings = null;

  const style = document.createElement('style');
  style.id = 'btr-clean-style'; style.dataset.btrFlowOwned = '';
  style.textContent = core.css();
  const mount = () => { if (html() && !style.isConnected) html().append(style); };

  function apply(s) {
    const r = html(); if (!r) return;
    const on = new Set(core.forPage(where()).filter(rule => s[rule.key]).map(rule => rule.key));
    for (const rule of core.RULES) { const a = core.attr(rule.key); if (r.hasAttribute(a) !== on.has(rule.key)) r.toggleAttribute(a, on.has(rule.key)); }
  }
  function mirror(s) { try { localStorage.setItem(FLAGS, JSON.stringify(core.settings(s))); } catch (_) {} }

  mount();
  try { const early = JSON.parse(localStorage.getItem(FLAGS) || 'null'); if (early) apply(core.settings(early)); } catch (_) {}

  chrome.storage.sync.get(core.defaults).then(s => { settings = core.settings(s); mount(); apply(settings); mirror(settings); }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !core.KEYS.some(k => changes[k])) return;
    const next = {...(settings || core.defaults)};
    for (const k of core.KEYS) if (changes[k]) next[k] = changes[k].newValue;
    settings = core.settings(next); apply(settings); mirror(settings);
  });

  // Floor cards say what they are only in their title text; tag them so 直播 and other floors can be told apart.
  function markKinds() {
    for (const n of document.querySelectorAll('.floor-single-card:not([data-btr-kind])')) {
      const t = (n.querySelector('.floor-title,.title,[class*="title"]')?.textContent || '').trim();
      n.dataset.btrKind = /直播/.test(t) || n.querySelector('a[href*="live.bilibili.com"]') ? 'live' : 'floor';
    }
  }
  let kindFrame = 0;
  const kinds = new MutationObserver(() => { if (!kindFrame && core.forPage(where()).some(r => r.key.startsWith('cleanHome'))) kindFrame = requestAnimationFrame(() => { kindFrame = 0; markKinds(); }); });
  const observe = () => { mount(); try { kinds.observe(document.body || html(), {childList: true, subtree: true}); } catch (_) {} };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, {once: true}); else observe();

  // B 站 switches some pages without a reload (search tabs, dynamic ↔ space); re-check the path now and then.
  let last = where();
  setInterval(() => { const w = where(); if (w !== last) { last = w; if (settings) apply(settings); } }, 1000);
  addEventListener('popstate', () => { last = where(); if (settings) apply(settings); });
})();
