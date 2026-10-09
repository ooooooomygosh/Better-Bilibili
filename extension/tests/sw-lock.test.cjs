'use strict';
// Service-worker integration: the lock guard, deferred settings and password path, with chrome.* mocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const SRC = path.join(__dirname, '../src');

function boot() {
  const data = {sync: {}, local: {}}, changed = [], messages = [];
  const area = name => ({
    async get(keys) {
      const all = structuredClone(data[name]);
      if (keys == null) return all;
      if (typeof keys === 'string') return keys in all ? {[keys]: all[keys]} : {};
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter(k => k in all).map(k => [k, all[k]]));
      return {...keys, ...Object.fromEntries(Object.keys(keys).filter(k => k in all).map(k => [k, all[k]]))};
    },
    async set(obj) {
      const ch = {};
      for (const [k, v] of Object.entries(obj)) { ch[k] = {oldValue: data[name][k], newValue: structuredClone(v)}; data[name][k] = structuredClone(v); }
      setTimeout(() => changed.forEach(f => f(ch, name)), 0);
    },
    async remove(keys) { const ch = {}; for (const k of [].concat(keys)) { ch[k] = {oldValue: data[name][k]}; delete data[name][k]; } setTimeout(() => changed.forEach(f => f(ch, name)), 0); }
  });
  const ev = () => ({addListener() {}});
  const chrome = {
    storage: {sync: area('sync'), local: area('local'), onChanged: {addListener: f => changed.push(f)}},
    runtime: {id: 'ext', onInstalled: ev(), onStartup: ev(), onMessage: {addListener: f => messages.push(f)}, getURL: p => p, openOptionsPage() {}},
    action: {onClicked: ev(), setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {}},
    tabs: {onUpdated: ev(), create: async () => {}, remove: async () => {}, sendMessage: async () => {}}
  };
  const ctx = {chrome, console, crypto: globalThis.crypto, TextEncoder, btoa, atob, setTimeout, clearTimeout, structuredClone, Promise};
  ctx.self = ctx; ctx.globalThis = ctx;
  ctx.importScripts = (...files) => files.forEach(f => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx));
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'service-worker.js'), 'utf8'), ctx);
  const send = msg => new Promise(resolve => {
    for (const f of messages) if (f(msg, {id: 'ext'}, resolve) === true) return;
    resolve(undefined);
  });
  const settle = () => new Promise(r => setTimeout(r, 30));
  return {data, send, settle, chrome};
}

test('no lock: focus-set writes straight through', async () => {
  const sw = boot();
  const r = await sw.send({type: 'focus-set', changes: {focusEnabled: true, focusWindowMinutes: 120}});
  assert.equal(r.applied.focusWindowMinutes, 120);
  assert.equal(sw.data.sync.focusWindowMinutes, 120);
});

test('locked: loosening through the UI is deferred, tightening is immediate', async () => {
  const sw = boot();
  await sw.send({type: 'focus-set', changes: {focusEnabled: true, focusWindowMinutes: 90}});
  const v = await sw.send({type: 'lock-create', newPassword: 'abcd1234', cooldownHours: 24});
  assert.equal(v.locked, true); assert.equal(v.hasPassword, true);
  const r = await sw.send({type: 'focus-set', changes: {focusWindowMinutes: 200, focusWeeklyHours: 5}});
  assert.ok(r.deferred.focusWindowMinutes);
  assert.equal(sw.data.sync.focusWindowMinutes, 90);
  assert.equal(sw.data.sync.focusWeeklyHours, 5);
  const bad = await sw.send({type: 'focus-set', changes: {focusWindowMinutes: 200}, password: 'wrong'});
  assert.match(bad.error, /密码/);
  const ok = await sw.send({type: 'focus-set', changes: {focusWindowMinutes: 200}, password: 'abcd1234'});
  assert.equal(ok.applied.focusWindowMinutes, 200);
  assert.equal(sw.data.sync.focusWindowMinutes, 200);
});

test('locked: a direct storage write that loosens limits is reverted by the guard', async () => {
  const sw = boot();
  await sw.send({type: 'focus-set', changes: {focusEnabled: true}});
  await sw.send({type: 'lock-create', cooldownHours: 6});
  await sw.chrome.storage.sync.set({focusEnabled: false, focusWindowMinutes: 0});
  await sw.settle(); await sw.settle();
  assert.equal(sw.data.sync.focusEnabled, true);
  assert.equal(sw.data.sync.focusWindowMinutes, 90);
  const st = await sw.send({type: 'lock-state'});
  assert.ok(st.pending.focusEnabled && st.pending.focusWindowMinutes);
  // Usage is evaluated with the approved settings.
  const c = await sw.send({type: 'focus-check'});
  assert.equal(c.enabled, true); assert.equal(c.locked, true);
});

test('locked without password: snooze refused; removal only after the cool-down', async () => {
  const sw = boot();
  await sw.send({type: 'focus-set', changes: {focusEnabled: true}});
  await sw.send({type: 'lock-create', cooldownHours: 1});
  const s = await sw.send({type: 'focus-snooze', kind: 'window'});
  assert.match(s.error, /自律锁/);
  const r = await sw.send({type: 'lock-remove'});
  assert.equal(r.locked, true); assert.ok(r.deferredAt > Date.now());
  // Fast-forward: make the pending removal due.
  sw.data.local.focusLock.pending.remove.effectiveAt = Date.now() - 1;
  const st = await sw.send({type: 'lock-state'});
  assert.equal(st.locked, false);
});

test('changing the password needs the current one', async () => {
  const sw = boot();
  await sw.send({type: 'lock-create', newPassword: 'first1', cooldownHours: 24});
  const no = await sw.send({type: 'lock-password', newPassword: 'second2'});
  assert.ok(no.error);
  const yes = await sw.send({type: 'lock-password', newPassword: 'second2', password: 'first1'});
  assert.equal(yes.hasPassword, true);
  const ok = await sw.send({type: 'lock-remove', password: 'second2'});
  assert.equal(ok.locked, false);
});

test('flow-open-options always answers: new tab, focus an open one, fallback to openOptionsPage', async () => {
  const sw = boot(), made = [], updated = [], J = x => JSON.parse(JSON.stringify(x));
  let opened = 0;
  sw.chrome.tabs.create = async o => { made.push(o.url); };
  sw.chrome.tabs.update = async (id, o) => { updated.push([id, o]); };
  sw.chrome.windows = {update: async () => {}};
  sw.chrome.runtime.openOptionsPage = async () => { opened++; };
  sw.chrome.runtime.getContexts = async () => [];
  assert.deepEqual(J(await sw.send({type: 'flow-open-options'})), {ok: true});
  assert.deepEqual(made, ['ui/options.html']);
  await sw.send({type: 'flow-open-options', hash: 'lock'});
  assert.equal(made[1], 'ui/options.html#lock');
  sw.chrome.runtime.getContexts = async () => [{tabId: 7, windowId: 2, documentUrl: 'ui/options.html#focus'}];
  assert.deepEqual(J(await sw.send({type: 'flow-open-options'})), {ok: true, reused: true});
  assert.deepEqual(J(updated[0]), [7, {active: true}]);
  sw.chrome.runtime.getContexts = async () => { throw new Error('old Chrome'); };
  sw.chrome.tabs.create = async () => { throw new Error('no window'); };
  assert.deepEqual(J(await sw.send({type: 'flow-open-options'})), {ok: true, fallback: true});
  assert.equal(opened, 1);
  const w = await sw.send({type: 'flow-open-welcome'});
  assert.equal(w.ok, false);
});
