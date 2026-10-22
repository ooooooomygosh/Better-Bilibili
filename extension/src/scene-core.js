/* Purpose-based browsing. Modes never rewrite the user's feed, quota or playback settings. */
(function (root) {
  'use strict';
  const defaults = Object.freeze({sceneMode: 'normal', sceneStudyComments: false, commentLocation: true});
  const MODES = Object.freeze({
    normal: {label: '日常', icon: '🏠', hint: '恢复自己的首页与评论设置。', searches: []},
    study: {label: '学习', icon: '📚', hint: '用课程入口替换首页推荐，收起视频相关推荐与评论，专心看完这一课。', searches: ['公开课', '编程教程', '数学课程', '英语学习', '考研', '知识科普']},
    food: {label: '美食', icon: '🍜', hint: '用美食入口替换首页推荐，保留评论看食谱和反馈，收起视频相关推荐。', searches: ['家常菜教程', '一人食', '烘焙教程', '下饭菜', '美食探店', '地方美食']}
  });
  const mode = value => value === 'study' || value === 'food' ? value : 'normal';
  const settings = (raw = {}) => ({sceneMode: mode(raw.sceneMode), sceneStudyComments: raw.sceneStudyComments === true, commentLocation: raw.commentLocation !== false});
  const searchURL = term => `https://search.bilibili.com/all?keyword=${encodeURIComponent(String(term).trim().slice(0, 100))}`;
  // Keep only the public video identity, part and optional playback position. Tracking, signed
  // media URLs, account ids and unrelated hosts never enter the clipboard.
  function shareURL(input, seconds) {
    try {
      const src = new URL(input);
      if (src.protocol !== 'https:' || src.hostname !== 'www.bilibili.com') return null;
      const match = src.pathname.match(/^\/(video\/(?:BV[\da-z]+|av\d+)|bangumi\/play\/(?:ep|ss)\d+)\/?$/i);
      if (!match) return null;
      const out = new URL(`https://www.bilibili.com/${match[1]}/`), part = Number(src.searchParams.get('p'));
      if (Number.isInteger(part) && part > 1 && part < 10000) out.searchParams.set('p', part);
      if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 86400) out.searchParams.set('t', Math.floor(seconds));
      return out.href;
    } catch (_) { return null; }
  }
  const api = Object.freeze({defaults, MODES, mode, settings, searchURL, shareURL});
  root.__BTR_SCENE_CORE__ = api;
  if (typeof module === 'object') module.exports = api;
})(globalThis);
