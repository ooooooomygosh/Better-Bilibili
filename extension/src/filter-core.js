/* BiliThrottle filters: the user's own block lists (title keywords, uploaders, B 站 tags).
 * Pure functions, shared by the home page, the infinite feed, the quick panel and the options page.
 * Lists live in chrome.storage.sync, so they follow the user to other browsers.
 */
(function (root) {
  'use strict';
  const MAX_ITEMS = 300, MAX_LEN = 80;
  const defaults = Object.freeze({filterEnabled: true, filterKeywords: [], filterUps: [], filterTags: [], filterDedupe: true});
  const KEYS = Object.freeze(Object.keys(defaults));

  const clean = s => String(s ?? '').replace(/[\u0000-\u001f​-‏⁠﻿]/g, '').trim();
  /** Comparable text: full-width → half-width (NFKC), case-folded, invisible characters removed. */
  const norm = s => clean(s).normalize('NFKC').toLowerCase();

  function list(raw, fix = clean) {
    const out = [], seen = new Set();
    for (const v of Array.isArray(raw) ? raw : []) {
      const t = fix(v).slice(0, MAX_LEN);
      const k = norm(t);
      if (!t || seen.has(k)) continue;
      seen.add(k); out.push(t);
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  }

  /** An uploader entry is either "uid:123" / "uid:123:名字" (blocked by account) or a plain name. */
  function parseUp(entry) {
    const t = clean(entry);
    const m = /^uid[:：]\s*(\d{1,20})(?:[:：](.*))?$/i.exec(t) || /^(\d{3,20})$/.exec(t);
    return m ? {mid: m[1], name: clean(m[2] || '')} : {mid: '', name: t};
  }
  const upEntry = (mid, name) => `uid:${String(mid).replace(/\D/g, '')}${name ? ':' + clean(name).slice(0, 40) : ''}`;
  const fixUp = v => { const p = parseUp(v); return p.mid ? upEntry(p.mid, p.name) : p.name; };

  function settings(raw = {}) {
    return {
      filterEnabled: raw.filterEnabled !== false,
      filterDedupe: raw.filterDedupe !== false,
      filterKeywords: list(raw.filterKeywords),
      filterUps: list(raw.filterUps, fixUp),
      filterTags: list(raw.filterTags, v => clean(v).replace(/^#+/, ''))
    };
  }

  /** "/正则/i" is a regular expression; anything else is a plain, case-insensitive substring. */
  function keyword(k) {
    const m = /^\/(.+)\/([imsu]*)$/.exec(k);
    if (m) {
      try { const re = new RegExp(m[1], m[2].includes('i') ? m[2] : m[2] + 'i'); return {label: k, test: t => re.test(t)}; }
      catch (_) { return null; } // An invalid expression simply never matches.
    }
    const n = norm(k);
    return n ? {label: k, test: t => t.includes(n)} : null;
  }

  /** Precompile the lists once; `match` then runs per card. */
  function compile(raw) {
    const s = settings(raw);
    const kws = s.filterKeywords.map(keyword).filter(Boolean);
    const mids = new Map(), names = new Map();
    for (const e of s.filterUps) { const p = parseUp(e); if (p.mid) mids.set(p.mid, e); else names.set(norm(p.name), e); }
    const tags = new Map(s.filterTags.map(t => [norm(t), t]));
    const on = s.filterEnabled && (kws.length > 0 || mids.size > 0 || names.size > 0 || tags.size > 0);
    return {
      on, needsTags: on && tags.size > 0, dedupe: s.filterDedupe, size: kws.length + mids.size + names.size + tags.size,
      /** First rule a card breaks: {type, value, label} or null. card: {title, author, mid, tags?} */
      match(card) {
        if (!on || !card) return null;
        const mid = String(card.mid || '');
        if (mid && mids.has(mid)) return {type: 'up', value: mids.get(mid), label: `UP 主「${card.author || mid}」`};
        const au = norm(card.author);
        if (au && names.has(au)) return {type: 'up', value: names.get(au), label: `UP 主「${card.author}」`};
        const title = norm(card.title);
        if (title) for (const k of kws) if (k.test(title)) return {type: 'keyword', value: k.label, label: `关键词「${k.label}」`};
        if (Array.isArray(card.tags)) for (const t of card.tags) { const n = norm(t); if (tags.has(n)) return {type: 'tag', value: tags.get(n), label: `标签「${t}」`}; }
        return null;
      }
    };
  }

  /** Add one entry to a list (dedupe, cap); returns the new list or null if nothing changed. */
  function add(listRaw, entry, kind) {
    const before = kind === 'ups' ? list(listRaw, fixUp) : list(listRaw);
    const fixed = kind === 'ups' ? fixUp(entry) : kind === 'tags' ? clean(entry).replace(/^#+/, '') : clean(entry);
    if (!fixed) return null;
    const key = kind === 'ups' ? (parseUp(fixed).mid || norm(fixed)) : norm(fixed);
    if (before.some(e => (kind === 'ups' ? (parseUp(e).mid || norm(e)) : norm(e)) === key)) return null;
    return [...before, fixed].slice(-MAX_ITEMS);
  }
  const remove = (listRaw, entry) => (Array.isArray(listRaw) ? listRaw : []).filter(e => e !== entry);
  /** Text for chips: "名字" for uid entries that carry one, "UID 123" otherwise. */
  const upLabel = e => { const p = parseUp(e); return p.mid ? (p.name || `UID ${p.mid}`) : p.name; };

  const api = Object.freeze({defaults, KEYS, settings, compile, parseUp, upEntry, upLabel, add, remove, norm, MAX_ITEMS});
  root.__BTR_FILTER_CORE__ = api;
  if (typeof module === 'object') module.exports = api;
})(globalThis);
