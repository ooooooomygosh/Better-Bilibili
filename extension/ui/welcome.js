'use strict';
const $ = id => document.getElementById(id);
const PRESETS = [
  {focusEnabled: false},
  {focusEnabled: true, focusWindowMinutes: 45, focusWeeklyHours: 5, focusWindowVideos: 0, focusSessionMinutes: 25, focusBreakMinutes: 5},
  {focusEnabled: true, focusWindowMinutes: 90, focusWeeklyHours: 10, focusWindowVideos: 0, focusSessionMinutes: 25, focusBreakMinutes: 5},
  {focusEnabled: true, focusWindowMinutes: 180, focusWeeklyHours: 20, focusWindowVideos: 0, focusSessionMinutes: 50, focusBreakMinutes: 10}
];
const keys = {...globalThis.__BTR_HOME_CORE__.defaults, ...globalThis.__BTR_FOCUS_CORE__.defaults};

function said(text) { $('saved').textContent = text; }
function show(s) {
  $('homeInfinite').checked = s.homeInfinite === true;
  const active = PRESETS.findIndex(p => Object.entries(p).every(([k, v]) => s[k] === v));
  document.querySelectorAll('#presets button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.p) === (s.focusEnabled ? active : 0))));
}
async function load() { show(await chrome.storage.sync.get(keys)); }

$('homeInfinite').addEventListener('change', async e => {
  await chrome.storage.sync.set({homeInfinite: e.target.checked});
  said(e.target.checked ? '已开启无限下滑，刷新 B 站首页即可看到。' : '已关闭无限下滑。');
});
document.querySelectorAll('#presets button').forEach(b => b.addEventListener('click', async () => {
  await chrome.storage.sync.set(PRESETS[Number(b.dataset.p)]);
  said(b.dataset.p === '0' ? '不限制观看时间。需要时可在快捷面板里打开。' : `已设为「${b.querySelector('b').textContent}」，从下一次观看开始计量。`);
  load();
}));
load().catch(e => said(e.message));
