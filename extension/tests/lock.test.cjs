'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/lock-core.js');
const F = require('../src/focus-core.js');
const H = 3600000, now = 1_800_000_000_000;
const approved = F.settings({focusEnabled: true, focusWindowMinutes: 90, focusWeeklyHours: 10, focusWindowVideos: 0, focusSessionMinutes: 25, focusBreakMinutes: 5, focusStrict: false});
const base = () => ({v: 1, createdAt: now, cooldownHours: 24, salt: '', hash: '', iter: 1000, approved: {...approved}, pending: {}, fails: 0, lockoutUntil: 0, lastDeferredAt: 0});

test('looser rules: 0 means unlimited, breaks shorter and switches off are loosening', () => {
  assert.equal(L.looserKey('focusWindowMinutes', 90, 120), true);
  assert.equal(L.looserKey('focusWindowMinutes', 90, 0), true);
  assert.equal(L.looserKey('focusWindowMinutes', 0, 90), false);
  assert.equal(L.looserKey('focusWindowMinutes', 90, 45), false);
  assert.equal(L.looserKey('focusWindowVideos', 0, 5), false);
  assert.equal(L.looserKey('focusSessionMinutes', 25, 0), true);
  assert.equal(L.looserKey('focusBreakMinutes', 5, 3), true);
  assert.equal(L.looserKey('focusBreakMinutes', 5, 10), false);
  assert.equal(L.looserKey('focusEnabled', true, false), true);
  assert.equal(L.looserKey('focusStrict', false, true), false);
  assert.equal(L.looserKey('focusStrict', true, false), true);
});

test('tightening applies at once, loosening waits for the cool-down', () => {
  const r = L.request(base(), {focusWindowMinutes: 45, focusWeeklyHours: 20}, now, false);
  assert.deepEqual(r.applied, {focusWindowMinutes: 45});
  assert.equal(r.lock.approved.focusWindowMinutes, 45);
  assert.equal(r.lock.approved.focusWeeklyHours, 10);
  assert.equal(r.deferred.focusWeeklyHours, now + 24 * H);
  assert.equal(r.lock.pending.focusWeeklyHours.value, 20);
});

test('disabling limits while locked is deferred; the password makes it immediate', () => {
  const r = L.request(base(), {focusEnabled: false}, now, false);
  assert.equal(r.lock.approved.focusEnabled, true);
  assert.ok(r.lock.pending.focusEnabled);
  const r2 = L.request(r.lock, {focusEnabled: false}, now + H, true);
  assert.equal(r2.lock.approved.focusEnabled, false);
  assert.equal(r2.lock.pending.focusEnabled, undefined);
});

test('re-asking keeps the original countdown; asking for a new value restarts it', () => {
  const a = L.request(base(), {focusWindowMinutes: 120}, now, false).lock;
  const b = L.request(a, {focusWindowMinutes: 120}, now + 5 * H, false);
  assert.equal(b.lock.pending.focusWindowMinutes.effectiveAt, now + 24 * H);
  const c = L.request(b.lock, {focusWindowMinutes: 180}, now + 5 * H, false);
  assert.equal(c.lock.pending.focusWindowMinutes.effectiveAt, now + 29 * H);
});

test('a stricter change or going back to the approved value cancels pending loosening', () => {
  const a = L.request(base(), {focusWindowMinutes: 120}, now, false).lock;
  assert.equal(L.request(a, {focusWindowMinutes: 60}, now, false).lock.pending.focusWindowMinutes, undefined);
  assert.equal(L.request(a, {focusWindowMinutes: 90}, now, false).lock.pending.focusWindowMinutes, undefined);
});

test('settle applies only due changes, and removal ends the lock', () => {
  const a = L.request(base(), {focusWindowMinutes: 120}, now, false).lock;
  assert.equal(L.settle(a, now + 23 * H).changed, false);
  const s = L.settle(a, now + 24 * H);
  assert.equal(s.lock.approved.focusWindowMinutes, 120);
  assert.deepEqual(s.applied, {focusWindowMinutes: 120});
  const r = L.remove(base(), now, false);
  assert.ok(r.lock && r.lock.pending.remove);
  assert.equal(L.settle(r.lock, now + 24 * H).lock, null);
  assert.equal(L.remove(base(), now, true).lock, null);
});

test('cool-down: longer is immediate, shorter waits', () => {
  assert.equal(L.setCooldown(base(), 72, now, false).lock.cooldownHours, 72);
  const s = L.setCooldown(base(), 1, now, false);
  assert.equal(s.lock.cooldownHours, 24);
  assert.equal(s.deferredAt, now + 24 * H);
  assert.equal(L.settle(s.lock, now + 24 * H).lock.cooldownHours, 1);
});

test('password: salted PBKDF2 hash, verify, lock-out after repeated failures', async () => {
  const lock = await L.create(approved, {password: 'hunter22', cooldownHours: 6}, now);
  assert.ok(lock.hash && lock.salt && !JSON.stringify(lock).includes('hunter22'));
  assert.equal(L.view(lock).hash, undefined);
  assert.equal((await L.verify(lock, 'hunter22', now)).ok, true);
  let l = lock;
  for (let i = 0; i < L.MAX_FAILS; i++) l = (await L.verify(l, 'nope', now)).lock;
  assert.ok(l.lockoutUntil > now);
  const blocked = await L.verify(l, 'hunter22', now);
  assert.equal(blocked.ok, false);
  assert.equal((await L.verify(l, 'hunter22', l.lockoutUntil + 1)).ok, true);
  const other = await L.create(approved, {password: 'hunter22', cooldownHours: 6}, now);
  assert.notEqual(other.hash, lock.hash); // Different salt.
});

test('a lock without a password can only be loosened by waiting', async () => {
  const lock = await L.create(approved, {cooldownHours: 24}, now);
  assert.equal(L.hasPassword(lock), false);
  assert.equal((await L.verify(lock, 'anything', now)).ok, false);
});

test('normalize rejects junk and keeps known pending keys', () => {
  assert.equal(L.normalize(null), null);
  assert.equal(L.normalize({v: 2}), null);
  const n = L.normalize({...base(), cooldownHours: 5, pending: {focusEnabled: {value: false, effectiveAt: now}, evil: {value: 1, effectiveAt: now}}});
  assert.equal(n.cooldownHours, 24);
  assert.deepEqual(Object.keys(n.pending), ['focusEnabled']);
});
