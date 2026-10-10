/* BTR Flow: bounded, inert card data only. No HTML, cookies or signed media URLs. */
(function (root) {
  'use strict';
  const MAX_SNAPSHOTS = 25, MAX_CARDS = 36, TTL = 7 * 86400000;
  const defaults = Object.freeze({homeEnabled:true, homeHistory:true, homeTheme:'native', homeHideCarousel:true, homeHideBanner:false, homeHideAds:true,
    homeInfinite:false, homeInfiniteSize:24, homeInfiniteThreads:2,
    // Hover preview on infinite-feed cards: 'video' plays the video inline like B 站's own cards; 'frames' scrubs storyboard frames.
    homePreview:'video',
    // The two homepage modes (换一批 / 无限下滑) are chosen once, the first time the homepage opens.
    homeModeChosen:false});
  function settings(raw = {}) {
    const out = {...defaults};
    for (const k of Object.keys(defaults)) {
      if (typeof defaults[k] === 'boolean') out[k] = raw[k] !== undefined ? raw[k] === true : defaults[k];
    }
    // 1.0's light/dark/auto/off all return to Bilibili's own theme, never force a theme on upgrade.
    out.homeTheme = raw.homeTheme === 'oled' ? 'oled' : 'native';
    out.homePreview = raw.homePreview === 'frames' ? 'frames' : 'video';
    const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
    // Each request returns 12 like B 站's own page; a batch is 1–3 merged requests.
    out.homeInfiniteSize = Math.round(num(raw.homeInfiniteSize, 12, 36, defaults.homeInfiniteSize) / 12) * 12;
    out.homeInfiniteThreads = num(raw.homeInfiniteThreads, 1, 3, defaults.homeInfiniteThreads);
    return out;
  }
  const text = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  function card(input) {
    if (!input || typeof input !== 'object') return null;
    let url, image = '';
    try {
      url = new URL(String(input.url), 'https://www.bilibili.com');
      if (url.protocol !== 'https:' || url.host !== 'www.bilibili.com' || url.username || url.password || !/^\/video\/(?:BV\w{1,80}|av\d+)\/?$/i.test(url.pathname)) return null;
      url.search = ''; url.hash = ''; url.pathname = url.pathname.replace(/\/$/, '');
    } catch (_) { return null; }
    try {
      const u = new URL(String(input.image || '').replace(/^\/\//, 'https://'));
      if (u.protocol === 'https:' && !u.username && !u.password && /(?:^|\.)(?:hdslb\.com|bilibili\.com)$/.test(u.hostname) && !u.port) {
        u.search = ''; u.hash = ''; image = u.href.slice(0, 1000);
      }
    } catch (_) {}
    const title = text(input.title, 180);
    if (!title) return null;
    return {url:url.href,title,image,author:text(input.author,80),duration:text(input.duration,24),stats:text(input.stats,100)};
  }
  function cards(items) {
    const seen = new Set(), result = [];
    for (const raw of Array.isArray(items) ? items.slice(0, 144) : []) {
      const c = card(raw);
      if (c && !seen.has(c.url)) { seen.add(c.url); result.push(c); }
      if (result.length === MAX_CARDS) break;
    }
    return result;
  }
  const key = items => items.slice(0, MAX_CARDS).map(c => c.url).join('|');
  function history(raw, now = Date.now()) {
    return (Array.isArray(raw) ? raw.slice(-MAX_SNAPSHOTS) : [])
      .filter(s => Number.isFinite(s?.at) && s.at <= now + 60000 && now - s.at < TTL)
      .map(s => ({at:s.at,cards:cards(s.cards)})).filter(s => s.cards.length >= 2);
  }
  function append(raw, items, now = Date.now()) {
    const h = history(raw,now), clean = cards(items);
    if (clean.length < 2 || key(h.at(-1)?.cards || []) === key(clean)) return h;
    return [...h,{at:now,cards:clean}].slice(-MAX_SNAPSHOTS);
  }
  // Lazy growth belongs to the current batch, not a new recommendation request.
  function grows(previous, next) {
    return previous.length > 0 && next.length >= previous.length && previous.every((c,i) => c.url === next[i]?.url);
  }
  // Native home-feed ads. Current B 站 (laputa-home) renders an ad card as a normal .bili-video-card whose
  // cover stats end with a bare <span class="bili-video-card__stats--text">广告</span> (or a rocket icon for
  // creative ads) instead of the duration; normal cards keep those classes inside .bili-video-card__stats--item.
  // Ad links and the "UP" link go to the advertiser (cm.bilibili.com click tracker). Older class names kept.
  const AD_MARKERS = Object.freeze([
    '.bili-video-card__stats > .bili-video-card__stats--text',
    '.bili-video-card__stats > .bili-video-card__stats--icon',
    '.bili-video-card__info--ad', '.bili-video-card__info--ad-text', '.bili-video-card__info--creative-ad',
    '.bili-video-card__stats--ad', '.bili-video-card__info--no-interest-panel--ad',
    '[data-ad-id]', '[data-is-ad="true"]', '.ad-report', '.ad-floor-cover',
    'a[href*="cm.bilibili.com"]', 'a[href*="/cm/api/"]'
  ]);
  const AD_SELECTOR = AD_MARKERS.join(',');
  /** A badge is a short leaf text that says exactly 广告 / 推广 (never a title or uploader name). */
  const isAdBadge = t => /^(?:广告|推广|商业推广|AD)$/i.test(String(t || '').replace(/\s+/g, ''));
  /** Web feed API items that are not plain videos: ads (is_ad, business_info, ad_info, cm links), live rooms. */
  function isAdItem(it) {
    if (!it || typeof it !== 'object') return true;
    if (it.goto !== 'av' || it.is_ad || it.business_info || it.ad_info || it.room_info) return true;
    return /cm\.bilibili\.com|\/cm\/api\//i.test(String(it.uri || '') + String(it.url || ''));
  }
  const api = Object.freeze({defaults,settings,card,cards,key,history,append,grows,AD_MARKERS,AD_SELECTOR,isAdBadge,isAdItem,MAX_SNAPSHOTS,MAX_CARDS,TTL});
  root.__BTR_HOME_CORE__ = api;
  if (typeof module === 'object') module.exports = api;
})(globalThis);
