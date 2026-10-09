/* BiliThrottle infinite feed: pure helpers for B 站's homepage recommendation API.
 * WBI signing follows the public algorithm the web client uses (nav → img/sub key → mixin key →
 * md5 of the sorted query). No cookies or tokens are read here; requests carry the page's own cookies.
 */
(function (root) {
  'use strict';
  const RCMD = 'https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd';
  const RCMD_LEGACY = 'https://api.bilibili.com/x/web-interface/index/top/feed/rcmd';
  const NAV = 'https://api.bilibili.com/x/web-interface/nav';
  const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

  /* ---- MD5 (RFC 1321) over UTF-8 ---- */
  function md5(input) {
    const bytes = new TextEncoder().encode(String(input));
    const n = ((bytes.length + 8) >>> 6) + 1, words = new Uint32Array(n * 16);
    for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
    words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
    words[n * 16 - 2] = (bytes.length * 8) >>> 0;
    words[n * 16 - 1] = Math.floor(bytes.length / 0x20000000);
    const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    const K = Array.from({length: 64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let off = 0; off < words.length; off += 16) {
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) { f = (b & c) | (~b & d); g = i; }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
        else { f = c ^ (b | ~d); g = (7 * i) % 16; }
        const s = S[(i >> 4) * 4 + (i % 4)];
        const sum = (a + f + K[i] + words[off + g]) >>> 0;
        a = d; d = c; c = b;
        b = (b + ((sum << s) | (sum >>> (32 - s)))) >>> 0;
      }
      a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
    }
    return [a0, b0, c0, d0].map(w => Array.from({length: 4}, (_, i) => ((w >>> (i * 8)) & 255).toString(16).padStart(2, '0')).join('')).join('');
  }

  const keyOf = url => String(url || '').split('/').pop().split('.')[0];
  function keysFromNav(nav) {
    const img = keyOf(nav?.data?.wbi_img?.img_url), sub = keyOf(nav?.data?.wbi_img?.sub_url);
    return /^[0-9a-f]{32}$/i.test(img) && /^[0-9a-f]{32}$/i.test(sub) ? {img, sub} : null;
  }
  function mixinKey(img, sub) { const raw = img + sub; return MIXIN.map(i => raw[i]).join('').slice(0, 32); }
  function signWbi(params, keys, wts = Math.round(Date.now() / 1000)) {
    const all = {...params, wts}, mk = mixinKey(keys.img, keys.sub);
    const query = Object.keys(all).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(all[k]).replace(/[!'()*]/g, ''))}`).join('&');
    return `${query}&w_rid=${md5(query + mk)}`;
  }

  // One request of the homepage feed; idx distinguishes concurrent requests like the web client's paging.
  function rcmdParams(idx, ps, width = 1920, height = 1080) {
    return {web_location: 1430650, y_num: 4, fresh_type: 4, feed_version: 'V8', fresh_idx_1h: idx, fetch_row: idx * 3 + 1,
      fresh_idx: idx, brush: idx, homepage_ver: 1, ps, last_y_num: 5, screen: `${width}-${height}`, seo_info: '', last_showlist: '', uniq_id: ''};
  }

  const two = n => String(n).padStart(2, '0');
  function duration(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    if (!s) return '';
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return h ? `${h}:${two(m)}:${two(s % 60)}` : `${two(m)}:${two(s % 60)}`;
  }
  function count(v) {
    const n = Math.max(0, Number(v) || 0);
    if (n >= 1e8) return `${(n / 1e8).toFixed(1).replace(/\.0$/, '')}亿`;
    if (n >= 1e4) return `${(n / 1e4).toFixed(1).replace(/\.0$/, '')}万`;
    return String(Math.floor(n));
  }
  function date(ts, now = Date.now()) {
    const t = Number(ts) * 1000;
    if (!t) return '';
    const diff = now - t;
    if (diff >= 0 && diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}分钟前`;
    if (diff >= 0 && diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    const d = new Date(t), n = new Date(now);
    return d.getFullYear() === n.getFullYear() ? `${d.getMonth() + 1}-${d.getDate()}` : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  const text = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  function cover(pic) {
    try {
      const u = new URL(String(pic || '').replace(/^\/\//, 'https://').replace(/^http:/, 'https:'));
      if (u.protocol !== 'https:' || !/(?:^|\.)hdslb\.com$/.test(u.hostname)) return '';
      return `${u.origin}${u.pathname.split('@')[0]}@480w_270h_1c.webp`;
    } catch (_) { return ''; }
  }

  // Videos only: ads (business_info / goto ad), live rooms and anything without a valid BV id are dropped.
  function cards(items, seen = new Set(), now = Date.now()) {
    const out = [];
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || typeof it !== 'object' || it.goto !== 'av' || it.business_info || it.is_ad) continue;
      const bvid = String(it.bvid || '');
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || seen.has(bvid)) continue;
      const title = text(it.title, 180);
      if (!title) continue;
      seen.add(bvid);
      const pic = cover(it.pic);
      out.push({bvid, aid: Math.max(0, Math.trunc(Number(it.id)) || 0), mid: Math.max(0, Math.trunc(Number(it.owner?.mid)) || 0),
        url: `https://www.bilibili.com/video/${bvid}`, title, cover: pic, coverBase: pic ? pic.split('@')[0] : '', duration: duration(it.duration),
        author: text(it.owner?.name, 60), views: count(it.stat?.view), danmaku: count(it.stat?.danmaku),
        date: date(it.pubdate, now), followed: it.is_followed === 1 || it.is_followed === true});
    }
    return out;
  }

  // -352 / -412 / -401 are B 站's risk-control answers: stop and back off instead of hammering.
  const RISK = new Set([-352, -412, -401, -509]);
  function classify(json) {
    if (!json || typeof json !== 'object') return 'bad';
    if (json.code === 0) return 'ok';
    return RISK.has(Number(json.code)) ? 'risk' : 'error';
  }

  const api = Object.freeze({RCMD, RCMD_LEGACY, NAV, md5, keysFromNav, mixinKey, signWbi, rcmdParams, duration, count, date, cover, cards, classify});
  root.__BTR_FEED_CORE__ = api;
  if (typeof module === 'object') module.exports = api;
})(globalThis);
