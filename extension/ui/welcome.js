'use strict';
const $ = id => document.getElementById(id);
const PRESETS = [
  {focusEnabled: false},
  {focusEnabled: true, focusWindowMinutes: 45, focusWeeklyHours: 5, focusWindowVideos: 0, focusSessionMinutes: 25, focusBreakMinutes: 5},
  {focusEnabled: true, focusWindowMinutes: 90, focusWeeklyHours: 10, focusWindowVideos: 0, focusSessionMinutes: 25, focusBreakMinutes: 5},
  {focusEnabled: true, focusWindowMinutes: 180, focusWeeklyHours: 20, focusWindowVideos: 0, focusSessionMinutes: 50, focusBreakMinutes: 10}
];
const keys = {...globalThis.__BTR_HOME_CORE__.defaults, ...globalThis.__BTR_FOCUS_CORE__.defaults};

const ui = globalThis.__BTR_UI__;
function said(text, kind) { ui.flash($('saved'), text, kind); }
function show(s) {
  for (const b of document.querySelectorAll('#modes button')) b.setAttribute('aria-checked', String(s.homeModeChosen && (b.dataset.mode === 'infinite') === (s.homeInfinite === true)));
  const active = PRESETS.findIndex(p => Object.entries(p).every(([k, v]) => s[k] === v));
  document.querySelectorAll('#presets button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.p) === (s.focusEnabled ? active : 0))));
}
async function load() { show(await chrome.storage.sync.get(keys)); }

document.querySelectorAll('#modes button').forEach(b => b.addEventListener('click', async () => {
  const inf = b.dataset.mode === 'infinite';
  await chrome.storage.sync.set({homeInfinite: inf, homeModeChosen: true});
  said(inf ? '已选「无限下滑」：打开 B 站首页，一直往下刷就行。' : '已选「换一批」：推荐区上方有上一批 / 下一批 / 换一批。', 'ok');
  load();
}));
// Watch limits go through the service worker, so a self-discipline lock can hold back loosening.
document.querySelectorAll('#presets button').forEach(b => b.addEventListener('click', async () => {
  try {
    const r = await chrome.runtime.sendMessage({type: 'focus-set', changes: PRESETS[Number(b.dataset.p)]});
    if (r?.error) throw new Error(r.error);
    const later = Object.values(r?.deferred || {});
    if (later.length) said(`🔒 自律锁开启中：放宽的部分将在 ${globalThis.__BTR_FOCUS_CORE__.fmtReset(Math.max(...later))} 生效。`);
    else said(b.dataset.p === '0' ? '已关闭观看额度。之前设的时长都还在，随时可以在快捷面板里重新打开。' : `已设为「${b.querySelector('b').textContent}」，从下一次观看开始计量。`, 'ok');
  } catch (e) { said(e.message, 'error'); }
  load();
}));
load().catch(e => said(e.message));
