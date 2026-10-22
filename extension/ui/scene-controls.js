(function () {
  'use strict';
  const core = globalThis.__BTR_SCENE_CORE__, ui = globalThis.__BTR_UI__;
  const buttons = [...document.querySelectorAll('[data-scene-mode]')];
  function paint(value) {
    const mode = core.mode(value);
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.sceneMode === mode));
    for (const p of document.querySelectorAll('[data-scene-hint]')) p.textContent = core.MODES[mode].hint;
  }
  for (const button of buttons) button.addEventListener('click', async () => {
    for (const b of buttons) b.disabled = true;
    try {
      await chrome.storage.sync.set({sceneMode: button.dataset.sceneMode}); paint(button.dataset.sceneMode);
      for (const p of document.querySelectorAll('[data-scene-status]')) ui.flash(p, '已切换，当前 B 站页面立即生效。', 'ok');
    } catch (_) {
      for (const p of document.querySelectorAll('[data-scene-status]')) ui.flash(p, '切换失败，请重试。', 'error');
    } finally { for (const b of buttons) b.disabled = false; }
  });
  chrome.storage.sync.get(core.defaults).then(s => paint(s.sceneMode)).catch(() => paint('normal'));
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync' && c.sceneMode) paint(c.sceneMode.newValue); });
})();
