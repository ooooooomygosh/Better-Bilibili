/* Isolated-world mode UI and the display-only switch consumed by comment-location.js. */
(function () {
  'use strict';
  const core = globalThis.__BTR_SCENE_CORE__, ui = globalThis.__BTR_UI__;
  if (!core || !ui || window !== window.top || globalThis.__BTR_SCENE__) return;
  globalThis.__BTR_SCENE__ = true;
  let cfg = core.settings(), hub = null, badge = null, previous = '';
  const style = document.createElement('style');
  style.textContent = `
    html[data-btr-scene-home] :is(.recommended-container_floor-aside,.recommended-container,.bili-feed4-layout,.bili-feed4 .feed2,.bili-feed4 .channel-layout){display:none!important}
    html[data-btr-scene-video] :is(.recommend-list-v1,.rec-list,.video-page-card-small-list,.bpx-player-ending-related){display:none!important}
    html[data-btr-scene-comments] :is(#comment,#commentapp,.comment-container,bili-comments){display:none!important}
  `;
  document.documentElement.append(style);
  const el = (tag, text) => { const n = document.createElement(tag); if (text) n.textContent = text; return n; };
  const save = async value => {
    try { await chrome.storage.sync.set({sceneMode: value}); }
    catch (_) { ui.toast({text: '切换失败，请在扩展设置中重试。', kind: 'error', timeout: 4000}); }
  };
  function surface(floating) {
    const host = document.createElement('div');
    host.id = floating ? 'btr-scene-badge' : 'btr-scene-hub';
    const shadow = host.attachShadow({mode: 'open'}), css = el('style');
    css.textContent = `${ui.scoped('.scene')}
      :host{display:block;${floating ? 'position:fixed;left:20px;bottom:20px;z-index:999;' : 'position:relative;z-index:1;max-width:960px;margin:36px auto;padding:0 24px;'}}
      *{box-sizing:border-box}.scene{font:15px/1.65 var(--btr-font);color:var(--btr-text1);background:var(--btr-bg);border:1px solid var(--btr-line);border-radius:24px;padding:${floating ? '10px 16px' : 'clamp(24px,5vw,56px)'};box-shadow:var(--btr-shadow)}
      h1{font-size:clamp(26px,4vw,40px);line-height:1.3;margin:8px 0 16px}p{color:var(--btr-text2);margin:12px 0}small{color:var(--btr-text3)}
      nav{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0}a,button{font:inherit;color:inherit;border:1px solid var(--btr-line);border-radius:999px;padding:8px 16px;background:var(--btr-bg2);text-decoration:none;cursor:pointer}
      a:hover,button:hover{color:var(--btr-brand);border-color:var(--btr-brand)}:focus-visible{outline:3px solid var(--btr-brand);outline-offset:3px}
      form{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}input{flex:1;min-width:150px;font:inherit;color:inherit;background:var(--btr-bg2);border:1px solid var(--btr-line);padding:12px 18px;border-radius:12px}
      .exit{margin-left:12px;padding:4px 12px;font-size:13px}.meta{display:flex;align-items:center;justify-content:space-between;gap:12px}.brand{font-size:12px;letter-spacing:.1em;color:var(--btr-brand)}
      @media(max-width:520px){:host{${floating ? 'left:10px;bottom:12px;max-width:calc(100vw - 78px)' : 'margin-top:24px;padding:0 12px'}}.scene{border-radius:18px}}
    `;
    const box = el('section'); box.className = 'scene';
    if (ui.isDark()) box.classList.add('dark');
    const m = core.MODES[cfg.sceneMode], exit = el('button', '退出模式'); exit.type = 'button'; exit.className = 'exit'; exit.onclick = () => save('normal');
    if (floating) { box.append(el('span', `${m.icon} ${m.label}模式`), exit); }
    else {
      const meta = el('div'); meta.className = 'meta'; const brand = el('span', 'BILITHROTTLE · 为这一次观看选个目的'); brand.className = 'brand'; meta.append(brand, exit);
      box.append(meta, el('h1', cfg.sceneMode === 'study' ? '今天，想学会什么？' : '今天，想吃点什么？'), el('p', m.hint));
      const form = el('form'), input = el('input'); input.type = 'search'; input.maxLength = 100; input.required = true;
      input.placeholder = cfg.sceneMode === 'study' ? '搜索课程、知识或技能' : '搜索食材、菜谱或店名'; input.setAttribute('aria-label', input.placeholder);
      const go = el('button', '去 B 站搜索'); go.type = 'submit'; form.append(input, go);
      form.onsubmit = event => { event.preventDefault(); if (input.value.trim()) location.href = core.searchURL(input.value); };
      const nav = el('nav'); nav.setAttribute('aria-label', `${m.label}搜索入口`);
      for (const term of m.searches) { const a = el('a', term); a.href = core.searchURL(term); nav.append(a); }
      box.append(form, nav, el('small', '原来的首页设置仍保留；退出即可恢复。观看额度和自律锁继续生效。'));
    }
    shadow.append(css, box); return host;
  }
  function render() {
    const root = document.documentElement, on = cfg.sceneMode !== 'normal';
    const home = location.hostname === 'www.bilibili.com' && /^\/(?:(?:index\.html|zh-Hans|zh-Hant|en)\/?)?$/i.test(location.pathname);
    const video = location.hostname === 'www.bilibili.com' && /^\/(?:zh-Hans\/|zh-Hant\/|en\/)?(?:video|bangumi\/play|list|medialist)\//i.test(location.pathname);
    // Build the replacement before hiding the feed; a failed mount must leave the site usable.
    hub?.remove(); badge?.remove(); hub = badge = null;
    if (on && document.body) { if (home) document.body.append(hub = surface(false)); else document.body.append(badge = surface(true)); }
    root.toggleAttribute('data-btr-scene-home', on && home && !!hub);
    root.toggleAttribute('data-btr-scene-video', on && video);
    root.toggleAttribute('data-btr-scene-comments', cfg.sceneMode === 'study' && !cfg.sceneStudyComments && video);
    root.setAttribute('data-btr-comment-location', cfg.commentLocation ? 'on' : 'off');
    previous = location.pathname;
  }
  chrome.storage.sync.get(core.defaults).then(raw => { cfg = core.settings(raw); render(); }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !Object.keys(core.defaults).some(k => changes[k])) return;
    cfg = core.settings({...cfg, ...Object.fromEntries(Object.keys(core.defaults).filter(k => changes[k]).map(k => [k, changes[k].newValue]))}); render();
  });
  ui.onTheme(() => { for (const host of [hub, badge]) host?.shadowRoot.querySelector('.scene').classList.toggle('dark', ui.isDark()); });
  // History API updates do not cross worlds. One cheap path comparison also handles SPA routes.
  setInterval(() => { if (location.pathname !== previous) render(); }, 1000);
})();
