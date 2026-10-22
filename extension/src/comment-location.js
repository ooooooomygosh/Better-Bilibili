/* MAIN world: modern B 站 comment elements keep their public reply data in __data.
 * The isolated script sets a display-only attribute. This script never calls a network or
 * extension API, and never sends comment text, identities or location data out of the page. */
(function () {
  'use strict';
  const core = globalThis.__BTR_COMMENT_CORE__;
  if (!core || globalThis.__BTR_COMMENT_LOCATION__) return;
  globalThis.__BTR_COMMENT_LOCATION__ = true;
  const RENDERERS = 'bili-comment-renderer,bili-comment-reply-renderer,.reply-item,.sub-reply-item';
  const CONTAINERS = `${RENDERERS},bili-comments,bili-comment-thread-renderer,bili-comment-replies-renderer`;
  const nodes = new Set(), observers = new Map();
  let enabled = false, timer = null;
  const badges = new Map();
  function discover(node) {
    if (!enabled || !node?.querySelectorAll) return;
    const found = node.matches?.(CONTAINERS) ? [node] : [];
    found.push(...node.querySelectorAll(CONTAINERS));
    for (const item of found) {
      if (nodes.size < 1000) nodes.add(item);
      if (item.shadowRoot) observe(item.shadowRoot);
    }
  }
  function observe(root) {
    if (observers.has(root) || observers.size >= 1000) return;
    const observer = new MutationObserver(records => {
      for (const r of records) for (const n of r.addedNodes) discover(n);
    });
    observers.set(root, observer); observer.observe(root, {childList: true, subtree: true}); discover(root);
  }
  function removeBadge(node) { badges.get(node)?.remove(); badges.delete(node); }
  function paint(node) {
    if (!node.matches(RENDERERS)) return;
    const scope = node.shadowRoot || node;
    const reply = node.__data || node.__vue__?.$props?.reply || node.__vue__?.reply;
    const own = element => element && (node.shadowRoot || element.closest(RENDERERS) === node);
    const candidate = scope.querySelector('#location,.reply-location,.reply-ip-location,.ip-location');
    const native = own(candidate) ? candidate : null;
    const label = core.locationLabel(reply?.reply_control?.location || native?.textContent);
    if (!label) { removeBadge(node); return; }
    // Reuse the site's own visible label when available. Do not duplicate it or modify its styles.
    if (native && native.textContent.trim() && native.getClientRects().length && getComputedStyle(native).visibility !== 'hidden') { removeBadge(node); return; }
    const target = scope.querySelector('#info,.reply-info,.sub-reply-info,.info');
    if (!own(target)) { removeBadge(node); return; }
    let badge = badges.get(node);
    if (!badge || badge.parentNode !== target) {
      removeBadge(node); badge = document.createElement('span'); badge.className = 'btr-comment-location';
      badge.style.cssText = 'display:inline-block;margin-inline-start:10px;color:var(--text3,#9499a0);font-size:12px;font-weight:400;white-space:normal;';
      badge.title = 'B 站公开的评论 IP 属地；不是精确位置'; target.append(badge); badges.set(node, badge);
    }
    if (badge.textContent !== label) badge.textContent = label;
  }
  function refresh() {
    if (!enabled || document.hidden) return;
    for (const [root, observer] of observers) if (root.host && !root.host.isConnected) { observer.disconnect(); observers.delete(root); }
    for (const node of nodes) {
      if (!node.isConnected) { nodes.delete(node); removeBadge(node); continue; }
      // A web component may attach its shadow root after being inserted into the page.
      if (node.shadowRoot) observe(node.shadowRoot);
      try { paint(node); } catch (_) { removeBadge(node); }
    }
  }
  function sync() {
    const on = document.documentElement.getAttribute('data-btr-comment-location') === 'on';
    if (on === enabled) return;
    enabled = on;
    if (on) { observe(document); refresh(); timer = setInterval(refresh, 1200); }
    else {
      clearInterval(timer); for (const observer of observers.values()) observer.disconnect(); observers.clear();
      for (const badge of badges.values()) badge.remove(); badges.clear(); nodes.clear();
    }
  }
  new MutationObserver(sync).observe(document.documentElement, {attributes: true, attributeFilter: ['data-btr-comment-location']});
  document.addEventListener('visibilitychange', refresh); sync();
})();
