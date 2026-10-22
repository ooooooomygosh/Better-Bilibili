/* Only Bilibili's public reply_control.location is displayed. No lookup or IP inference. */
(function (root) {
  'use strict';
  function locationLabel(value) {
    if (typeof value !== 'string') return '';
    const place = value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').replace(/^\s*IP\s*属地\s*[:：]?\s*/i, '').trim();
    if (!place || place.length > 40 || /^(?:未知|未知属地|保密|--|null|undefined)$/i.test(place)) return '';
    // This feature shows a region, never a numeric IP address or HTML from page data.
    if (/\b\d{1,3}(?:\.\d{1,3}){3}\b|[<>]|(?:[\da-f]{0,4}:){2}/i.test(place)) return '';
    return `IP属地：${place}`;
  }
  const api = Object.freeze({locationLabel});
  root.__BTR_COMMENT_CORE__ = api;
  if (typeof module === 'object') module.exports = api;
})(globalThis);
