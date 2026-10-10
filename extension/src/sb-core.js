/* BiliThrottle 空降助手 core — segment lookup, filtering and skip decisions.
 *
 * Ported to plain JS from BilibiliSponsorBlock (https://github.com/hanydd/BilibiliSponsorBlock),
 * Copyright (C) hanydd and BilibiliSponsorBlock contributors, which is itself a port of
 * SponsorBlock (https://github.com/ajayyy/SponsorBlock), Copyright (C) Ajay Ramachandran and contributors.
 * Sources: src/requests/background/segmentRequest.ts, src/utils/hash.ts, src/config.ts (categories,
 * default skip options, bar colours), src/content/skipScheduler.ts (skip timing).
 *
 * This file is part of BiliThrottle and is licensed under the GNU General Public License v3.0
 * or later; see LICENSE and THIRD_PARTY_NOTICES.md.
 */
(function (root) {
  'use strict';
  if (root.__BTR_SB_CORE__) return;

  const SERVER = 'https://www.bsbsb.top';
  // name, Chinese label (from their zh_CN locale), bar colour, default option (their defaults).
  const CATEGORIES = [
    ['sponsor', '赞助/恰饭', '#00d400', 'auto'],
    ['selfpromo', '无偿/自我推广', '#ffff00', 'manual'],
    ['exclusive_access', '独家访问/抢先体验', '#008a5c', 'show'],
    ['interaction', '三连/互动提醒', '#cc00ff', 'manual'],
    ['poi_highlight', '精彩时刻/重点', '#ff1684', 'manual'],
    ['intro', '过场/开场动画', '#00ffff', 'manual'],
    ['outro', '鸣谢/结束画面', '#0202ed', 'manual'],
    ['preview', '回顾/概要', '#008fd6', 'show'],
    ['padding', '填充内容/前黑/后黑', '#222222', 'auto'],
    ['filler', '离题闲聊/玩笑', '#7300ff', 'off'],
    ['music_offtopic', '音乐:非音乐部分', '#ff9900', 'auto']
  ].map(([name, label, color, def]) => Object.freeze({name, label, color, def}));
  const BY_NAME = Object.fromEntries(CATEGORIES.map(c => [c.name, c]));
  const OPTIONS = ['auto', 'manual', 'show', 'off'];
  const OPTION_LABEL = {auto: '自动跳过', manual: '手动跳过', show: '仅显示', off: '关闭'};
  const key = name => `sbCat_${name}`;

  const defaults = Object.freeze({
    sbEnabled: true, sbShowBar: true, sbMute: true, sbToastSeconds: 4, sbMinDuration: 0,
    ...Object.fromEntries(CATEGORIES.map(c => [key(c.name), c.def]))
  });

  function settings(raw = {}) {
    const o = {};
    for (const [k, v] of Object.entries(defaults)) {
      const x = raw[k];
      if (typeof v === 'boolean') o[k] = typeof x === 'boolean' ? x : v;
      else if (typeof v === 'number') { const n = Number(x); o[k] = Number.isFinite(n) && n >= 0 && n <= 60 ? n : v; }
      else o[k] = OPTIONS.includes(x) ? x : v;
    }
    return o;
  }
  const optionFor = (s, cat) => (s[key(cat)] || BY_NAME[cat]?.def || 'off');

  /** SHA-256 hex, as in their getHash(value, 1). */
  async function sha256(text) {
    const buf = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  }
  /** k-anonymity lookup: only the first 4 hex chars of sha256(BV) leave the browser. */
  async function hashPrefix(bvid) { return (await sha256(bvid)).slice(0, 4); }

  const BV = /\b(BV1[0-9A-Za-z]{9})\b/;
  function parseBvid(url) {
    try { const u = new URL(url); const m = u.pathname.match(BV) || (u.searchParams.get('bvid') || '').match(BV); return m ? m[1] : null; }
    catch (_) { return null; }
  }
  function parsePage(url) { try { const p = Number(new URL(url).searchParams.get('p')); return Number.isInteger(p) && p > 0 ? p : 1; } catch (_) { return 1; } }

  /** From the hash-bucket response, keep this video's (and this part's) segments that the user enabled. */
  function pickSegments(response, bvid, cid, s) {
    const entry = (Array.isArray(response) ? response : []).find(v => v && v.videoID === bvid);
    if (!entry || !Array.isArray(entry.segments)) return [];
    const actions = new Set(['skip', 'poi']);
    if (s.sbMute) actions.add('mute');
    return entry.segments
      .filter(x => x && Array.isArray(x.segment) && x.segment.length === 2 && BY_NAME[x.category])
      .filter(x => cid == null || x.cid == null || String(x.cid) === String(cid))
      .filter(x => actions.has(x.actionType || 'skip') && optionFor(s, x.category) !== 'off')
      .filter(x => x.actionType === 'poi' || (x.segment[1] - x.segment[0]) >= (s.sbMinDuration || 0))
      .map(x => ({UUID: x.UUID, category: x.category, actionType: x.actionType || 'skip', start: Number(x.segment[0]), end: Number(x.segment[1]),
        locked: !!x.locked, votes: x.votes | 0, option: optionFor(s, x.category)}))
      .filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end >= x.start)
      .sort((a, b) => a.start - b.start);
  }

  /** What to do at playback time t. `done` = set of UUIDs already skipped or undone (never re-skip those).
   * Returns {type:'skip'|'prompt'|'mute'|null, seg}. Auto skip fires inside [start, end - 0.3);
   * like their scheduler, a seek that lands inside a segment also skips it. */
  function decide(segs, t, done) {
    let mute = null, prompt = null;
    for (const g of segs) {
      if (g.actionType === 'poi') continue;
      if (t < g.start || t >= g.end) continue;
      if (g.actionType === 'mute') { if (!done.has(g.UUID)) mute = g; continue; }
      if (done.has(g.UUID)) continue;
      if (g.option === 'auto' && t < g.end - 0.3) return {type: 'skip', seg: g};
      if (g.option === 'manual' && !prompt) prompt = g;
    }
    if (prompt) return {type: 'prompt', seg: prompt};
    if (mute) return {type: 'mute', seg: mute};
    return {type: null, seg: null};
  }
  /** Chain overlapping/adjacent auto segments so one skip clears all of them. */
  function skipTarget(segs, seg, done) {
    let end = seg.end;
    for (let changed = true; changed;) {
      changed = false;
      for (const g of segs) if (g.actionType === 'skip' && g.option === 'auto' && !done.has(g.UUID) && g.start <= end + 0.05 && g.end > end) { end = g.end; changed = true; }
    }
    return end;
  }

  /** Anonymous submitter id like theirs (random, local only). */
  function newUserId() {
    const a = new Uint8Array(18); root.crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }
  function submission({bvid, cid, userID, duration, start, end, category, version}) {
    const poi = category === 'poi_highlight';
    return {videoID: bvid, cid: String(cid), userID, videoDuration: duration, userAgent: `BiliThrottle/v${version}`,
      segments: [{segment: [start, poi ? start : end], category, actionType: poi ? 'poi' : 'skip'}]};
  }

  const fmt = t => { t = Math.max(0, Math.round(t)); const m = Math.floor(t / 60), s = t % 60; return `${m}:${String(s).padStart(2, '0')}`; };

  const api = Object.freeze({SERVER, CATEGORIES, BY_NAME, OPTIONS, OPTION_LABEL, key, defaults, settings, optionFor, sha256, hashPrefix,
    parseBvid, parsePage, pickSegments, decide, skipTarget, newUserId, submission, fmt});
  root.__BTR_SB_CORE__ = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
