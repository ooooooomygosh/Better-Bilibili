/* BiliThrottle adaptive request controller — pure, no DOM, shared by the homepage feed and its tests.
 * Decides how hard we may ask B 站 for recommendations right now:
 *  - retry: exponential backoff with jitter for transient failures (network, timeout, 5xx, empty answers);
 *    risk-control answers (HTTP 412 / 429, code -352 / -412 / -509 / -799) are never retried in a loop.
 *  - AIMD: concurrency (lanes), requests per round (batch) and the gap between rounds grow slowly while
 *    requests succeed and are cut sharply on failure, the way TCP treats congestion.
 *  - circuit breaker: risk control or a run of failures opens it; nothing is sent until the cooldown is over,
 *    then one probe request (half-open) decides whether to close it again. Cooldowns escalate.
 *  - state is a small plain object, persisted by the caller across page loads and decayed when stale.
 */
(function (root) {
  'use strict';
  const RISK_CODES = Object.freeze([-352, -412, -401, -509, -799]);
  const DEFAULTS = Object.freeze({
    minLanes: 1, maxLanes: 3, startLanes: 2,
    minBatch: 1, maxBatch: 3, startBatch: 2,
    minGap: 700, maxGap: 30000, startGap: 700,
    increaseEvery: 3,           // successes needed for one additive step
    gapDecay: 0.8,              // multiplicative gap shrink per step on success
    retries: 2,                 // extra attempts for a transient failure
    backoffBase: 800, backoffCap: 8000,
    tripAfter: 3,               // consecutive transient failures that open the breaker
    cooldown: 30000, cooldownCap: 600000, // first breaker cooldown, doubled per trip, capped at 10 min
    staleAfter: 1800000         // persisted state older than 30 min starts fresh (breaker excepted)
  });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /** What kind of failure an error / API answer is: 'risk' | 'transient' | 'fatal'. */
  function classify(e) {
    if (!e) return 'transient';
    if (e.kind === 'risk' || e.kind === 'transient' || e.kind === 'fatal') return e.kind;
    const status = Number(e.status), code = Number(e.code);
    if (status === 412 || status === 429 || RISK_CODES.includes(code)) return 'risk';
    if (e.name === 'AbortError' || e.name === 'TimeoutError' || e.name === 'TypeError' || status >= 500 || e.kind === 'empty' || e.kind === 'bad' || e.kind === 'error') return 'transient';
    if (status >= 400) return 'fatal';
    return 'transient';
  }

  /** Delay before retry number `attempt` (0-based): exponential, capped, "equal jitter" (half fixed, half random). */
  function backoff(attempt, o = DEFAULTS, rnd = Math.random) {
    const d = Math.min(o.backoffCap, o.backoffBase * 2 ** Math.max(0, attempt));
    return Math.round(d / 2 + rnd() * d / 2);
  }

  /** Seconds from a Retry-After header (delta seconds or HTTP date), as ms; 0 when absent / bad. */
  function retryAfter(value, now = Date.now()) {
    if (value == null || value === '') return 0;
    const n = Number(value);
    if (Number.isFinite(n)) return clamp(n * 1000, 0, 3600000);
    const t = Date.parse(value);
    return Number.isFinite(t) ? clamp(t - now, 0, 3600000) : 0;
  }

  function create(saved, opts = {}, now = Date.now()) {
    const o = {...DEFAULTS, ...opts};
    const fresh = () => ({lanes: o.startLanes, batch: o.startBatch, gap: o.startGap, ok: 0, fails: 0, trips: 0, openUntil: 0, halfOpen: false, at: now});
    let s = fresh();
    if (saved && typeof saved === 'object') {
      const num = (v, lo, hi, d) => Number.isFinite(Number(v)) ? clamp(Number(v), lo, hi) : d;
      const stale = !(Number(saved.at) > 0) || now - Number(saved.at) > o.staleAfter;
      if (!stale) {
        s.lanes = num(saved.lanes, o.minLanes, o.maxLanes, s.lanes);
        s.batch = num(saved.batch, o.minBatch, o.maxBatch, s.batch);
        s.gap = num(saved.gap, o.minGap, o.maxGap, s.gap);
        s.trips = num(saved.trips, 0, 20, 0);
      }
      // A cooldown B 站 asked for survives a reload: reloading must not be a way around risk control.
      const until = Number(saved.openUntil) || 0;
      if (until > now && until - now <= o.cooldownCap + 60000) { s.openUntil = until; s.trips = Math.max(1, num(saved.trips, 0, 20, 1)); }
      else if (until && until <= now) s.halfOpen = true; // cooldown passed while away: probe once first
    }
    const touch = t => { s.at = t; };

    const api = {
      options: o,
      /** 'closed' | 'open' | 'half-open' */
      state(t = Date.now()) { return s.openUntil > t ? 'open' : s.halfOpen || s.openUntil ? 'half-open' : 'closed'; },
      remaining(t = Date.now()) { return Math.max(0, s.openUntil - t); },
      /** How to run the next round, capped by what the user allows (their 线程 setting / batch size). */
      plan(maxLanes = o.maxLanes, wantRequests = o.maxBatch, t = Date.now()) {
        const st = api.state(t);
        if (st === 'open') return {allowed: false, wait: s.openUntil - t, lanes: 0, requests: 0, gap: s.gap};
        if (st === 'half-open') return {allowed: true, probe: true, wait: 0, lanes: 1, requests: 1, gap: s.gap};
        const lanes = clamp(Math.floor(s.lanes), o.minLanes, Math.max(o.minLanes, Math.min(o.maxLanes, maxLanes)));
        const requests = clamp(Math.floor(s.batch), 1, Math.max(1, wantRequests));
        return {allowed: true, probe: false, wait: 0, lanes, requests: Math.max(requests, 1), gap: Math.round(s.gap)};
      },
      shouldRetry(kind, attempt) { return kind === 'transient' && attempt < o.retries && api.state() !== 'open'; },
      backoff: (attempt, rnd) => backoff(attempt, o, rnd),
      /** Additive increase. */
      success(t = Date.now()) {
        s.fails = 0;
        if (s.openUntil || s.halfOpen) { s.openUntil = 0; s.halfOpen = false; s.trips = Math.max(0, s.trips - 1); s.lanes = o.minLanes; s.batch = o.minBatch; s.ok = 0; }
        if (++s.ok >= o.increaseEvery) {
          s.ok = 0;
          s.lanes = Math.min(o.maxLanes, s.lanes + 1);
          s.batch = Math.min(o.maxBatch, s.batch + 1);
          s.gap = Math.max(o.minGap, s.gap * o.gapDecay);
        }
        touch(t);
      },
      /** Multiplicative decrease; risk control (or tripAfter transient failures in a row) opens the breaker. */
      failure(kind, t = Date.now(), wait = 0) {
        s.ok = 0;
        s.lanes = Math.max(o.minLanes, Math.floor(s.lanes / 2));
        s.batch = Math.max(o.minBatch, Math.floor(s.batch / 2));
        s.gap = Math.min(o.maxGap, s.gap * 2);
        if (kind === 'fatal') { touch(t); return; }
        s.fails++;
        const probing = s.halfOpen || (s.openUntil && s.openUntil <= t);
        if (kind === 'risk' || probing || s.fails >= o.tripAfter) {
          const cd = Math.max(wait || 0, Math.min(o.cooldownCap, o.cooldown * 2 ** s.trips));
          s.trips = Math.min(20, s.trips + 1); s.openUntil = t + cd; s.halfOpen = false; s.fails = 0;
          s.lanes = o.minLanes; s.batch = o.minBatch;
        }
        touch(t);
      },
      /** The user pressed 重试: skip the rest of the cooldown, but only as a single probe. */
      force(t = Date.now()) { if (s.openUntil > t || s.openUntil) { s.openUntil = 0; s.halfOpen = true; } touch(t); },
      reset(t = Date.now()) { s = fresh(); touch(t); },
      snapshot() { return {lanes: s.lanes, batch: s.batch, gap: Math.round(s.gap), trips: s.trips, openUntil: s.openUntil, at: s.at}; },
      get raw() { return {...s}; }
    };
    return api;
  }

  /** Run `fn(attempt)` with the controller's retry policy. `sleep` is injectable for tests. */
  async function withRetry(ctrl, fn, sleep = ms => new Promise(r => setTimeout(r, ms))) {
    for (let attempt = 0; ; attempt++) {
      try { return await fn(attempt); }
      catch (e) {
        const kind = classify(e); e.kind = e.kind && ['risk', 'transient', 'fatal'].includes(e.kind) ? e.kind : kind; e.attempts = attempt + 1;
        if (!ctrl.shouldRetry(kind, attempt)) throw e;
        await sleep(ctrl.backoff(attempt));
      }
    }
  }

  const api = Object.freeze({DEFAULTS, RISK_CODES, classify, backoff, retryAfter, create, withRetry});
  root.__BTR_ADAPTIVE__ = api;
  if (typeof module === 'object') module.exports = api;
})(globalThis);
