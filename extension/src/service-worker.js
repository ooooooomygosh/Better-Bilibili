"use strict";

importScripts("focus-core.js", "lock-core.js", "stats-core.js");

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
  // The old "海外访问" proxy section was removed in 2.3.0 (Chrome never allowed `proxy` as an
  // optional permission, so it could not be granted); drop its saved address, if any.
  chrome.storage.local.remove("flowProxy").catch(() => {});
  // One-time schema migration: preserve playback settings, remove the old forced theme.
  if (s.flowHomeSchema !== 2) {
    await chrome.storage.sync.set({flowHomeSchema:2,homeTheme:["native","oled"].includes(s.homeTheme)?s.homeTheme:"native",
      homeHideCarousel:s.homeHideCarousel !== false,homeHideBanner:s.homeHideBanner === true,homeHideAds:s.homeHideAds !== false});
  }
  // 2.5.0: the homepage has two separate modes. Someone already on 无限下滑 has made that choice;
  // "不想看此 UP 主" from the feed menu (kept locally until now) joins the synced uploader block list.
  if (s.homeInfinite === true && s.homeModeChosen === undefined) await chrome.storage.sync.set({homeModeChosen: true});
  try {
    const {flowHiddenUps} = await chrome.storage.local.get("flowHiddenUps");
    if (Array.isArray(flowHiddenUps) && flowHiddenUps.length) {
      const ups = Array.isArray(s.filterUps) ? [...s.filterUps] : [];
      for (const mid of flowHiddenUps) { const e = `uid:${String(mid).replace(/\D/g, "")}`; if (e !== "uid:" && !ups.some(u => u === e || u.startsWith(e + ":"))) ups.push(e); }
      await chrome.storage.sync.set({filterUps: ups.slice(-300)});
      await chrome.storage.local.remove("flowHiddenUps");
    }
  } catch (_) {}
  const missing = Object.fromEntries(Object.entries(defaults).filter(([k]) => !(k in s)));
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);
}

// A failed migration must not surface as an unhandled rejection; it runs again on the next startup.
const prepareSafely = () => prepareExtension().catch(e => console.warn("BiliThrottle: prepare failed", e));
chrome.runtime.onInstalled.addListener(prepareSafely);
// New users get a short tour of what the extension does and where its switches live.
chrome.runtime.onInstalled.addListener(({reason}) => {
  if (reason === "install") chrome.tabs.create({url: chrome.runtime.getURL("ui/welcome.html")}).catch(() => {});
});
chrome.runtime.onStartup.addListener(prepareSafely);

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "setThreadBadge") setThreadBadge(sender.tab?.id, message.enabled === true, message.activeThreads);
  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") setThreadBadge(tabId, false, 0);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id === chrome.runtime.id && message?.type === 'flow-open-options') {
    const hash = typeof message.hash === "string" && /^[a-z-]{1,20}$/.test(message.hash) ? message.hash : "";
    openExtensionPage("ui/options.html", hash).then(sendResponse, e => sendResponse({ok: false, error: String(e?.message || e)}));
    return true;
  }
  if (sender.id === chrome.runtime.id && message?.type === 'flow-open-report') {
    openExtensionPage("ui/report.html", "").then(sendResponse, e => sendResponse({ok: false, error: String(e?.message || e)}));
    return true;
  }
  if (sender.id === chrome.runtime.id && message?.type === 'flow-open-welcome') {
    openExtensionPage("ui/welcome.html", "").then(sendResponse, e => sendResponse({ok: false, error: String(e?.message || e)}));
    return true;
  }
  return false;
});

/** Focus an already open copy of one of our pages, else open a new tab. Always answers, so the
 * caller can retry when a just-woken service worker dropped the first request. No "tabs" permission needed. */
async function openExtensionPage(path, hash) {
  const base = chrome.runtime.getURL(path), url = hash ? `${base}#${hash}` : base;
  try {
    const open = (await chrome.runtime.getContexts?.({contextTypes: ["TAB"]}) || [])
      .find(c => c.tabId >= 0 && c.documentUrl && c.documentUrl.split("#")[0] === base);
    if (open) {
      await chrome.tabs.update(open.tabId, hash ? {active: true, url} : {active: true});
      if (open.windowId >= 0) await chrome.windows.update(open.windowId, {focused: true}).catch(() => {});
      return {ok: true, reused: true};
    }
  } catch (_) { /* fall through to a new tab */ }
  try { await chrome.tabs.create({url}); return {ok: true}; }
  catch (e) {
    if (path === "ui/options.html") { await chrome.runtime.openOptionsPage(); return {ok: true, fallback: true}; }
    throw e;
  }
}

// Focus mode: the service worker is the only writer of today's usage, so several B 站 tabs
// cannot overwrite each other's counts. Requests are applied strictly one after another.
// The same queue also owns the self-discipline lock, so a settings change, a guard revert and a
// usage tick can never interleave.
const focus = self.__BTR_FOCUS_CORE__;
const lockCore = self.__BTR_LOCK_CORE__;
const stats = self.__BTR_STATS_CORE__;
let focusChain = Promise.resolve();
function serial(job) {
  const run = focusChain.then(job);
  focusChain = run.catch(() => {});
  return run;
}

async function readLock() {
  const {focusLock} = await chrome.storage.local.get("focusLock");
  return lockCore.normalize(focusLock);
}
// Lock first, then sync: the guard below compares sync with lock.approved, so the order keeps
// our own writes from looking like a bypass.
async function writeLock(lock, syncChanges) {
  if (lock) await chrome.storage.local.set({focusLock: lock});
  else await chrome.storage.local.remove("focusLock");
  if (syncChanges && Object.keys(syncChanges).length) await chrome.storage.sync.set(syncChanges);
}
// Apply pending changes whose cool-down has passed. Runs on every tick/check, so no alarms permission is needed.
async function settleLock(now) {
  const lock = await readLock();
  if (!lock) return null;
  const r = lockCore.settle(lock, now);
  if (!r.changed) return lock;
  await writeLock(r.lock, r.lock ? r.applied : null);
  return r.lock;
}
// While locked, the approved values are what counts, whatever sync storage says.
async function effectiveSettings(lock) {
  const sync = await chrome.storage.sync.get(focus.defaults);
  return focus.settings(lock ? {...sync, ...lock.approved} : sync);
}

// `change` may return null to leave the quota untouched (a tick while only the weekly report is on).
// `played` ({seconds, up}) is real playback for the 观看周报, recorded in the same queue.
function focusRun(change, id, played) {
  return serial(async () => {
    const now = Date.now();
    const lock = await settleLock(now);
    const s = await effectiveSettings(lock);
    const {focusUsage} = await chrome.storage.local.get("focusUsage");
    const inBreak = s.focusEnabled && focus.usage(focusUsage, now).breakUntil > now;
    const changed = change ? change(focusUsage, now, s) : null;
    const next = changed || focus.usage(focusUsage, now, s);
    if (changed) await chrome.storage.local.set({focusUsage: next});
    const result = focus.evaluate(next, now, s, id);
    await recordStats(now, played && !inBreak ? played : null, id, s.focusEnabled ? result.block : null).catch(e => console.warn("观看统计写入失败", e));
    return {...result, enabled: s.focusEnabled, strict: s.focusStrict,
      locked: !!lock, lockHasPassword: lockCore.hasPassword(lock)};
  });
}

// 观看周报: local per-day totals, written only here (inside the serial queue), whether or not the quota is on.
async function recordStats(now, played, id, block) {
  const tag = stats.brakeTag(block);
  if (!played && !tag) return;
  const {statsEnabled} = stats.settings(await chrome.storage.sync.get(stats.defaults));
  if (!statsEnabled) return;
  const {watchStats} = await chrome.storage.local.get("watchStats");
  let st = watchStats, dirty = false;
  if (played) { st = stats.tick(st, now, played.seconds, id, played.up); dirty = true; }
  if (tag && st?.brake !== tag) { st = stats.brake(st, now, tag); dirty = true; }
  if (dirty) await chrome.storage.local.set({watchStats: st});
}
async function statsNotice() {
  const s = stats.settings(await chrome.storage.sync.get(stats.defaults));
  if (!s.statsEnabled || !s.statsWeeklyNotice) return {show: false};
  const now = Date.now(), {watchStats} = await chrome.storage.local.get("watchStats");
  const r = stats.notice(watchStats, now);
  if (r.next) await chrome.storage.local.set({watchStats: r.next}); // Marked first, so only one tab shows it.
  return r.show ? {show: true, seconds: r.seconds, total: stats.fmt(r.seconds), week: r.week, range: stats.range(r.week)} : {show: false};
}

// Settings requests from the popup, options page, welcome page and quick panel.
async function focusSet(changes, password) {
  const now = Date.now();
  const clean = {};
  const norm = focus.settings({...focus.defaults, ...changes});
  for (const k of lockCore.KEYS) if (changes && k in changes) clean[k] = norm[k];
  let lock = await settleLock(now);
  if (!lock) { await chrome.storage.sync.set(clean); return {applied: clean, deferred: {}, lock: lockCore.view(null)}; }
  let authorized = false;
  if (password) {
    const v = await lockCore.verify(lock, password, now);
    lock = v.lock;
    if (!v.ok) { await writeLock(lock); return {error: v.error, lock: lockCore.view(lock, now)}; }
    authorized = true;
  }
  const r = lockCore.request(lock, clean, now, authorized);
  await writeLock(r.lock, {...r.lock.approved});
  return {applied: r.applied, deferred: r.deferred, lock: lockCore.view(r.lock, now)};
}

async function lockAction(message) {
  const now = Date.now();
  let lock = await settleLock(now);
  const auth = async () => {
    if (!message.password) return false;
    const v = await lockCore.verify(lock, message.password, now);
    lock = v.lock;
    if (!v.ok) { await writeLock(lock); throw new Error(v.error); }
    return true;
  };
  switch (message.type) {
    case "lock-state": return lockCore.view(lock, now);
    case "lock-create": {
      if (lock) throw new Error("自律锁已经开启。");
      const pw = typeof message.newPassword === "string" ? message.newPassword : "";
      if (pw && pw.length < 4) throw new Error("密码至少 4 位。");
      const current = await effectiveSettings(null);
      const approved = {...current, focusEnabled: true};
      lock = await lockCore.create(approved, {password: pw, cooldownHours: message.cooldownHours}, now);
      await writeLock(lock, {focusEnabled: true});
      return lockCore.view(lock, now);
    }
    case "lock-cooldown": {
      if (!lock) throw new Error("自律锁未开启。");
      const authorized = await auth();
      const r = lockCore.setCooldown(lock, message.cooldownHours, now, authorized);
      await writeLock(r.lock);
      return {...lockCore.view(r.lock, now), deferredAt: r.deferredAt};
    }
    case "lock-password": {
      if (!lock) throw new Error("自律锁未开启。");
      const pw = typeof message.newPassword === "string" ? message.newPassword : "";
      if (pw && pw.length < 4) throw new Error("密码至少 4 位。");
      // Adding a password where there was none only makes the lock stricter.
      if (lockCore.hasPassword(lock) && !(await auth())) throw new Error("修改密码需要输入当前密码；忘记密码时只能等冷却期解除自律锁。");
      if (!pw && lockCore.hasPassword(lock)) throw new Error("不能直接删除密码；可以解除自律锁后重新开启。");
      lock = await lockCore.setPassword(lock, pw);
      await writeLock(lock);
      return lockCore.view(lock, now);
    }
    case "lock-remove": {
      if (!lock) return lockCore.view(null);
      const authorized = await auth();
      const r = lockCore.remove(lock, now, authorized);
      await writeLock(r.lock);
      return {...lockCore.view(r.lock, now), deferredAt: r.deferredAt};
    }
    case "lock-cancel": {
      if (!lock) return lockCore.view(null);
      lock = lockCore.cancel(lock, typeof message.key === "string" ? message.key : null);
      await writeLock(lock);
      return lockCore.view(lock, now);
    }
  }
  throw new Error("unknown");
}

// Guard: any write that loosens limits while locked (an old UI, a stale tab, another device's sync,
// a hand-edited storage call from an extension page) is reverted and queued behind the cool-down.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !lockCore.KEYS.some((k) => changes[k])) return;
  serial(async () => {
    const now = Date.now();
    const lock = await settleLock(now);
    if (!lock) return;
    const sync = focus.settings(await chrome.storage.sync.get(focus.defaults));
    const candidate = {};
    for (const k of lockCore.KEYS) if (sync[k] !== lock.approved[k]) candidate[k] = sync[k];
    if (!Object.keys(candidate).length) return;
    const r = lockCore.request(lock, candidate, now, false);
    await writeLock(r.lock, {...r.lock.approved});
  }).catch((e) => console.error("自律锁校验失败", e));
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || typeof message?.type !== "string") return false;
  if (message.type.startsWith("lock-")) {
    serial(() => lockAction(message)).then(reply, (error) => reply({error: String(error?.message || error)}));
    return true;
  }
  if (message.type === "focus-set") {
    const changes = message.changes && typeof message.changes === "object" ? message.changes : {};
    serial(() => focusSet(changes, typeof message.password === "string" ? message.password : "")).then(reply, (error) => reply({error: String(error?.message || error)}));
    return true;
  }
  if (message.type === "stats-notice" || message.type === "stats-clear") {
    serial(() => message.type === "stats-clear" ? chrome.storage.local.remove("watchStats").then(() => ({ok: true})) : statsNotice())
      .then(reply, (error) => reply({error: String(error?.message || error)}));
    return true;
  }
  if (!message.type.startsWith("focus-")) return false;
  const id = typeof message.id === "string" ? message.id.slice(0, 120) : null;
  let job;
  if (message.type === "focus-tick") {
    const up = message.up && typeof message.up === "object" ? {mid: String(message.up.mid ?? "").slice(0, 24), name: String(message.up.name ?? "").slice(0, 60)} : null;
    // The quota only meters while it is on; the weekly report records either way (if statsEnabled).
    job = focusRun((u, now, s) => s.focusEnabled ? focus.tick(u, now, s, message.seconds, id) : null, id, {seconds: message.seconds, up});
  }
  else if (message.type === "focus-check") job = focusRun(null, id);
  else if (message.type === "focus-snooze") job = snooze(message, id);
  else if (message.type === "focus-close-tab" && Number.isInteger(sender.tab?.id)) { chrome.tabs.remove(sender.tab.id).catch(() => {}); return false; }
  else return false;
  job.then(reply, (error) => reply({error: String(error?.message || error)}));
  return true;
});

// "Watch 5 more minutes" loosens the limit, so a lock asks for the password (no cool-down makes
// sense for a snooze). Without a password on the lock, snoozing is off while locked.
async function snooze(message, id) {
  const gate = await serial(async () => {
    const now = Date.now(), lock = await settleLock(now);
    if (!lock) return null;
    if (!lockCore.hasPassword(lock)) return "自律锁开启中，不能再看。";
    const v = await lockCore.verify(lock, message.password, now);
    await writeLock(v.lock);
    return v.ok ? null : v.error;
  });
  if (gate) return {error: gate};
  return focusRun((u, now, s) => focus.snooze(u, now, s, message.kind), id);
}

chrome.runtime.onStartup.addListener(() => { serial(() => settleLock(Date.now())).catch(() => {}); });
