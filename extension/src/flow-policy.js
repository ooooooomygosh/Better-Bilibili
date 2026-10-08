/* BTR Flow additions, MIT. Pure policy + bounded, page-local playback telemetry. */
(function(root) {
  'use strict';
  const clamp = (n, a, b) => Math.min(b, Math.max(a, Number(n) || a));
  let context = {}, revision = 0, signature = '', lastVideo = null, lastQuality = null;
  const stalls = [], bytes = { received: 0, completed: 0, canceled: 0, errors: 0 };
  let recentSettings = {}, lastPublished = 0;
  function compute(settings = {}, c = {}) {
    const rate = clamp(c.rate || 1, .25, 4), bitrate = Math.max(0, Number(c.bitrate) || 0);
    const duration = Math.max(0, Number(c.duration) || 0);
    let name = '日常视频', ahead = 35, cap = 16, hedge = 1100;
    if (duration > 0 && duration <= 240) { name = '短视频'; ahead = 20; cap = 8; }
    if (c.height >= 2160 || bitrate >= 12000000) { name = duration > 0 && duration <= 240 ? '短视频 · 高码率 / 4K' : '高码率 / 4K'; ahead = duration > 0 && duration <= 240 ? 24 : 48; cap = 32; }
    else if (duration >= 1200) { name = '长视频'; ahead = 60; cap = 16; }
    const strategy = settings.strategy || 'auto';
    if (strategy === 'smooth') { ahead *= 1.4; name += ' · 稳播'; }
    if (strategy === 'fast') { ahead = Math.min(ahead, 24); hedge = 750; name += ' · 起播优先'; }
    if (strategy === 'economy' || c.saveData) { ahead = 12; cap = 4; hedge = 1800; name = '省流'; }
    if ((c.stalls || 0) >= 2 && strategy !== 'economy') { ahead *= 1.25; cap = Math.max(16, cap); name += ' · 抗抖动'; }
    if (c.hidden && c.paused) { ahead = Math.min(ahead, 10); cap = Math.min(cap, 4); name = '后台暂停'; }
    const budgetMB = clamp(settings.memoryBudgetMB || 64, 32, 128);
    // This is a target, NOT a browser-wide memory guarantee: in-flight ranges, audio,
    // decoder surfaces and the browser's own allocations also take space.
    const memorySeconds = bitrate ? budgetMB * 1024 * 1024 * 8 / bitrate / 1.4 : 90;
    const target = Math.max(8, Math.min(90, ahead * rate, memorySeconds));
    cap = Math.min(cap, clamp(settings.maxAutoThreads || 32, 4, 32));
    return { name, cap, ahead: Math.round(target), hedge, budgetMB,
      minChunk: strategy === 'economy' ? 128 * 1024 : 64 * 1024,
      window: strategy === 'economy' || (c.hidden && c.paused) ? 1 : 3,
      startupMax: strategy === 'fast' ? 4 : strategy === 'economy' ? 4 : 10,
      rangeTimeout: strategy === 'smooth' ? 90000 : 60000,
      decodeWarning: (c.droppedRatio || 0) > .03 && c.ahead > 5 };
  }
  function apply(settings) {
    recentSettings = settings;
    if (settings.smartPolicy === false) return settings;
    const p = compute(settings, context);
    return { ...settings, autoThreadCap: p.cap, bufferAheadSeconds: p.ahead,
      hedgeDelayMs: p.hedge, minChunkBytes: p.minChunk, prefetchWindow: p.window,
      startupMaxSeconds: p.startupMax, rangeTimeoutMs: p.rangeTimeout, flowProfile: p.name };
  }
  function observe(video, representation, extra = {}) {
    if (!video) return;
    const now = Date.now();
    const resource = String(extra.resource || representation?.baseUrl || representation?.base_url || '');
    if (video !== lastVideo || resource !== context.resource) {
      lastVideo = video; lastQuality = null;
      stalls.length = 0;
    }
    while (stalls.length && now - stalls[0] > 60000) stalls.shift();
    let droppedRatio = context.droppedRatio || 0;
    try {
      const q = video.getVideoPlaybackQuality?.();
      if (q && (!lastQuality || now - lastQuality.at >= 3000)) {
        const total = q.totalVideoFrames - (lastQuality?.total || 0);
        const dropped = q.droppedVideoFrames - (lastQuality?.dropped || 0);
        droppedRatio = total > 30 && dropped >= 0 ? dropped / total : 0;
        lastQuality = { at: now, total: q.totalVideoFrames, dropped: q.droppedVideoFrames };
      }
    } catch (_) {}
    context = { duration: Number(video.duration) || 0, rate: video.playbackRate,
      height: Number(representation?.height) || video.videoHeight || 0,
      bitrate: (Number(representation?.bandwidth) || 0) + (Number(extra.audioBitrate) || 192000),
      paused: video.paused, hidden: root.document?.hidden === true,
      saveData: root.navigator?.connection?.saveData === true, stalls: stalls.length,
      ahead: extra.ahead || 0, droppedRatio, resource };
    const key = JSON.stringify([context.duration,context.rate,context.height,context.bitrate,context.paused,context.hidden,context.saveData,context.stalls]);
    if (key !== signature) { signature = key; revision++; }
    if (now - lastPublished >= 1000 && root.postMessage && root.location?.origin !== 'null') {
      lastPublished = now;
      try { root.postMessage({channel: '__BTR_FLOW_V1__', type: 'telemetry', payload: {
        policy: recentSettings.smartPolicy === false ? {...compute(recentSettings, context),name:'原版策略（自适应已关闭）',cap:recentSettings.maxAutoThreads || 32,ahead:recentSettings.bufferAheadSeconds || 45} : compute(recentSettings, context), rate: context.rate, bitrate: context.bitrate,
        ahead: context.ahead, stalls: context.stalls, droppedRatio, ...bytes
      }}, root.location?.origin || '*'); } catch (_) { /* Diagnostics never interrupt playback. */ }
    }
  }
  function transfer(event) {
    if (event.phase === 'progress') bytes.received += Math.max(0, Number(event.bytes) || 0);
    if (event.phase === 'done') bytes.completed += Math.max(0, Number(event.totalBytes) || 0);
    if (event.phase === 'cancel') bytes.canceled += Math.max(0, Number(event.receivedBytes) || 0);
    if (event.phase === 'error') bytes.errors++;
  }
  root.document?.addEventListener('waiting', e => {
    if (e.target === lastVideo && !lastVideo.paused && !lastVideo.seeking && lastVideo.currentTime > 1) stalls.push(Date.now());
  }, true);
  root.__BTR_FLOW_POLICY__ = Object.freeze({compute, apply, observe, transfer, get revision() { return revision; }});
})(globalThis);
