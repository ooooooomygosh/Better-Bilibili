"use strict";

importScripts("focus-core.js");

const BADGE_COLOR = "#fb7299";

function setThreadBadge(tabId, enabled, activeThreads) {
  if (!Number.isInteger(tabId)) return Promise.resolve();
  const count = Math.max(0, Math.min(512, Math.trunc(Number(activeThreads) || 0)));
  const text = enabled ? String(count) : "";
  return Promise.all([
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }),
    chrome.action.setBadgeText({ tabId, text })
  ]).catch((error) => console.error("无法更新线程徽标", error));
}

async function prepareExtension() {
  const s = await chrome.storage.sync.get(null);
  const defaults = {mode:"auto", smartPolicy:true, strategy:"auto", memoryBudgetMB:64, maxAutoThreads:32};
  // One-time schema migration: preserve playback and proxy settings, remove the old forced theme.
  if (s.flowHomeSchema !== 2) {
    await chrome.storage.sync.set({flowHomeSchema:2,homeTheme:["native","oled"].includes(s.homeTheme)?s.homeTheme:"native",
      homeHideCarousel:s.homeHideCarousel !== false,homeHideBanner:s.homeHideBanner === true,homeHideAds:s.homeHideAds !== false});
  }
  const missing = Object.fromEntries(Object.entries(defaults).filter(([k]) => !(k in s)));
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);
}

chrome.runtime.onInstalled.addListener(prepareExtension);
// New users get a short tour of what the extension does and where its switches live.
chrome.runtime.onInstalled.addListener(({reason}) => {
  if (reason === "install") chrome.tabs.create({url: chrome.runtime.getURL("ui/welcome.html")}).catch(() => {});
});
chrome.runtime.onStartup.addListener(prepareExtension);

// The settings open inside the bilibili page, the same panel as in the userscript. Other
// pages have no content script to answer, and nothing happens there.
chrome.action.onClicked.addListener((tab) => {
  if (!Number.isInteger(tab?.id)) return;
  chrome.tabs.sendMessage(tab.id, { type: "openSettings" }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "setThreadBadge") setThreadBadge(sender.tab?.id, message.enabled === true, message.activeThreads);
  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") setThreadBadge(tabId, false, 0);
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id === chrome.runtime.id && message?.type === 'flow-open-options') chrome.runtime.openOptionsPage();
  if (sender.id === chrome.runtime.id && message?.type === 'flow-open-welcome') chrome.tabs.create({url: chrome.runtime.getURL("ui/welcome.html")}).catch(() => {});
  return false;
});

// Focus mode: the service worker is the only writer of today's usage, so several B 站 tabs
// cannot overwrite each other's counts. Requests are applied strictly one after another.
const focus = self.__BTR_FOCUS_CORE__;
let focusChain = Promise.resolve();
function focusRun(change, id) {
  const run = focusChain.then(async () => {
    const now = Date.now();
    const s = focus.settings(await chrome.storage.sync.get(focus.defaults));
    const {focusUsage} = await chrome.storage.local.get("focusUsage");
    const next = change ? change(focusUsage, now, s) : focus.usage(focusUsage, now, s);
    if (change) await chrome.storage.local.set({focusUsage: next});
    return {...focus.evaluate(next, now, s, id), enabled: s.focusEnabled, strict: s.focusStrict};
  });
  focusChain = run.catch(() => {});
  return run;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || typeof message?.type !== "string" || !message.type.startsWith("focus-")) return false;
  const id = typeof message.id === "string" ? message.id.slice(0, 120) : null;
  let job;
  if (message.type === "focus-tick") job = focusRun((u, now, s) => focus.tick(u, now, s, message.seconds, id), id);
  else if (message.type === "focus-check") job = focusRun(null, id);
  else if (message.type === "focus-snooze") job = focusRun((u, now, s) => focus.snooze(u, now, s, message.kind), id);
  else if (message.type === "focus-close-tab" && Number.isInteger(sender.tab?.id)) { chrome.tabs.remove(sender.tab.id).catch(() => {}); return false; }
  else return false;
  job.then(reply, (error) => reply({error: String(error?.message || error)}));
  return true;
});
