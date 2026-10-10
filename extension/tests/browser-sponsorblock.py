"""空降助手 end-to-end: the unpacked extension in Chromium on a REAL Bilibili video page with a known
segment from bsbsb.top (BV1Yo3sz6EbG: sponsor 30.0–45.979 s). Also checks popup switch and welcome choice.
Run: python tests/browser-sponsorblock.py (needs network and Playwright's Chromium)."""
import json, os, pathlib, sys, tempfile, time
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
BV, START, END = os.environ.get('SB_BV', 'BV1Yo3sz6EbG'), 30.0, 45.979
results = []
def ok(n): results.append({'test': n, 'passed': True}); print('PASS', n, flush=True)
SR = "document.getElementById('btr-sb')?.shadowRoot"
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), channel='chromium', headless=True, viewport={'width': 1400, 'height': 900},
        args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'])
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker', timeout=15000)
    ext = sw.url.split('/')[2]
    for pg in list(ctx.pages):
        if 'welcome.html' in pg.url: welcome = pg
    # --- welcome asks, and respects the choice
    welcome = next((pg for pg in ctx.pages if 'welcome.html' in pg.url), None) or ctx.new_page()
    if 'welcome.html' not in welcome.url: welcome.goto(f'chrome-extension://{ext}/ui/welcome.html')
    welcome.wait_for_selector('#sbChoice button[data-sb="0"]')
    assert 'BilibiliSponsorBlock' in welcome.inner_text('#sbCard')
    welcome.click('#sbChoice button[data-sb="0"]'); welcome.wait_for_timeout(300)
    assert sw.evaluate("chrome.storage.sync.get(['sbEnabled','sbChosen'])") == {'sbEnabled': False, 'sbChosen': True}
    assert welcome.get_attribute('#sbChoice button[data-sb="0"]', 'aria-checked') == 'true'
    welcome.click('#sbChoice button[data-sb="1"]'); welcome.wait_for_timeout(300)
    assert sw.evaluate("chrome.storage.sync.get('sbEnabled')")['sbEnabled'] is True
    ok('first-install welcome introduces 空降助手, asks, and stores the choice (no / yes)')
    # --- real video page
    page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'https://www.bilibili.com/video/{BV}/', wait_until='domcontentloaded', timeout=60000)
    page.wait_for_function("Number(document.documentElement.dataset.btrSbSegments)>=1", timeout=45000)
    ok(f'segments fetched from bsbsb.top by hash prefix for {BV} (cid-matched)')
    page.wait_for_function("document.querySelector('.bpx-player-progress-schedule #btr-sb-bar .btr-sb-seg[data-category=sponsor]')", timeout=45000)
    left = page.evaluate("document.querySelector('#btr-sb-bar .btr-sb-seg').style.left")
    ok(f'progress-bar marker drawn inside B 站 progress bar (left={left})')
    page.wait_for_function("(()=>{const v=document.querySelector('.bpx-player-video-wrap video, video');return v&&v.readyState>=1&&v.duration>60})()", timeout=60000)
    page.evaluate(f"(()=>{{const v=document.querySelector('.bpx-player-video-wrap video, video');v.muted=true;v.currentTime={START+1};v.play().catch(()=>{{}});}})()")
    page.wait_for_function(f"document.querySelector('.bpx-player-video-wrap video, video').currentTime>={END-0.2}", timeout=20000)
    page.wait_for_function(f"{SR}?.querySelector('.toast [data-act=undo]')", timeout=5000)
    title = page.evaluate(f"{SR}.querySelector('.toast b').textContent")
    assert '赞助' in title, title
    # Styling comes from BiliThrottle tokens
    st = page.evaluate(f"(()=>{{const t={SR}.querySelector('.toast'),b={SR}.querySelector('.toast [data-act=undo]'),r={SR}.querySelector('.root');return {{tok:getComputedStyle(r).getPropertyValue('--btr-brand').trim(),font:getComputedStyle(t).fontFamily,radius:getComputedStyle(t).borderRadius}}}})()")
    assert st['tok'] == '#fb7299' and 'PingFang SC' in st['font'] and st['radius'] == '12px', st
    ok(f'auto-skipped sponsor segment; toast "{title}" uses BiliThrottle tokens ({st["tok"]}, {st["radius"]})')
    page.evaluate(f"{SR}.querySelector('.toast [data-act=undo]').click()")
    page.wait_for_timeout(1500)
    t = page.evaluate("document.querySelector('.bpx-player-video-wrap video, video').currentTime")
    assert START - 0.5 <= t < END - 1, t
    ok(f'undo returns to segment start and does not re-skip (t={t:.1f}s after 1.5 s)')
    # --- popup switch: instant, no reload
    popup = ctx.new_page(); popup.goto(f'chrome-extension://{ext}/ui/popup.html')
    popup.wait_for_selector('#sbEnabled'); assert popup.is_checked('#sbEnabled')
    assert popup.evaluate("getComputedStyle(document.querySelector('#sbEnabled').closest('.switch')).position") != ''
    popup.click('.sb-row .switch'); popup.wait_for_timeout(200)
    assert not popup.is_checked('#sbEnabled')
    page.wait_for_function("!document.getElementById('btr-sb-bar')", timeout=3000)
    ok('popup one-click switch turns 空降助手 off and markers vanish without reload')
    popup.click('.sb-row .switch')
    page.wait_for_function("document.getElementById('btr-sb-bar')", timeout=8000)
    ok('switching back on restores markers live')
    # dark mode follow
    page.evaluate("document.documentElement.classList.add('bili_dark')")
    errs = [e for e in errors if 'btr' in e.lower() or 'sponsor' in e.lower()]
    assert not errs, errs
    ok('no page errors from the feature')
    ctx.close()
(ROOT / 'tests/browser-sponsorblock-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=1))
print(f'{len(results)} passed')
