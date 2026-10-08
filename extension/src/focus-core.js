/* BTR Flow focus mode: pure state machine for daily watch limits and Pomodoro-style breaks.
 * Shared by the service worker (single writer), the page overlay, popup and options page.
 */
(function (root) {
  'use strict';
  const defaults = Object.freeze({
    focusEnabled: false,      // Off by default: never surprise an upgrading user.
    focusDailyMinutes: 90,    // 0 = no daily time limit.
    focusDailyVideos: 0,      // 0 = no daily video-count limit.
    focusSessionMinutes: 25,  // Continuous watching before a break; 0 = no break reminders.
    focusBreakMinutes: 5,
    focusStrict: false,       // Strict: no snooze / skip buttons.
    focusResetHour: 4         // A "day" starts at this local hour, so late-night watching counts for the evening.
  });
  const SNOOZE_SECONDS = 300, COUNT_AFTER = 10, MAX_TICK = 30, MAX_VIDEOS = 500, MAX_PENDING = 20;
  const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

  function settings(raw = {}) {
    return {
      focusEnabled: raw.focusEnabled === true,
      focusDailyMinutes: int(raw.focusDailyMinutes, 0, 1440, defaults.focusDailyMinutes),
      focusDailyVideos: int(raw.focusDailyVideos, 0, 500, defaults.focusDailyVideos),
      focusSessionMinutes: int(raw.focusSessionMinutes, 0, 240, defaults.focusSessionMinutes),
      focusBreakMinutes: int(raw.focusBreakMinutes, 1, 120, defaults.focusBreakMinutes),
      focusStrict: raw.focusStrict === true,
      focusResetHour: int(raw.focusResetHour, 0, 12, defaults.focusResetHour)
    };
  }

  function dayKey(now, resetHour = defaults.focusResetHour) {
    const d = new Date(now - resetHour * 3600000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function fresh(day) {
    return {day, seconds: 0, videos: [], pending: {}, extraSeconds: 0, extraVideos: 0, snoozes: 0,
      sessionSeconds: 0, lastTickAt: 0, breakUntil: 0};
  }

  // Normalise whatever is in storage; a new day starts from zero.
  function usage(raw, now, s) {
    const day = dayKey(now, s.focusResetHour);
    if (!raw || typeof raw !== 'object' || raw.day !== day) return fresh(day);
    const u = fresh(day);
    u.seconds = int(raw.seconds, 0, 86400, 0);
    u.videos = Array.isArray(raw.videos) ? raw.videos.filter(v => typeof v === 'string').slice(-MAX_VIDEOS) : [];
    for (const [k, v] of Object.entries(raw.pending || {}).slice(-MAX_PENDING)) u.pending[k] = int(v, 0, 86400, 0);
    u.extraSeconds = int(raw.extraSeconds, 0, 86400, 0);
    u.extraVideos = int(raw.extraVideos, 0, 500, 0);
    u.snoozes = int(raw.snoozes, 0, 1000, 0);
    u.sessionSeconds = int(raw.sessionSeconds, 0, 86400, 0);
    u.lastTickAt = Number(raw.lastTickAt) || 0;
    u.breakUntil = Number(raw.breakUntil) || 0;
    if (u.breakUntil > now + 121 * 60000) u.breakUntil = 0; // Clock moved backwards or corrupt data.
    return u;
  }

  // Leave the break / idle states that time alone resolves.
  function settleSession(u, now, s) {
    if (u.breakUntil && u.breakUntil <= now) { u.breakUntil = 0; u.sessionSeconds = 0; }
    if (!u.breakUntil && u.lastTickAt && now - u.lastTickAt >= s.focusBreakMinutes * 60000) u.sessionSeconds = 0;
    return u;
  }

  function tick(raw, now, s, seconds, id) {
    const u = settleSession(usage(raw, now, s), now, s);
    const add = int(seconds, 0, MAX_TICK, 0);
    if (!add || u.breakUntil > now) return u;
    u.seconds = Math.min(86400, u.seconds + add);
    u.sessionSeconds += add;
    u.lastTickAt = now;
    if (id && !u.videos.includes(id)) {
      const total = (u.pending[id] || 0) + add;
      if (total >= COUNT_AFTER) { delete u.pending[id]; u.videos = [...u.videos, id].slice(-MAX_VIDEOS); }
      else {
        u.pending[id] = total;
        const keys = Object.keys(u.pending);
        if (keys.length > MAX_PENDING) delete u.pending[keys[0]];
      }
    }
    if (s.focusSessionMinutes && u.sessionSeconds >= s.focusSessionMinutes * 60) u.breakUntil = now + s.focusBreakMinutes * 60000;
    return u;
  }

  function evaluate(u, now, s, id) {
    const timeLimit = s.focusDailyMinutes ? s.focusDailyMinutes * 60 + u.extraSeconds : 0;
    const videoLimit = s.focusDailyVideos ? s.focusDailyVideos + u.extraVideos : 0;
    const info = {seconds: u.seconds, timeLimit, videos: u.videos.length, videoLimit, snoozes: u.snoozes,
      sessionSeconds: u.sessionSeconds, remaining: timeLimit ? Math.max(0, timeLimit - u.seconds) : null};
    if (!s.focusEnabled) return {block: null, ...info};
    let block = null;
    if (timeLimit && u.seconds >= timeLimit) block = {kind: 'time'};
    else if (videoLimit && u.videos.length >= videoLimit && !(id && u.videos.includes(id))) block = {kind: 'videos'};
    else if (u.breakUntil > now) block = {kind: 'break', until: u.breakUntil};
    return {block, ...info};
  }

  // "Snooze" in reminder mode: a little more time or one more video, and skipping a break.
  function snooze(raw, now, s, kind) {
    const u = settleSession(usage(raw, now, s), now, s);
    if (s.focusStrict) return u;
    if (kind === 'time') { u.extraSeconds = Math.max(u.extraSeconds, u.seconds - s.focusDailyMinutes * 60) + SNOOZE_SECONDS; u.snoozes++; }
    else if (kind === 'videos') { u.extraVideos = Math.max(u.extraVideos, u.videos.length - s.focusDailyVideos) + 1; u.snoozes++; }
    else if (kind === 'break') { u.breakUntil = 0; u.sessionSeconds = 0; u.snoozes++; }
    return u;
  }

  function videoId(loc) {
    try {
      const url = new URL(String(loc));
      if (url.hostname === 'live.bilibili.com') { const m = url.pathname.match(/^\/(?:blanc\/)?(\d+)/); return m ? 'live' + m[1] : null; }
      let m = url.pathname.match(/\/video\/(BV\w{10}|av\d+)/i);
      if (m) return m[1];
      m = url.pathname.match(/\/bangumi\/play\/(ep\d+|ss\d+)/i) || url.pathname.match(/\/cheese\/play\/(ep\d+|ss\d+)/i);
      if (m) return m[1];
      if (/^\/(?:list|medialist|festival)\//.test(url.pathname)) return url.searchParams.get('bvid') || url.searchParams.get('oid') || url.pathname;
    } catch (_) {}
    return null;
  }

  const fmt = sec => { const m = Math.floor(sec / 60); return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`; };

  const api = Object.freeze({defaults, settings, dayKey, usage, tick, evaluate, snooze, videoId, fmt, SNOOZE_SECONDS, COUNT_AFTER});
  root.__BTR_FOCUS_CORE__ = api;
  if (typeof module === 'object') module.exports = api;
})(globalThis);
