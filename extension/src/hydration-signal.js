/* BiliThrottle hydration signal — MAIN world, www.bilibili.com, document_start.
 * B 站's homepage is server-rendered and then hydrated by Vue. Any node a content script inserts into the
 * app's tree before hydration finishes makes Vue's hydration mismatch; Vue then throws away the native
 * recommendation grid (it was observed rendering the cards into our toolbar host, where they are invisible),
 * which is what left the homepage blank. Vue sets #app.__vue_app__ only after hydration, so once it appears
 * we mark <html data-btr-hydrated> for the isolated-world scripts, which wait for it before touching the tree.
 * Pages without a Vue root get the mark after the load event (plus a short grace), never later than 12 s.
 */
(function () {
  'use strict';
  if (window.top !== window || window.__BTR_HYDRATION_SIGNAL__) return;
  window.__BTR_HYDRATION_SIGNAL__ = true;
  const started = Date.now();
  let loadedAt = 0, timer = 0;
  addEventListener('load', () => { loadedAt = Date.now(); }, {once: true});
  const mark = how => {
    clearInterval(timer);
    try { document.documentElement.setAttribute('data-btr-hydrated', how); } catch (_) {}
  };
  const check = () => {
    const app = document.getElementById('app') || document.querySelector('[data-v-app]');
    if (app && app.__vue_app__) return mark('vue');
    if (loadedAt && Date.now() - loadedAt > 1500) return mark('load');
    if (Date.now() - started > 12000) mark('timeout');
  };
  timer = setInterval(check, 30);
})();
