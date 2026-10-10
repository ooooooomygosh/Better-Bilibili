'use strict';
const {test} = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const root = path.join(__dirname, '..'); const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const sb = require('../src/sb-core.js');
const S = sb.settings({});
const resp = [{videoID: 'BV1xx411c7mD', segments: [
  {cid: '11', category: 'sponsor', actionType: 'skip', segment: [30, 45], UUID: 'a'},
  {cid: '11', category: 'sponsor', actionType: 'skip', segment: [45, 50], UUID: 'a2'},
  {cid: '11', category: 'intro', actionType: 'skip', segment: [0, 5], UUID: 'b'},
  {cid: '11', category: 'filler', actionType: 'skip', segment: [60, 70], UUID: 'c'},
  {cid: '22', category: 'sponsor', actionType: 'skip', segment: [10, 20], UUID: 'd'},
  {cid: '11', category: 'poi_highlight', actionType: 'poi', segment: [90, 90], UUID: 'e'}]},
  {videoID: 'BV1other00000', segments: [{cid: '11', category: 'sponsor', actionType: 'skip', segment: [1, 2], UUID: 'z'}]}];

test('hash prefix is 4 hex chars of sha256(BV) (k-anonymity like BilibiliSponsorBlock)', async () => {
  assert.equal(await sb.hashPrefix('abc'), 'ba78'); assert.match(await sb.hashPrefix('BV1xx411c7mD'), /^[0-9a-f]{4}$/);
});
test('defaults follow upstream: sponsor auto, selfpromo manual, filler off', () => {
  assert.equal(S.sbEnabled, true); assert.equal(S.sbCat_sponsor, 'auto'); assert.equal(S.sbCat_selfpromo, 'manual'); assert.equal(S.sbCat_filler, 'off');
  assert.equal(sb.settings({sbCat_sponsor: 'bogus', sbToastSeconds: -3}).sbCat_sponsor, 'auto'); assert.equal(sb.settings({sbToastSeconds: -3}).sbToastSeconds, 4);
});
test('pickSegments keeps only this video, this cid, enabled categories, sorted', () => {
  const g = sb.pickSegments(resp, 'BV1xx411c7mD', 11, S);
  assert.deepEqual(g.map(x => x.UUID), ['b', 'a', 'a2', 'e']);
  assert.equal(g[1].option, 'auto'); assert.equal(g[0].option, 'manual');
  assert.equal(sb.pickSegments(resp, 'BV1xx411c7mD', 11, sb.settings({sbCat_intro: 'off'})).length, 3);
  assert.equal(sb.pickSegments(resp, 'BV1nothing0000', 11, S).length, 0);
  assert.equal(sb.pickSegments(resp, 'BV1xx411c7mD', 11, sb.settings({sbMinDuration: 6})).map(x => x.UUID).join(), 'a,e');
});
test('decide: auto inside segment, manual prompts, done never re-skips (undo)', () => {
  const g = sb.pickSegments(resp, 'BV1xx411c7mD', 11, S), done = new Set();
  assert.equal(sb.decide(g, 31, done).type, 'skip'); assert.equal(sb.decide(g, 2, done).type, 'prompt'); assert.equal(sb.decide(g, 55, done).type, null);
  assert.equal(sb.decide(g, 44.5, done).type, 'skip', 'skips until 0.3 s before the end');
  done.add('a'); assert.equal(sb.decide(g, 31, done).type, null, 'undone segment is not skipped again');
});
test('skipTarget chains adjacent auto segments', () => {
  const g = sb.pickSegments(resp, 'BV1xx411c7mD', 11, S); assert.equal(sb.skipTarget(g, g[1], new Set()), 50);
});
test('parse BV / page; submission body', () => {
  assert.equal(sb.parseBvid('https://www.bilibili.com/video/BV1xx411c7mD/?p=2'), 'BV1xx411c7mD'); assert.equal(sb.parsePage('https://www.bilibili.com/video/BV1xx411c7mD/?p=2'), 2);
  assert.equal(sb.parseBvid('https://www.bilibili.com/'), null);
  const b = sb.submission({bvid: 'BV1xx411c7mD', cid: 11, userID: 'u', duration: 100, start: 1, end: 9, category: 'sponsor', version: '2.5.0'});
  assert.deepEqual(b.segments, [{segment: [1, 9], category: 'sponsor', actionType: 'skip'}]); assert.equal(b.cid, '11');
  assert.match(sb.newUserId(), /^[0-9a-f]{36}$/);
});
test('manifest: no new permissions, scripts wired', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.deepEqual(m.permissions, ['storage']); assert(!m.host_permissions);
  const e = m.content_scripts.find(x => x.js.includes('src/sponsorblock.js'));
  assert.deepEqual(e.js, ['src/ui-kit.js', 'src/sb-core.js', 'src/sponsorblock.js']); assert.equal(e.world, 'ISOLATED');
  const q = m.content_scripts.find(x => x.js.includes('src/quick-panel.js')); assert(q.js.indexOf('src/sb-core.js') < q.js.indexOf('src/quick-panel.js'));
});
test('popup one-click switch, welcome asks, options lists every category', () => {
  const ph = read('ui/popup.html'), pj = read('ui/popup.js');
  assert.match(ph, /<span class="switch"><input id="sbEnabled" type="checkbox" role="switch"/); assert.match(pj, /sbEnabled/); assert(!/reload/.test(pj.split('空降助手')[1].split('\n')[2]));
  const wh = read('ui/welcome.html'), wj = read('ui/welcome.js'); assert.match(wh, /id="sbChoice"/); assert.match(wh, /data-sb="1"/); assert.match(wh, /data-sb="0"/); assert.match(wj, /sbChosen: true/);
  assert.match(read('ui/options.html'), /id="sponsor"/); assert.match(read('ui/options.js'), /sbCore\.CATEGORIES/);
});
test('UI uses BiliThrottle tokens only; no SponsorBlock stylesheet or assets', () => {
  const js = read('src/sponsorblock.js'), code = js.slice(js.indexOf('*/') + 2);
  assert.match(js, /ui\.scoped\('\.root'\)/); assert.match(js, /ui\.onTheme/);
  assert(!/sponsorBlock|sbNotice|skipButton|PlayerUpload|\.css['"]/i.test(code));
  for (const m of code.match(/#[0-9a-f]{3,6}\b/gi) || []) assert.fail(`hard-coded colour ${m} in sponsorblock.js`);
});
test('license: GPL-3.0 with third-party notices and file headers', () => {
  assert.match(read('LICENSE'), /GNU GENERAL PUBLIC LICENSE\s+Version 3/);
  const n = read('THIRD_PARTY_NOTICES.md'); assert.match(n, /hanydd\/BilibiliSponsorBlock/); assert.match(n, /ajayyy\/SponsorBlock/); assert.match(n, /MIT License/);
  for (const f of ['src/sb-core.js', 'src/sponsorblock.js']) { const h = read(f).slice(0, 1200); assert.match(h, /BilibiliSponsorBlock/); assert.match(h, /SponsorBlock/); assert.match(h, /General Public License v3/); }
});
