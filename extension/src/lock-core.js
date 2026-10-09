/* BiliThrottle self-discipline lock — pure rules, shared by the service worker, pages and tests.
 *
 * While a lock is on, every change to the watch-limit settings is split in two:
 *  - tightening (lower limits, shorter sessions, enabling strict mode …) applies at once;
 *  - loosening (higher limits, 0 = unlimited, turning limits off …) waits for the cool-down,
 *    unless the lock password is given. Removing the lock is itself a loosening change.
 * "Forgot password" is simply the cool-down path; there is no instant bypass.
 * Only a salted PBKDF2-SHA-256 hash of the password is ever stored.
 */
(function (root) {
  'use strict';
  const KEYS = ['focusEnabled', 'focusWindowMinutes', 'focusWeeklyHours', 'focusWindowVideos', 'focusSessionMinutes', 'focusBreakMinutes', 'focusStrict'];
  const LIMIT_KEYS = new Set(['focusWindowMinutes', 'focusWeeklyHours', 'focusWindowVideos', 'focusSessionMinutes']); // 0 = unlimited / off
  const COOLDOWNS = [1, 6, 24, 72, 168];
  const DEFAULT_COOLDOWN = 24, ITERATIONS = 210000, MAX_FAILS = 5, LOCKOUT_MS = 5 * 60000, HOUR = 3600000;

  const limit = v => (Number(v) === 0 ? Infinity : Number(v));
  /** Is `next` looser than `prev` for one key? */
  function looserKey(key, prev, next) {
    if (prev === next) return false;
    if (key === 'focusEnabled' || key === 'focusStrict') return prev === true && next !== true;
    if (key === 'focusBreakMinutes') return Number(next) < Number(prev);
    if (LIMIT_KEYS.has(key)) return limit(next) > limit(prev);
    return false;
  }
  /** Split the changed keys of `candidate` (vs `approved`) into tightening and loosening sets. */
  function split(approved, candidate) {
    const tight = {}, loose = {};
    for (const k of KEYS) {
      if (!(k in candidate) || candidate[k] === approved[k]) continue;
      (looserKey(k, approved[k], candidate[k]) ? loose : tight)[k] = candidate[k];
    }
    return {tight, loose};
  }
  const clampCooldown = h => (COOLDOWNS.includes(Number(h)) ? Number(h) : DEFAULT_COOLDOWN);

  /** Normalise a stored lock record; null when there is no valid lock. */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || raw.v !== 1 || !raw.approved || typeof raw.approved !== 'object') return null;
    const pending = {};
    for (const [k, p] of Object.entries(raw.pending || {})) {
      if ((KEYS.includes(k) || k === 'cooldownHours' || k === 'remove') && p && Number.isFinite(p.effectiveAt)) pending[k] = {value: p.value, requestedAt: Number(p.requestedAt) || 0, effectiveAt: p.effectiveAt};
    }
    return {
      v: 1, createdAt: Number(raw.createdAt) || 0, cooldownHours: clampCooldown(raw.cooldownHours),
      salt: typeof raw.salt === 'string' ? raw.salt : '', hash: typeof raw.hash === 'string' ? raw.hash : '', iter: Number(raw.iter) || ITERATIONS,
      approved: {...raw.approved}, pending, fails: Number(raw.fails) || 0, lockoutUntil: Number(raw.lockoutUntil) || 0, lastDeferredAt: Number(raw.lastDeferredAt) || 0
    };
  }
  const hasPassword = lock => !!(lock && lock.hash && lock.salt);

  /**
   * Apply a change request to a lock. `authorized` = correct password given.
   * Returns {lock, applied, deferred} where `applied` are settings to write now and
   * `deferred` maps each postponed key to the time it takes effect.
   */
  function request(lockIn, changes, now, authorized) {
    const lock = {...lockIn, approved: {...lockIn.approved}, pending: {...lockIn.pending}};
    const candidate = {...lock.approved};
    for (const k of KEYS) if (k in changes) candidate[k] = changes[k];
    const {tight, loose} = split(lock.approved, candidate);
    const applied = {...tight}, deferred = {};
    for (const k of KEYS) if (k in changes && changes[k] === lock.approved[k]) delete lock.pending[k]; // Back to the approved value: cancel.
    for (const k of Object.keys(tight)) delete lock.pending[k]; // The newest, stricter intent wins.
    for (const [k, v] of Object.entries(loose)) {
      if (authorized) { applied[k] = v; delete lock.pending[k]; continue; }
      const old = lock.pending[k];
      // Re-asking for the same value keeps the original countdown; a new value starts a fresh one.
      const effectiveAt = old && old.value === v ? old.effectiveAt : now + lock.cooldownHours * HOUR;
      lock.pending[k] = {value: v, requestedAt: old && old.value === v ? old.requestedAt : now, effectiveAt};
      deferred[k] = effectiveAt;
    }
    Object.assign(lock.approved, applied);
    if (Object.keys(deferred).length) lock.lastDeferredAt = now;
    return {lock, applied, deferred};
  }

  /** Change the cool-down length: longer is immediate, shorter waits for the current cool-down. */
  function setCooldown(lockIn, hours, now, authorized) {
    const lock = {...lockIn, pending: {...lockIn.pending}}, h = clampCooldown(hours);
    if (h === lock.cooldownHours) { delete lock.pending.cooldownHours; return {lock, deferredAt: 0}; }
    if (h > lock.cooldownHours || authorized) { lock.cooldownHours = h; delete lock.pending.cooldownHours; return {lock, deferredAt: 0}; }
    const old = lock.pending.cooldownHours;
    const effectiveAt = old && old.value === h ? old.effectiveAt : now + lock.cooldownHours * HOUR;
    lock.pending.cooldownHours = {value: h, requestedAt: now, effectiveAt}; lock.lastDeferredAt = now;
    return {lock, deferredAt: effectiveAt};
  }

  /** Ask to remove the lock: immediate with the password, otherwise after the cool-down. */
  function remove(lockIn, now, authorized) {
    if (authorized) return {lock: null, deferredAt: 0};
    const lock = {...lockIn, pending: {...lockIn.pending}};
    const effectiveAt = lock.pending.remove?.effectiveAt || now + lock.cooldownHours * HOUR;
    lock.pending.remove = {value: true, requestedAt: lock.pending.remove?.requestedAt || now, effectiveAt};
    lock.lastDeferredAt = now;
    return {lock, deferredAt: effectiveAt};
  }

  function cancel(lockIn, key) {
    const lock = {...lockIn, pending: {...lockIn.pending}};
    if (key) delete lock.pending[key]; else lock.pending = {};
    return lock;
  }

  /** Apply every pending change whose time has come. Returns {lock|null, applied, changed}. */
  function settle(lockIn, now) {
    if (!lockIn) return {lock: null, applied: {}, changed: false};
    const lock = {...lockIn, approved: {...lockIn.approved}, pending: {...lockIn.pending}}, applied = {};
    let changed = false;
    if (lock.pending.remove && lock.pending.remove.effectiveAt <= now) return {lock: null, applied, changed: true, removed: true};
    for (const [k, p] of Object.entries(lock.pending)) {
      if (p.effectiveAt > now || k === 'remove') continue;
      if (k === 'cooldownHours') lock.cooldownHours = clampCooldown(p.value);
      else { lock.approved[k] = p.value; applied[k] = p.value; }
      delete lock.pending[k]; changed = true;
    }
    return {lock, applied, changed};
  }

  /* ---------- password ---------- */
  const b64 = buf => { let s = ''; for (const x of new Uint8Array(buf)) s += String.fromCharCode(x); return btoa(s); };
  const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
  function makeSalt() { const a = new Uint8Array(16); crypto.getRandomValues(a); return b64(a); }
  async function hash(password, salt, iter = ITERATIONS) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: iter}, key, 256);
    return b64(bits);
  }
  /** Constant-time compare of two base64 strings. */
  function same(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  }
  /** Check a password, with a growing lock-out after repeated failures. Returns {ok, lock, error}. */
  async function verify(lockIn, password, now) {
    const lock = {...lockIn};
    if (!hasPassword(lock)) return {ok: false, lock, error: '这个自律锁没有设置密码，只能等待冷却期。'};
    if (lock.lockoutUntil > now) return {ok: false, lock, error: `密码错误次数过多，请 ${Math.ceil((lock.lockoutUntil - now) / 60000)} 分钟后再试。`};
    if (typeof password !== 'string' || !password) return {ok: false, lock, error: '请输入自律锁密码。'};
    const ok = same(await hash(password, lock.salt, lock.iter), lock.hash);
    if (ok) { lock.fails = 0; lock.lockoutUntil = 0; return {ok, lock}; }
    lock.fails = (lock.fails || 0) + 1;
    if (lock.fails >= MAX_FAILS) { lock.lockoutUntil = now + LOCKOUT_MS * 2 ** Math.min(4, lock.fails - MAX_FAILS); }
    return {ok: false, lock, error: lock.lockoutUntil > now ? '密码错误次数过多，已暂时锁定输入。' : `密码不对（还可以再试 ${Math.max(0, MAX_FAILS - lock.fails)} 次）。`};
  }

  /** A fresh lock record (password optional; without one only the cool-down can loosen limits). */
  async function create(approved, {password, cooldownHours}, now) {
    const lock = {v: 1, createdAt: now, cooldownHours: clampCooldown(cooldownHours), salt: '', hash: '', iter: ITERATIONS,
      approved: {...approved}, pending: {}, fails: 0, lockoutUntil: 0, lastDeferredAt: 0};
    if (password) { lock.salt = makeSalt(); lock.hash = await hash(password, lock.salt, lock.iter); }
    return lock;
  }
  async function setPassword(lockIn, password) {
    const lock = {...lockIn};
    if (password) { lock.salt = makeSalt(); lock.hash = await hash(password, lock.salt, lock.iter); } else { lock.salt = ''; lock.hash = ''; }
    lock.fails = 0; lock.lockoutUntil = 0;
    return lock;
  }

  /** Public view for UIs: never includes the hash or salt. */
  function view(lock, now = Date.now()) {
    if (!lock) return {locked: false};
    return {locked: true, hasPassword: hasPassword(lock), cooldownHours: lock.cooldownHours, createdAt: lock.createdAt,
      approved: {...lock.approved}, pending: JSON.parse(JSON.stringify(lock.pending)), lockoutUntil: lock.lockoutUntil > now ? lock.lockoutUntil : 0,
      lastDeferredAt: lock.lastDeferredAt};
  }

  const LABELS = {focusEnabled: '观看额度开关', focusWindowMinutes: '每 5 小时可看时长', focusWeeklyHours: '每周可看时长', focusWindowVideos: '每 5 小时视频数',
    focusSessionMinutes: '番茄钟时长', focusBreakMinutes: '休息时长', focusStrict: '严格模式', cooldownHours: '冷却期', remove: '解除自律锁'};
  function describe(key, value) {
    const label = LABELS[key] || key;
    if (key === 'remove') return label;
    if (key === 'focusEnabled') return value ? '开启观看额度' : '关闭观看额度';
    if (key === 'focusStrict') return value ? '开启严格模式' : '关闭严格模式';
    if (key === 'cooldownHours') return `冷却期改为 ${value} 小时`;
    const unit = {focusWindowMinutes: ' 分钟', focusWeeklyHours: ' 小时', focusWindowVideos: ' 个', focusSessionMinutes: ' 分钟', focusBreakMinutes: ' 分钟'}[key] || '';
    return `${label}改为 ${Number(value) === 0 && LIMIT_KEYS.has(key) ? '不限' : value + unit}`;
  }

  const api = Object.freeze({KEYS, COOLDOWNS, DEFAULT_COOLDOWN, ITERATIONS, MAX_FAILS, looserKey, split, normalize, hasPassword, request, setCooldown,
    remove, cancel, settle, makeSalt, hash, same, verify, create, setPassword, view, describe, LABELS});
  root.__BTR_LOCK_CORE__ = api;
  if (typeof module === 'object') module.exports = api;
})(globalThis);
