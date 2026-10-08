"use strict";

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
  return false;
});
