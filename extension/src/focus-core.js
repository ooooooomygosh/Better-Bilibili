/* BiliThrottle focus mode: pure state machine for usage limits, modelled on Claude Code / Codex:
 *  - a rolling 5-hour window that starts with the first watched second and resets 5 hours later;
 *  - a weekly allowance that starts with the first watched second and resets 7 days later;
 *  - optional Pomodoro breaks inside a continuous session.
 * Shared by the service worker (single writer), the page overlay, popup and options page.
 */
(function (root) {
  'use strict';
  const WINDOW_MS = 5 * 3600000, WEEK_MS = 7 * 86400000;
  const defaults = Object.freeze({
    focusEnabled: false,      // Off by default: never surprise an upgrading user.
    focusWindowMinutes: 90,   // Watch time allowed per 5-hour window; 0 = unlimited.
    focusWindowVideos: 0,     // Videos allowed per 5-hour window; 0 = unlimited.
    focusWeeklyHours: 10,     // Watch time allowed per 7-day period; 0 = unlimited.
    focusSessionMinutes: 25,  // Continuous watching before a break; 0 = no break reminders.
    focusBreakMinutes: 5,
    focusStrict: false        // Strict: no "5 more minutes" / skip-break buttons.
  });
  const SNOOZE_SECONDS = 300, COUNT_AFTER = 10, MAX_TICK = 30, MAX_VIDEOS = 500, MAX_PENDING = 20;
  const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

  function settings(raw = {}) {
    return {
      focusEnabled: raw.focusEnabled === true,
      focusWindowMinutes: int(raw.focusWindowMinutes, 0, 300, defaults.focusWindowMinutes),
      focusWindowVideos: int(raw.focusWindowVideos, 0, 500, defaults.focusWindowVideos),
      focusWeeklyHours: int(raw.focusWeeklyHours, 0, 168, defaults.focusWeeklyHours),
      focusSessionMinutes: int(raw.focusSessionMinutes, 0, 240, defaults.focusSessionMinutes),
      focusBreakMinutes: int(raw.focusBreakMinutes, 1, 120, defaults.focusBreakMinutes),
      focusStrict: raw.focusStrict === true
    };
  }

  const freshWindow = () => ({start: 0, seconds: 0, videos: [], pending: {}, extraSeconds: 0, extraVideos: 0});
  const freshWeek = () => ({start: 0, seconds: 0, extraSeconds: 0});

  // Normalise whatever is in storage and roll over any period whose reset time has passed.
  function usage(raw, now) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const w = r.window && typeof r.window === 'object' ? r.window : {}, k = r.week && typeof r.week === 'object' ? r.week : {};
    const u = {window: freshWindow(), week: freshWeek(), snoozes: int(r.snoozes, 0, 1000, 0),
      sessionSeconds: int(r.sessionSeconds, 0, 86400, 0), lastTickAt: Number(r.lastTickAt) || 0, breakUntil: Number(r.breakUntil) || 0};
    const start = (s, span) => { const n = Number(s) || 0; return n > 0 && n <= now + 60000 && now < n + span ? n : 0; };
    u.window.start = start(w.start, WINDOW_MS);
    if (u.window.start) {
      u.window.seconds = int(w.seconds, 0, WINDOW_MS / 1000, 0);
      u.window.videos = Array.isArray(w.videos) ? w.videos.filter(v => typeof v === 'string').slice(-MAX_VIDEOS) : [];
      for (const [id, s] of Object.entries(w.pending || {}).slice(-MAX_PENDING)) u.window.pending[id] = int(s, 0, 86400, 0);
      u.window.extraSeconds = int(w.extraSeconds, 0, 86400, 0);
      u.window.extraVideos = int(w.extraVideos, 0, 500, 0);
    } else u.snoozes = 0; // Snooze count belongs to a window.
    u.week.start = start(k.start, WEEK_MS);
    if (u.week.start) {
      u.week.seconds = int(k.seconds, 0, WEEK_MS / 1000, 0);
      u.week.extraSeconds = int(k.extraSeconds, 0, WEEK_MS / 1000, 0);
    }
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
    const u = settleSession(usage(raw, now), now, s);
    const add = int(seconds, 0, MAX_TICK, 0);
    if (!add || u.breakUntil > now) return u;
    // Like Claude Code: a period starts with the first use after the previous one ran out.
    if (!u.window.start) u.window.start = now - add * 1000;
    if (!u.week.start) u.week.start = now - add * 1000;
    u.window.seconds += add; u.week.seconds += add;
    u.sessionSeconds += add; u.lastTickAt = now;
    const w = u.window;
    if (id && !w.videos.includes(id)) {
      const total = (w.pending[id] || 0) + add;
      if (total >= COUNT_AFTER) { delete w.pending[id]; w.videos = [...w.videos, id].slice(-MAX_VIDEOS); }
      else {
        w.pending[id] = total;
        const keys = Object.keys(w.pending);
        if (keys.length > MAX_PENDING) delete w.pending[keys[0]];
      }
    }
    if (s.focusSessionMinutes && u.sessionSeconds >= s.focusSessionMinutes * 60) u.breakUntil = now + s.focusBreakMinutes * 60000;
    return u;
  }

  function meter(seconds, limit, start, span) {
    return {seconds, limit, resetAt: start ? start + span : 0, percent: limit ? Math.min(100, Math.round(seconds / limit * 100)) : 0,
      remaining: limit ? Math.max(0, limit - seconds) : null};
  }

  function evaluate(u, now, s, id) {
    const window = meter(u.window.seconds, s.focusWindowMinutes ? s.focusWindowMinutes * 60 + u.window.extraSeconds : 0, u.window.start, WINDOW_MS);
    const week = meter(u.week.seconds, s.focusWeeklyHours ? s.focusWeeklyHours * 3600 + u.week.extraSeconds : 0, u.week.start, WEEK_MS);
    const videoLimit = s.focusWindowVideos ? s.focusWindowVideos + u.window.extraVideos : 0;
    const remaining = [window.remaining, week.remaining].filter(v => v != null);
    const info = {window, week, videos: u.window.videos.length, videoLimit, snoozes: u.snoozes, sessionSeconds: u.sessionSeconds,
      remaining: remaining.length ? Math.min(...remaining) : null};
    if (!s.focusEnabled) return {block: null, ...info};
    let block = null;
    if (week.limit && week.seconds >= week.limit) block = {kind: 'week', resetAt: week.resetAt};
    else if (window.limit && window.seconds >= window.limit) block = {kind: 'window', resetAt: window.resetAt};
    else if (videoLimit && info.videos >= videoLimit && !(id && u.window.videos.includes(id))) block = {kind: 'videos', resetAt: window.resetAt};
    else if (u.breakUntil > now) block = {kind: 'break', until: u.breakUntil};
    return {block, ...info};
  }

  // "Snooze" in reminder mode: a little more time or one more video, or skipping a break.
  function snooze(raw, now, s, kind) {
    const u = settleSession(usage(raw, now), now, s);
    if (s.focusStrict) return u;
    if (kind === 'window' && u.window.start) {
      u.window.extraSeconds = Math.max(u.window.extraSeconds, u.window.seconds - s.focusWindowMinutes * 60) + SNOOZE_SECONDS; u.snoozes++;
    } else if (kind === 'week' && u.week.start) {
      u.week.extraSeconds = Math.max(u.week.extraSeconds, u.week.seconds - s.focusWeeklyHours * 3600) + SNOOZE_SECONDS; u.snoozes++;
    } else if (kind === 'videos' && u.window.start) {
      u.window.extraVideos = Math.max(u.window.extraVideos, u.window.videos.length - s.focusWindowVideos) + 1; u.snoozes++;
    } else if (kind === 'break') { u.breakUntil = 0; u.sessionSeconds = 0; u.snoozes++; }
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
  // "15:20" today, "明天 09:05", otherwise "10月14日 周二 21:00" — the way Claude Code prints its reset time.
  function fmtReset(at, now = Date.now()) {
    if (!at) return '开始观看后计时';
    const d = new Date(at), n = new Date(now), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(d) - day(n)) / 86400000);
    if (diff === 0) return `今天 ${hm}`;
    if (diff === 1) return `明天 ${hm}`;
    return `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]} ${hm}`;
  }
  function fmtLeft(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    if (h >= 24) return `${Math.floor(h / 24)} 天 ${h % 24} 小时`;
    return h ? `${h} 小时 ${m} 分` : `${Math.max(1, m)} 分钟`;
  }

  const api = Object.freeze({defaults, settings, usage, tick, evaluate, snooze, videoId, fmt, fmtReset, fmtLeft,
    WINDOW_MS, WEEK_MS, SNOOZE_SECONDS, COUNT_AFTER});
  root.__BTR_FOCUS_CORE__ = api;
  if (typeof module === 'object') module.exports = api;
})(globalThis);
