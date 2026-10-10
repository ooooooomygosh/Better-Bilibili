/* BiliThrottle 全站净化: one switch per kind of clutter, across B 站's pages.
 * Selectors follow what the maintained AdGuard Chinese / Annoyances lists target today (cards with
 * explicit ad markers, cm.bilibili.com click trackers, known ad slots) — never titles or uploader names.
 * Each rule is plain CSS gated by an attribute on <html>, so it applies at the first style pass.
 */
(function (root) {
  'use strict';
  const HOME = /^www\.bilibili\.com\/(?:index\.html)?$/;
  const VIDEO = /^www\.bilibili\.com\/(?:video|list|medialist|bangumi\/play|festival)\//;
  const SEARCH = /^search\.bilibili\.com\//;
  const DYN = /^(?:t\.bilibili\.com\/|www\.bilibili\.com\/opus\/|space\.bilibili\.com\/\d+\/dynamic)/;
  const ANY = /./;
  const AD_LINK = 'a[href*="cm.bilibili.com"]';

  const RULES = Object.freeze([
    // 首页 (the native recommendation grid; 广告卡片 itself is homeHideAds in home-core)
    {key: 'cleanHomeCarouselAds', group: '首页', label: '轮播图里的广告', hint: '大图轮播中跳转到推广页的那几张', def: true, page: HOME,
      css: [`.recommended-swipe .vui_carousel__slide:has(${AD_LINK})`, `.recommended-swipe-body div[class*="slide "]:has(${AD_LINK})`,
        '.recommended-swipe .carousel-footer-title > a[href^="http"]:not([href*=".bilibili.com/"])']},
    {key: 'cleanHomeLive', group: '首页', label: '直播卡片', hint: '推荐区里的直播间卡片和直播楼层', def: false, page: HOME,
      css: [':is(.recommended-container_floor-aside,.recommended-container) .container > :is(.feed-card,.bili-feed-card,.floor-single-card,.bili-live-card):has(.bili-live-card,a[href*="live.bilibili.com"])',
        ':is(.recommended-container_floor-aside,.recommended-container) .container > .bili-live-card', '.feed2 > .bili-live-card', '[data-btr-kind="live"]']},
    {key: 'cleanHomeFloor', group: '首页', label: '番剧 / 影视 / 课堂等楼层卡片', hint: '夹在推荐里的分区推广块（直播楼层见上一项）', def: false, page: HOME,
      css: [':is(.recommended-container_floor-aside,.recommended-container) .container > .floor-single-card:not(:has(a[href*="live.bilibili.com"])):not([data-btr-kind="live"])', '[data-btr-kind="floor"]']},
    // 视频页
    {key: 'cleanVideoAds', group: '视频页', label: '右侧广告与推广卡片', hint: '弹幕列表下方的广告、商品、游戏和活动推广', def: true, page: VIDEO,
      css: ['#slide_ad', '.ad-report', '.video-card-ad-small', '.video-page-special-card-small', '.video-page-game-card-small', '.video-page-game-card',
        '.video-page-operator-card-small', '.ad-floor-exp', '.ad-floor-cover', '.activity-m-v1', '#right-bottom-banner', '.right-bottom-banner',
        `.video-page-card-small:has(${AD_LINK})`, '.bili-video-card:has(.bili-video-card__info--ad)']},
    {key: 'cleanVideoLive', group: '视频页', label: '小窗直播推荐', hint: '视频页角落弹出的直播小窗', def: false, page: VIDEO,
      css: ['.pop-live-small-mode', '.video-page-card-small:has(a[href*="live.bilibili.com"])']},
    // 搜索 / 动态
    {key: 'cleanSearchAds', group: '搜索与动态', label: '搜索结果里的广告', hint: '带「广告」标记的搜索结果和品牌推广', def: true, page: SEARCH,
      css: ['.video-list > div:has(.ad-feedback-entry)', '.video-list-item:has(.bili-video-card__info--ad)', '.bili-video-card:has(.bili-video-card__info--ad)',
        `.video-list > div:has(${AD_LINK})`, '.brand-ad-list']},
    {key: 'cleanDynAds', group: '搜索与动态', label: '动态里的广告与带货', hint: '动态页的广告位和商品卡片', def: true, page: DYN,
      css: ['.bili-dyn-ads', '.bili-dyn-list__item:has(.bili-dyn-card-goods)', '.bili-dyn-item__ads']},
    // 全站
    {key: 'cleanAdblockTips', group: '全站', label: '「检测到广告拦截」提示', hint: 'B 站发现广告被隐藏后插进来的提示块', def: true, page: ANY,
      css: ['.adblock-tips', '.__adblockhidden']},
    {key: 'cleanLoginTips', group: '全站', label: '未登录时的登录提示', hint: '视频页和首页反复弹出的「登录看更多」浮层（登录窗口本身不受影响）', def: false, page: ANY,
      css: ['.login-tip', '.login-panel-popover', '.lt-row > .lt-col > .vip-login-tip', '.bili-mini-login-tip']},
    {key: 'cleanOpenApp', group: '全站', label: '「打开 App」按钮与弹窗', hint: '移动版页面里引导下载客户端的按钮', def: true, page: ANY,
      css: ['bili-open-app', '.open-app-btn', '.fe-ui-open-app-btn', '.openapp-dialog', '.m-video2-awaken-btn', '.mplayer-widescreen-callapp', '.launch-app-btn']},
    {key: 'cleanDownloadEntry', group: '全站', label: '顶栏「下载客户端」入口', hint: '顶栏右侧的下载 App 按钮', def: false, page: ANY,
      css: ['.bili-header .download-entry', '.right-entry .download-client-trigger', '.bili-header__bar .download-client-trigger']}
  ]);

  const defaults = Object.freeze(Object.fromEntries(RULES.map(r => [r.key, r.def])));
  const KEYS = Object.freeze(RULES.map(r => r.key));
  const attr = key => 'data-btr-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
  function settings(raw = {}) { return Object.fromEntries(RULES.map(r => [r.key, typeof raw[r.key] === 'boolean' ? raw[r.key] : r.def])); }
  /** Rules that apply to a page; `where` is hostname + pathname, e.g. "www.bilibili.com/video/BV…/". */
  const forPage = where => RULES.filter(r => r.page.test(where));
  /** One stylesheet for every rule; inert until its attribute is on <html>. */
  const css = () => RULES.map(r => r.css.map(sel => `html[${attr(r.key)}] ${sel}`).join(',\n') + '{display:none!important}').join('\n');
  const groups = () => [...new Set(RULES.map(r => r.group))].map(g => ({group: g, rules: RULES.filter(r => r.group === g)}));

  const api = Object.freeze({RULES, defaults, KEYS, settings, forPage, css, attr, groups});
  root.__BTR_CLEAN_CORE__ = api;
  if (typeof module === 'object') module.exports = api;
})(globalThis);
