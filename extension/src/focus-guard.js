/* BTR Flow focus mode — isolated world. Measures real playback time of the main player only
 * (hover previews and small inline players are ignored), reports it to the service worker, and
 * shows a gentle overlay when the daily limit or a Pomodoro break is reached.
 */
(function () {
  'use strict';
  const core = globalThis.__BTR_FOCUS_CORE__;
  if (!core || globalThis.__BTR_FLOW_FOCUS_LOADED__ || window.top !== window) return;
  globalThis.__BTR_FLOW_FOCUS_LOADED__ = true;

  const FLUSH_EVERY = 5, MIN_WIDTH = 320;
  const EASE = 'cubic-bezier(.2,.75,.25,1)';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let settings = core.settings({}), state = null, pending = 0, pendingId = null, currentId = null;
  let host = null, shadow = null, card = null, shownKind = '', countdown = null, dead = false;
  const warned = new Set();

  const send = msg => dead ? Promise.reject(new Error('dead')) : chrome.runtime.sendMessage(msg).catch(e => {
    if (/context invalidated/i.test(String(e?.message))) dead = true; // Extension was reloaded; old page script retires.
    throw e;
  });
  const mainVideos = () => [...document.querySelectorAll('video')].filter(v => v.offsetWidth >= MIN_WIDTH || document.fullscreenElement?.contains(v));
  const playing = () => mainVideos().some(v => !v.paused && !v.ended && v.readyState >= 2);
  const blocked = () => {
    const b = state?.block;
    if (!settings.focusEnabled || !b) return false;
    const end = b.until || b.resetAt; // A limit lifts by itself once its period resets.
    return !end || end > Date.now();
  };

  function pauseAll() {
    for (const v of mainVideos()) if (!v.paused) { try { v.pause(); } catch (_) {} }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  function apply(res) {
    if (!res || typeof res !== 'object') return;
    state = res;
    // Only playable pages are covered; search, dynamics and messages stay usable.
    if (blocked() && currentId) { pauseAll(); show(state.block.kind); }
    else if (shownKind && (shownKind !== 'break-done' || !currentId)) hide();
    if (settings.focusEnabled && res.remaining != null && !res.block) {
      for (const mins of [5, 1]) {
        if (res.remaining <= mins * 60 && res.remaining > 0 && !warned.has(mins)) {
          warned.add(mins); for (const m of [5, 1]) if (m >= mins) warned.add(m);
          const which = res.week.remaining != null && res.week.remaining <= res.remaining ? '本周' : '这 5 小时';
          toast(`${which}的额度还剩 ${Math.max(1, Math.ceil(res.remaining / 60))} 分钟`);
        }
      }
    }
  }

  function flush() {
    if (!pending || !pendingId) return;
    const msg = {type: 'focus-tick', seconds: pending, id: pendingId};
    pending = 0;
    send(msg).then(apply).catch(() => {});
  }

  function check() {
    if (!settings.focusEnabled) return;
    send({type: 'focus-check', id: currentId}).then(apply).catch(() => {});
  }

  setInterval(() => {
    if (dead || !settings.focusEnabled) return;
    const id = core.videoId(location.href);
    if (id !== currentId) { flush(); currentId = id; check(); }
    if (!id) return;
    if (state?.block && state.block.kind !== 'break' && !blocked()) { state = {...state, block: null}; hide(); warned.clear(); check(); }
    if (blocked()) { if (playing()) pauseAll(); renderCountdown(); return; }
    if (shownKind === 'break-done') return;
    if (!playing()) { flush(); return; }
    if (pendingId !== id) { flush(); pendingId = id; }
    if (++pending >= FLUSH_EVERY) flush();
  }, 1000);

  // Any attempt to start playback while blocked is undone; a new video is re-checked at once.
  document.addEventListener('play', e => {
    if (!settings.focusEnabled || !(e.target instanceof HTMLVideoElement)) return;
    if (blocked()) { e.target.pause(); if (currentId) show(state.block.kind); return; }
    if (e.target.offsetWidth >= MIN_WIDTH) { currentId = core.videoId(location.href); check(); }
  }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else check(); });
  window.addEventListener('pagehide', flush);

  /* ---------- overlay ---------- */
  const ui = globalThis.__BTR_UI__;
  const CSS = `
:host{all:initial}
${ui ? ui.scoped('.root') : ''}
*{box-sizing:border-box}
[hidden]{display:none!important}
.root{font:14px/1.6 var(--btr-font,-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif);color:var(--btr-text1)}
.backdrop{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:16px;background:rgba(10,12,18,.58);backdrop-filter:blur(8px) saturate(.9);-webkit-backdrop-filter:blur(8px) saturate(.9)}
.card{width:min(400px,100%);padding:28px 28px 22px;border-radius:20px;background:var(--btr-bg);color:var(--btr-text1);box-shadow:0 24px 64px rgba(0,0,0,.35);text-align:center}
.card:focus{outline:none}
.ring{position:relative;width:132px;height:132px;margin:2px auto 14px}
.ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.ring circle{fill:none;stroke-width:8}
.ring .track{stroke:var(--btr-soft)}
.ring .bar{stroke:var(--btr-brand);stroke-linecap:round;transition:stroke-dashoffset 1s linear}
.ring .value{position:absolute;inset:0;display:grid;place-items:center;font-size:28px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.icon{width:56px;height:56px;margin:0 auto 12px;border-radius:16px;display:grid;place-items:center;background:var(--btr-brand-soft);color:var(--btr-brand)}
h2{margin:0 0 6px;font-size:20px;line-height:1.35}
p{margin:0;color:var(--btr-text2);font-size:13.5px}
.reset{display:inline-block;margin:14px 0 2px;padding:4px 12px;border-radius:999px;background:var(--btr-brand-soft);color:var(--btr-brand-hover);font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums}
.root.dark .reset{color:var(--btr-brand)}
.meters{display:grid;gap:12px;margin:16px 0 0;text-align:left}
.meter-head{display:flex;justify-content:space-between;font-size:12px;color:var(--btr-text2)}.meter-head b{color:var(--btr-text1);font-variant-numeric:tabular-nums}
.meter{height:6px;margin:5px 0 3px;border-radius:999px;background:var(--btr-soft);overflow:hidden}.meter i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#ff9dbd,var(--btr-brand))}
.meter-row small{font-size:12px;color:var(--btr-text2)}
.actions{display:flex;flex-direction:column;gap:8px;margin-top:20px}
button{font:inherit;border:0;border-radius:12px;padding:10px 14px;cursor:pointer;transition:background-color var(--btr-fast) ease,transform var(--btr-fast) ease,opacity var(--btr-fast) ease}
button:active{transform:scale(.98)}
button:focus-visible{outline:2px solid var(--btr-brand);outline-offset:2px}
.primary{background:var(--btr-brand);color:#fff;font-weight:600}.primary:hover{background:var(--btr-brand-hover)}
.ghost{background:var(--btr-soft);color:var(--btr-text1)}.ghost:hover{background:var(--btr-soft2)}
.link{background:none;color:var(--btr-text2);font-size:12px;padding:4px}.link:hover{color:var(--btr-brand)}
.locknote{margin-top:12px;font-size:12px;color:var(--btr-text2)}
.pw{display:flex;gap:6px}
.pw input{flex:1;min-width:0;border:1px solid var(--btr-line);border-radius:12px;padding:9px 12px;background:var(--btr-bg);color:var(--btr-text1);font:inherit;font-size:13px}
.pw input:focus{outline:none;border-color:var(--btr-brand);box-shadow:0 0 0 3px var(--btr-brand-soft)}
.err{color:var(--btr-danger);font-size:12px;min-height:0;margin:6px 0 0}
.pw input[aria-invalid]{border-color:var(--btr-danger)}
.toast{position:fixed;left:50%;bottom:32px;z-index:2147483646;transform:translateX(-50%);padding:10px 18px;border-radius:999px;background:rgba(24,25,28,.92);color:#fff;font-size:13px;line-height:1.4;box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;
  const ICON = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6M12 2v3"/></svg>';
  const R = 58, C = 2 * Math.PI * R;

  function ensureHost() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = 'btr-flow-focus'; host.dataset.btrFlowOwned = '';
    shadow = host.attachShadow({mode: 'open'});
    const style = document.createElement('style'); style.textContent = CSS; shadow.append(style);
    const r = document.createElement('div'); r.className = 'root'; shadow.append(r);
    document.documentElement.append(host);
    // Follow B 站's own theme (it can differ from the OS setting), live.
    if (ui) ui.onTheme(dark => r.classList.toggle('dark', dark));
  }
  const layer = () => shadow.querySelector('.root');

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function btn(text, cls, fn) { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  function build(kind) {
    const s = state, strict = settings.focusStrict;
    const title = el('h2'), body = el('p'), actions = el('div', 'actions');
    const c = el('div', 'card'); c.setAttribute('role', 'alertdialog'); c.setAttribute('aria-modal', 'true'); c.tabIndex = -1;
    const locked = !!state?.locked, lockPw = !!state?.lockHasPassword;
    c.setAttribute('aria-describedby', 'btr-focus-body'); body.id = 'btr-focus-body';
    c.setAttribute('aria-labelledby', 'btr-focus-title'); title.id = 'btr-focus-title';
    if (kind === 'break') {
      const ring = el('div', 'ring');
      ring.innerHTML = `<svg viewBox="0 0 132 132" aria-hidden="true"><circle class="track" cx="66" cy="66" r="${R}"/><circle class="bar" cx="66" cy="66" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg>`;
      countdown = {bar: ring.querySelector('.bar'), value: el('div', 'value'), total: settings.focusBreakMinutes * 60000};
      ring.append(countdown.value); c.append(ring);
      title.textContent = '休息一下';
      body.textContent = `已经连续看了 ${settings.focusSessionMinutes} 分钟。看看远处、喝口水、活动一下肩颈，倒计时结束后再继续。`;
      if (!strict) actions.append(...snoozeControls('跳过这次休息', 'break', locked, lockPw));
    } else if (kind === 'break-done') {
      const icon = el('div', 'icon'); icon.innerHTML = ICON; c.append(icon);
      title.textContent = '休息结束';
      body.textContent = '油门重新可用，新一轮番茄钟开始计时。';
      actions.append(btn('继续观看', 'primary', () => { hide(); check(); }));
    } else {
      const icon = el('div', 'icon'); icon.innerHTML = ICON; c.append(icon);
      if (kind === 'window') {
        title.textContent = '这 5 小时的额度用完啦';
        body.textContent = `这一轮已经看了 ${core.fmt(s.window.seconds)}。B 站不会跑掉，去喝口水、走两步，额度到点自动回来。`;
      } else if (kind === 'week') {
        title.textContent = '本周额度见底了';
        body.textContent = `这周已经看了 ${core.fmt(s.week.seconds)}。剩下的好视频，留给下周的你。`;
      } else {
        title.textContent = '这一轮的视频数量到了';
        body.textContent = `已经看了 ${s.videos} 个视频。正在看的可以看完，新视频要等额度重置。`;
      }
      const meters = el('div', 'meters');
      const row = (label, m) => {
        const r = el('div', 'meter-row'), head = el('div', 'meter-head');
        head.append(el('span', null, label), el('b', null, m.limit ? `${m.percent}%` : core.fmt(m.seconds)));
        const bar = el('div', 'meter'), fill = el('i'); fill.style.width = `${m.limit ? m.percent : 0}%`; bar.append(fill);
        r.append(head, bar, el('small', null, `${core.fmtReset(m.resetAt)} 重置`)); meters.append(r);
      };
      row('当前 5 小时窗口', s.window);
      if (s.week.limit) row('本周额度', s.week);
      countdown = {reset: el('div', 'reset'), at: state.block.resetAt};
      actions.append(btn('离开 B 站', 'primary', () => send({type: 'focus-close-tab'}).catch(() => {})));
      if (!strict) actions.append(...snoozeControls(kind === 'videos' ? '再看 1 个' : `再看 ${core.SNOOZE_SECONDS / 60} 分钟`, kind, locked, lockPw));
      c.append(title, body, countdown.reset, meters, actions);
      if (locked) actions.before(el('p', 'locknote', lockPw ? '🔒 自律锁开启中：再看需要输入密码。' : '🔒 自律锁开启中：额度到点自动恢复。'));
    }
    if (!c.contains(title)) c.append(title, body, actions);
    actions.append(btn(locked ? '查看自律锁' : '调整节流阀设置', 'link', () => send({type: 'flow-open-options', hash: locked ? 'lock' : 'focus'}).catch(() => {})));
    return c;
  }

  function show(kind) {
    if (kind === shownKind) return;
    ensureHost();
    const old = layer().querySelector('.backdrop');
    const wrap = el('div', 'backdrop'); card = build(kind); wrap.append(card);
    shownKind = kind;
    if (old) old.replaceWith(wrap); else {
      layer().append(wrap);
      if (!reduced.matches) {
        wrap.animate([{opacity: 0}, {opacity: 1}], {duration: 240, easing: 'ease-out'});
        card.animate([{opacity: 0, transform: 'translateY(12px) scale(.96)'}, {opacity: 1, transform: 'none'}], {duration: 320, easing: EASE});
      }
    }
    renderCountdown();
    // Focus the dialog, never "离开 B 站": a stray Space / Enter meant for the player must not close the tab.
    if (kind === 'break-done') card.querySelector('.primary')?.focus({preventScroll: true});
    else card.focus({preventScroll: true});
  }

  function hide() {
    const wrap = shadow?.querySelector('.backdrop');
    shownKind = ''; countdown = null;
    if (!wrap) return;
    if (reduced.matches) { wrap.remove(); return; }
    wrap.querySelector('.card')?.animate([{opacity: 1, transform: 'none'}, {opacity: 0, transform: 'translateY(8px) scale(.98)'}], {duration: 180, easing: 'ease-in', fill: 'forwards'});
    wrap.animate([{opacity: 1}, {opacity: 0}], {duration: 200, easing: 'ease-in', fill: 'forwards'}).finished.then(() => wrap.remove(), () => wrap.remove());
  }

  function renderCountdown() {
    if (!countdown || !state?.block) return;
    if (countdown.reset) { countdown.reset.textContent = `距离重置还有 ${core.fmtLeft(countdown.at - Date.now())}`; return; }
    if (state.block.kind !== 'break') return;
    const left = state.block.until - Date.now();
    countdown.value.textContent = mmss(left);
    countdown.bar.setAttribute('stroke-dashoffset', String(C * (1 - Math.max(0, left) / countdown.total)));
    if (left <= 0) { state = {...state, block: null}; show('break-done'); }
  }

  function snooze(kind, password, err, input) {
    send({type: 'focus-snooze', kind, password}).then(res => {
      if (res?.error) {
        if (err) { err.textContent = res.error; err.hidden = false; }
        if (input) {
          input.setAttribute('aria-invalid', 'true'); input.focus();
          if (!reduced.matches) input.animate([{transform: 'translateX(0)'}, {transform: 'translateX(-6px)'}, {transform: 'translateX(5px)'}, {transform: 'translateX(-3px)'}, {transform: 'translateX(0)'}], {duration: 320, easing: 'ease-out'});
        }
        return;
      }
      warned.clear(); apply(res); if (!res?.block) hide();
    }).catch(() => {});
  }
  // Snooze buttons; under a password lock they open a password field first.
  function snoozeControls(label, kind, locked, lockPw) {
    if (!locked) return [btn(label, 'ghost', () => snooze(kind))];
    if (!lockPw) return [];
    const form = el('form', 'pw'), input = el('input'), err = el('p', 'err'); err.hidden = true; form.hidden = true;
    input.type = 'password'; input.placeholder = '自律锁密码'; input.autocomplete = 'off'; input.setAttribute('aria-label', '自律锁密码');
    const go = btn('确认', 'ghost', null); go.type = 'submit';
    form.append(input, go);
    form.addEventListener('submit', e => { e.preventDefault(); if (!input.value) { input.focus(); return; } snooze(kind, input.value, err, input); input.value = ''; });
    input.addEventListener('input', () => { err.hidden = true; input.removeAttribute('aria-invalid'); });
    input.setAttribute('aria-describedby', 'btr-pw-err'); err.id = 'btr-pw-err'; err.setAttribute('role', 'alert');
    const open = btn(`${label}（需要密码）`, 'ghost', () => { open.hidden = true; form.hidden = false; input.focus(); });
    return [open, form, err];
  }

  let toastTimer;
  function toast(text) {
    ensureHost();
    layer().querySelector('.toast')?.remove(); clearTimeout(toastTimer);
    const t = el('div', 'toast', text); t.setAttribute('role', 'status'); layer().append(t);
    if (!reduced.matches) t.animate([{opacity: 0, transform: 'translate(-50%,12px)'}, {opacity: 1, transform: 'translate(-50%,0)'}], {duration: 260, easing: EASE});
    toastTimer = setTimeout(() => {
      if (reduced.matches) return t.remove();
      t.animate([{opacity: 1}, {opacity: 0}], {duration: 220, fill: 'forwards'}).finished.then(() => t.remove(), () => t.remove());
    }, 4500);
  }

  // Keyboard focus stays inside the dialog while it is open.
  document.addEventListener('keydown', e => {
    if (!shownKind || !card) return;
    if (e.key === 'Tab') {
      const items = [...card.querySelectorAll('button,input')].filter(n => !n.closest('[hidden]')); if (!items.length) return;
      const i = items.indexOf(shadow.activeElement);
      e.preventDefault(); items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
    } else if (blocked() && (e.key === ' ' || e.key === 'k' || e.key === 'Enter') && (!card.contains(shadow.activeElement) || shadow.activeElement === card)) {
      e.preventDefault(); e.stopImmediatePropagation(); // Do not let the player's shortcuts resume playback.
    }
  }, true);

  chrome.storage.sync.get(core.defaults).then(s => { settings = core.settings(s); check(); }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !Object.keys(core.defaults).some(k => changes[k])) return;
    const next = {...settings};
    for (const k of Object.keys(core.defaults)) if (changes[k]) next[k] = changes[k].newValue;
    settings = core.settings(next); warned.clear();
    if (!settings.focusEnabled) { state = null; hide(); } else check();
  });
})();
