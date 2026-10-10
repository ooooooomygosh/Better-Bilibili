/* BiliThrottle tag source — isolated world. The feed API carries no tags, so 按标签屏蔽 looks them up
 * per video with B 站's own public tag endpoint, only while a tag rule exists, a few at a time,
 * and remembers them locally (bounded) so a video is never asked about twice.
 */
(function () {
  'use strict';
  if (globalThis.__BTR_TAGS__) return;
  const API = 'https://api.bilibili.com/x/tag/archive/tags', KEY = 'flowTagCache', MAX = 3000, LANES = 3;
  const mem = new Map(), waiting = [];
  let loaded = null, running = 0, saveTimer = 0;

  function load() {
    if (!loaded) loaded = chrome.storage.local.get(KEY).then(d => {
      const c = d[KEY]; if (c && typeof c === 'object') for (const [k, v] of Object.entries(c)) if (Array.isArray(v) && !mem.has(k)) mem.set(k, Promise.resolve(v));
    }).catch(() => {});
    return loaded;
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const out = {};
      const entries = [...mem.entries()].slice(-MAX);
      for (const [k, p] of entries) { const v = await p; if (Array.isArray(v)) out[k] = v; }
      chrome.storage.local.set({[KEY]: out}).catch(() => {});
    }, 1500);
  }
  function pump() {
    while (running < LANES && waiting.length) {
      const job = waiting.shift(); running++;
      fetch(`${API}?bvid=${job.bvid}`, {credentials: 'include'}).then(r => r.ok ? r.json() : null).then(j => {
        const tags = j?.code === 0 && Array.isArray(j.data) ? j.data.map(t => String(t?.tag_name || '').trim()).filter(Boolean).slice(0, 30) : null;
        job.resolve(tags);
        if (tags) persist(); else mem.delete(job.bvid); // A failure is retried next time, not cached.
      }).catch(() => { mem.delete(job.bvid); job.resolve(null); }).finally(() => { running--; pump(); });
    }
  }
  /** Tags of a video, or null when they could not be read (the card is then kept, never guessed). */
  async function get(bvid) {
    if (!/^BV[0-9A-Za-z]{10}$/.test(String(bvid))) return null;
    await load();
    if (mem.has(bvid)) { const p = mem.get(bvid); mem.delete(bvid); mem.set(bvid, p); return p; } // LRU order.
    const p = new Promise(resolve => waiting.push({bvid, resolve}));
    mem.set(bvid, p);
    while (mem.size > MAX) mem.delete(mem.keys().next().value);
    pump();
    return p;
  }
  /** Tags for many videos at once (resolves when all are known or failed). */
  const many = bvids => Promise.all(bvids.map(b => get(b).then(t => [b, t]))).then(Object.fromEntries);
  globalThis.__BTR_TAGS__ = {get, many};
})();
