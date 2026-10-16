/* BiliThrottle 观看周报: pure bookkeeping for the weekly watch report. Local only (chrome.storage.local
 * `watchStats`), written by the service worker alone; the report page and the content scripts only read.
 *  - days are local calendar dates "YYYY-MM-DD" (built with new Date(y, m, d + n), so DST never shifts a day);
 *  - weeks start on Monday 00:00 local time and are named after that Monday's date;
 *  - a video counts once per day after 10 s of real playback (the same rule as the quota).
 * Stored shape: {v:1, days:{"2026-10-12":{s,n,h:[24],up:{mid:[name,s]},b,ids?:[...],p?:{id:s}}}, brake:"tag", noticed:"weekKey"}
 */
(function (root) {
  'use strict';
  const defaults = Object.freeze({statsEnabled: true, statsWeeklyNotice: true});
  const WEEKS_KEPT = 10, MAX_UPS = 30, MAX_IDS = 400, MAX_PENDING = 20, COUNT_AFTER = 10, MAX_TICK = 30, DAY_MAX = 86400;
  const int = (v, lo, hi, d = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const pad = n => String(n).padStart(2, '0');
  const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

  const settings = (raw = {}) => ({statsEnabled: raw.statsEnabled !== false, statsWeeklyNotice: raw.statsWeeklyNotice !== false});
  const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const parse = key => { const m = KEY.exec(key || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const addDays = (key, n) => { const d = parse(key); return d ? dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()) : null; };
  /** Monday of the week containing ts (or a day key), as a day key. */
  function weekKey(at) {
    const d = typeof at === 'string' ? parse(at) : new Date(at);
    if (!d) return null;
    return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7).getTime());
  }
  const weekDays = wk => Array.from({length: 7}, (_, i) => addDays(wk, i));

  function cleanDay(raw, keepIds) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = {s: int(r.s, 0, DAY_MAX), n: int(r.n, 0, 5000), h: Array.from({length: 24}, (_, i) => int(Array.isArray(r.h) ? r.h[i] : 0, 0, 3600)), up: {}, b: int(r.b, 0, 1000)};
    const ups = Object.entries(r.up && typeof r.up === 'object' ? r.up : {})
      .filter(([mid, v]) => /^\d{1,20}$/.test(mid) && Array.isArray(v))
      .map(([mid, v]) => [mid, [String(v[0] || '').slice(0, 40), int(v[1], 0, DAY_MAX)]])
      .sort((a, b) => b[1][1] - a[1][1]).slice(0, MAX_UPS);
    for (const [mid, v] of ups) d.up[mid] = v;
    if (keepIds) {
      d.ids = Array.isArray(r.ids) ? r.ids.filter(x => typeof x === 'string').slice(-MAX_IDS) : [];
      d.p = {}; for (const [id, s] of Object.entries(r.p && typeof r.p === 'object' ? r.p : {}).slice(-MAX_PENDING)) d.p[id] = int(s, 0, DAY_MAX);
    }
    return d;
  }

  /** Normalise storage: drop days outside the last WEEKS_KEPT weeks (and future days), keep the
   * per-video lists only for today (older days only need their count). */
  function normalize(raw, now) {
    const r = raw && typeof raw === 'object' ? raw : {}, days = r.days && typeof r.days === 'object' ? r.days : {};
    const today = dayKey(now), oldest = addDays(weekKey(now), -7 * (WEEKS_KEPT - 1));
    const out = {v: 1, days: {}, brake: typeof r.brake === 'string' ? r.brake.slice(0, 60) : '', noticed: KEY.test(r.noticed || '') ? r.noticed : ''};
    for (const k of Object.keys(days).filter(k => KEY.test(k) && k >= oldest && k <= today).sort()) out.days[k] = cleanDay(days[k], k === today);
    return out;
  }

  const cleanUp = up => {
    const mid = String(up?.mid ?? '').replace(/\D/g, '').slice(0, 20), name = String(up?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return mid && name ? {mid, name} : null;
  };

  /** Record `seconds` of real playback at `now`, for video `id` by uploader `up` ({mid, name}, optional). */
  function tick(raw, now, seconds, id, up) {
    const st = normalize(raw, now), add = int(seconds, 0, MAX_TICK);
    if (!add) return st;
    const k = dayKey(now), d = st.days[k] || (st.days[k] = cleanDay(null, true));
    d.s = Math.min(DAY_MAX, d.s + add);
    const h = new Date(now).getHours(); d.h[h] = Math.min(3600, d.h[h] + add);
    if (id && typeof id === 'string' && !d.ids.includes(id)) {
      const total = (d.p[id] || 0) + add;
      if (total >= COUNT_AFTER) { delete d.p[id]; d.ids = [...d.ids, id].slice(-MAX_IDS); d.n++; }
      else { d.p[id] = total; const ks = Object.keys(d.p); if (ks.length > MAX_PENDING) delete d.p[ks[0]]; }
    }
    const u = cleanUp(up);
    if (u) {
      const prev = d.up[u.mid];
      if (prev) prev[0] = u.name, prev[1] = Math.min(DAY_MAX, prev[1] + add);
      else {
        const mids = Object.keys(d.up);
        if (mids.length >= MAX_UPS) { // Full: the newcomer replaces the smallest entry only once it has caught up.
          const low = mids.reduce((a, b) => d.up[a][1] <= d.up[b][1] ? a : b);
          if (d.up[low][1] <= add) { delete d.up[low]; d.up[u.mid] = [u.name, add]; }
        } else d.up[u.mid] = [u.name, add];
      }
    }
    return st;
  }

  /** Count one "踩刹车" (limit reached / Pomodoro break). `tag` identifies the event so several tabs, or
   * repeated checks of the same block, count it once. */
  function brake(raw, now, tag) {
    const st = normalize(raw, now);
    if (!tag || st.brake === tag) return st;
    const k = dayKey(now), d = st.days[k] || (st.days[k] = cleanDay(null, true));
    d.b++; st.brake = String(tag).slice(0, 60);
    return st;
  }
  /** Stable tag of a focus-core block, or '' for none. */
  const brakeTag = block => !block ? '' : `${block.kind}:${block.kind === 'break' ? block.until : block.resetAt}`;

  /** Everything the report shows for the week starting at Monday `wk`. `upto` (0–6) limits the totals
   * to the first days, for a fair "same span" comparison with a week still in progress. */
  function week(raw, wk, upto = 6) {
    const days = raw && raw.days || {}, keys = weekDays(wk);
    const out = {week: wk, days: [], seconds: 0, videos: 0, brakes: 0, hours: Array(24).fill(0), ups: [], longest: null, activeDays: 0};
    const ups = new Map();
    keys.forEach((k, i) => {
      const d = days[k] ? cleanDay(days[k]) : cleanDay(null);
      out.days.push({key: k, seconds: d.s, videos: d.n, brakes: d.b});
      if (i > upto) return;
      out.seconds += d.s; out.videos += d.n; out.brakes += d.b;
      if (d.s >= 60) out.activeDays++;
      d.h.forEach((v, h) => { out.hours[h] += v; });
      for (const [mid, [name, s]] of Object.entries(d.up)) { const u = ups.get(mid) || {mid, name, seconds: 0}; u.seconds += s; u.name = name || u.name; ups.set(mid, u); }
      if (d.s > 0 && (!out.longest || d.s > out.longest.seconds)) out.longest = {key: k, seconds: d.s};
    });
    out.ups = [...ups.values()].sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name)).slice(0, 5);
    out.peakHour = out.seconds ? out.hours.indexOf(Math.max(...out.hours)) : -1;
    return out;
  }
  const hasData = raw => Object.values(raw?.days || {}).some(d => Number(d?.s) > 0);

  /** Duration as people say it: "6 小时 40 分", "38 分钟", "不到 1 分钟". */
  function fmt(sec) {
    const m = Math.floor(Math.max(0, Number(sec) || 0) / 60);
    if (!m) return sec > 0 ? '不到 1 分钟' : '0 分钟';
    return m >= 60 ? `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分钟`;
  }
  /** "10月12日 – 10月18日" */
  function range(wk) {
    const a = parse(wk), b = parse(addDays(wk, 6));
    if (!a || !b) return '';
    return `${a.getMonth() + 1}月${a.getDate()}日 – ${b.getMonth() + 1}月${b.getDate()}日`;
  }
  const WEEKDAY = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  /** This week vs last week: {delta (s), pct (signed, rounded), mood: 'down'|'up'|'flat'|'first'|'none', text}. */
  function compare(cur, prev, same = false) {
    const a = cur.seconds, b = prev.seconds, delta = a - b, span = same ? '上周同期' : '上周';
    if (!a && !b) return {delta: 0, pct: 0, mood: 'none', text: '这周还没开始看，保持住 ✨'};
    if (!b) return {delta, pct: 0, mood: 'first', text: `${span}没有记录，这是第一份周报 📮`};
    const pct = Math.round(delta / b * 100);
    if (!a) return {delta, pct: -100, mood: 'down', text: `一分钟都没刷，刹车直接焊死了 🏆`};
    if (Math.abs(pct) < 5) return {delta, pct, mood: 'flat', text: `和${span}差不多，节奏很稳 👌`};
    if (delta < 0) return {delta, pct, mood: 'down', text: pct <= -50 ? `比${span}少了一半多，刹车踩得漂亮 🎉` : `比${span}少刷 ${fmt(-delta)}，节流成功 🎉`};
    if (pct <= 20) return {delta, pct, mood: 'up', text: `比${span}多了 ${pct}%，油门稍微松了点`};
    if (pct <= 100) return {delta, pct, mood: 'up', text: `比${span}多了 ${pct}%，刹车该踩了 🛑`};
    return {delta, pct, mood: 'up', text: `比${span}翻了 ${Math.round(a / b * 10) / 10} 倍，油门踩到底了 🛑`};
  }

  /** Once a week, on the first B 站 visit after the week rolls over: should the "上周报告出炉了" notice show?
   * Returns {show, seconds, week, next} where `next` is the storage to write (marks this week as noticed). */
  function notice(raw, now) {
    const st = normalize(raw, now), wk = weekKey(now);
    if (st.noticed === wk) return {show: false, next: null};
    const last = addDays(wk, -7), w = week(st, last);
    st.noticed = wk;
    return {show: w.seconds >= 60, seconds: w.seconds, week: last, next: st};
  }

  const api = Object.freeze({defaults, settings, dayKey, addDays, weekKey, weekDays, normalize, tick, brake, brakeTag, week, hasData,
    compare, notice, fmt, range, WEEKDAY, WEEKS_KEPT, MAX_UPS, MAX_IDS, COUNT_AFTER});
  root.__BTR_STATS_CORE__ = api;
  if (typeof module === 'object') module.exports = api;
})(globalThis);
