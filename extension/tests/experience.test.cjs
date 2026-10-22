'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const scene = require('../src/scene-core.js'), comments = require('../src/comment-core.js'), stats = require('../src/stats-core.js'), sb = require('../src/sb-core.js');

test('scene selection changes no underlying playback, quota or homepage preferences', () => {
  const original = {homeInfinite: true, homePreview: 'video', focusEnabled: true, focusStrict: true, focusWindowMinutes: 15};
  for (const mode of ['study', 'food', 'normal']) {
    const raw = {...original, sceneMode: mode};
    assert.equal(scene.settings(raw).sceneMode, mode);
    assert.deepEqual(Object.keys(scene.settings(raw)), ['sceneMode', 'sceneStudyComments', 'commentLocation']);
    assert.deepEqual(original, {homeInfinite: true, homePreview: 'video', focusEnabled: true, focusStrict: true, focusWindowMinutes: 15});
  }
  assert.equal(scene.mode('__proto__'), 'normal'); assert.equal(scene.mode(null), 'normal');
  assert.equal(scene.settings({commentLocation: false}).commentLocation, false);
});
test('scene searches encode user input without changing the destination host', () => {
  const url = new URL(scene.searchURL('米饭 & 糖#盐? foo'));
  assert.equal(url.hostname, 'search.bilibili.com'); assert.equal(url.searchParams.get('keyword'), '米饭 & 糖#盐? foo');
  assert.equal([...url.searchParams].length, 1);
});
test('video sharing strips tracking and preserves valid part and optional time', () => {
  assert.equal(scene.shareURL('https://www.bilibili.com/video/BV1xx411c7mD/?spm=secret&p=2&share_source=copy#token'), 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2');
  assert.equal(scene.shareURL('https://www.bilibili.com/bangumi/play/ep123?foo=x', 18.7), 'https://www.bilibili.com/bangumi/play/ep123/?t=18');
  for (const url of ['http://www.bilibili.com/video/av123','https://evil.test/video/av123','https://www.bilibili.com.evil.test/video/av123','https://www.bilibili.com/','javascript:alert(1)']) assert.equal(scene.shareURL(url), null);
  assert.equal(scene.shareURL('https://www.bilibili.com/video/av123?p=-1', Infinity), 'https://www.bilibili.com/video/av123/');
});
test('comment location is public regional text, never inferred IP or markup', () => {
  assert.equal(comments.locationLabel('IP属地： 上海 '), 'IP属地：上海');
  assert.equal(comments.locationLabel('澳大利亚'), 'IP属地：澳大利亚');
  for (const value of [null, 123, {}, '', '未知', '1.2.3.4', '2001:db8::1', '<img src=x onerror=alert(1)>', 'x'.repeat(100)]) assert.equal(comments.locationLabel(value), '');
  assert.equal(comments.locationLabel('IP属地：\u202e浙江'), 'IP属地：浙江');
});
test('report flush splits midnight, preserves prior deduplication, and counts new day only after 10 seconds', () => {
  const at = new Date(2026, 9, 19, 0, 0, 3).getTime();
  let raw = {days: {'2026-10-18': {s: 20, h: Array(23).fill(0).concat(20), n: 1, ids: ['BVtest']}}};
  raw = stats.tick(raw, at, 5, 'BVtest', {mid: '12', name: '课程'});
  assert.equal(raw.days['2026-10-18'].s, 22); assert.equal(raw.days['2026-10-18'].n, 1);
  assert.equal(raw.days['2026-10-19'].s, 3); assert.equal(raw.days['2026-10-19'].n, 0);
  raw = stats.tick(raw, at + 7000, 7, 'BVtest', {mid: '12', name: '课程'});
  assert.equal(raw.days['2026-10-19'].n, 1); assert.equal(raw.days['2026-10-19'].h[0], 10);
  assert.equal(stats.week(raw, '2026-10-12').seconds, 22); assert.equal(stats.week(raw, '2026-10-19').seconds, 10);
  assert.equal(stats.normalize(raw, at + 60000).days['2026-10-18'].ids, undefined);
});
test('report flush splits hours and rejects invalid dates / prototype-like ids', () => {
  const at = new Date(2026, 9, 23, 16, 0, 2).getTime();
  let raw = stats.tick(null, at, 5, '__proto__', {mid: 'abc123', name: 'not a valid uid'});
  const day = raw.days['2026-10-23']; assert.equal(day.h[15], 3); assert.equal(day.h[16], 2); assert.equal(day.n, 0); assert.deepEqual(day.up, {});
  assert.equal(stats.addDays('2026-02-31', 1), null); assert.equal(stats.weekKey('2026-13-01'), null);
  assert.equal(stats.week({days: {'2026-10-19': {s: 50}}}, '2026-10-19').peakHour, -1);
});
test('report share text hides uploaders by default and CSV includes only numeric daily totals', () => {
  const raw = stats.tick(null, new Date(2026, 9, 23, 12).getTime(), 30, 'BVtest', {mid: '12', name: '=HYPERLINK("secret")'}), w = stats.week(raw, '2026-10-19');
  assert(!stats.shareText(w).includes('HYPERLINK')); assert(stats.shareText(w, {hideUps: false}).includes('HYPERLINK'));
  const csv = stats.weekCSV(w, 4); assert(!csv.includes('HYPERLINK')); assert(!csv.includes('BVtest')); assert.equal(csv.trim().split('\r\n').length, 6);
  assert(csv.includes('2026-10-23,30,1,0')); assert(!csv.includes('2026-10-24'));
});
test('report keeps seconds beyond an hour for concurrent playback or repeated local hours', () => {
  const now = new Date(2026, 9, 23, 12, 30).getTime(), hours = Array(24).fill(0); hours[12] = 3600;
  const raw = stats.tick({days: {'2026-10-23': {s: 3600, h: hours}}}, now, 30, 'BVtest');
  assert.equal(raw.days['2026-10-23'].s, 3630);
  assert.equal(stats.normalize(raw, now).days['2026-10-23'].h[12], 3630);
});
test('unknown CID never applies another part\'s skip segments', () => {
  const response = [{videoID:'BVtest', segments: [11, 22, null].map((cid, i) => ({UUID:String(i), cid, category:'sponsor', segment:[1,4]}))}];
  assert.deepEqual(sb.pickSegments(response, 'BVtest', null, sb.settings({})).map(s => s.UUID), ['2']);
  assert.deepEqual(sb.pickSegments(response, 'BVtest', 22, sb.settings({})).map(s => s.UUID), ['1','2']);
});
test('jumpscare defaults to auto; mute obeys show/manual/off and restores decision outside interval', () => {
  assert.equal(sb.settings({}).sbCat_jumpscare, 'auto');
  const seg = {UUID: 'jump', category: 'jumpscare', actionType: 'mute', start: 5, end: 10, option: 'auto'};
  assert.equal(sb.decide([seg], 6, new Set()).type, 'mute');
  assert.equal(sb.decide([seg], 10, new Set()).type, null);
  assert.equal(sb.decide([{...seg, option: 'show'}], 6, new Set()).type, null);
  assert.equal(sb.decide([{...seg, option: 'manual'}], 6, new Set()).type, 'prompt');
  assert.equal(sb.decide([seg], 6, new Set(['jump'])).type, null);
  assert.equal(sb.submission({category: 'jumpscare', start: 5, end: 10}).segments[0].actionType, 'mute');
});
test('upstream relay addresses are never transplanted; relay-only tracks remain playable in every CDN mode', () => {
  const c = vm.createContext({URL, console});
  for (const file of ['range-core.js','cdn-resolver.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), c);
  const cdn = c.__BILI_CDN_RESOLVER_FACTORY__;
  const relay = 'https://xy.mcdn.bilivideo.cn:4483/v1/resource/abc.m4s?os=mcdn&sign=secret';
  for (const mode of ['auto','mainland','overseas','custom']) {
    const urls = cdn.representationUrls({baseUrl: relay}, mode, ['upos-sz-mirrorali.bilivideo.com']);
    assert.deepEqual([...urls], [relay]);
  }
  const urls = cdn.representationUrls({baseUrl: relay, backupUrl: ['https://a.bilivideo.com/ordinary.m4s?sign=good']}, 'mainland');
  assert(urls.some(u => u.includes('mirrorcoso1'))); assert(urls.every(u => !u.includes('/v1/resource/')));
});
