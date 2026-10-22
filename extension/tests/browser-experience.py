"""Installed MV3 tests for modes, public comment regions and the settings UI.
The browser has a fresh profile. Bilibili responses are local fixtures; no account is used.
"""
import json, os, pathlib, tempfile
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
results = []
def ok(name):
    results.append({'test': name, 'passed': True}); print('PASS', name, flush=True)

HOME = '''<!doctype html><html><body><header style="height:64px">B 站测试页</header>
<main class="bili-feed4"><div class="recommended-container_floor-aside"><div class="container"><div class="feed-card">原来的推荐</div></div></div></main></body></html>'''
VIDEO = '''<!doctype html><html><body><div class="bpx-player-container" style="width:800px;height:250px">播放器区域</div>
<aside class="recommend-list-v1">相关推荐</aside><div id="comment"><bili-comments></bili-comments></div>
<script>
const host=document.querySelector('bili-comments');const root=host.attachShadow({mode:'open'});
const reply=document.createElement('bili-comment-renderer');root.append(reply);reply.__data={reply_control:{location:'IP属地：浙江'}};
reply.attachShadow({mode:'open'}).innerHTML='<div id="info"><span>昨天</span></div>';
window.reply=reply;window.commentRoot=root;
</script></body></html>'''

with sync_playwright() as p, tempfile.TemporaryDirectory() as profile:
    exe = os.environ.get('CHROMIUM_PATH') or None
    ctx = p.chromium.launch_persistent_context(profile, executable_path=exe, channel=None if exe else 'chromium', headless=True,
        args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'], viewport={'width':1280, 'height':900})
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
    eid = sw.url.split('/')[2]
    initial = {'enabled':False, 'sbEnabled':False, 'statsEnabled':False, 'focusEnabled':True, 'focusStrict':True,
               'focusWindowMinutes':15, 'homeInfinite':True, 'homeModeChosen':True, 'homePreview':'video', 'sceneMode':'normal'}
    sw.evaluate('s=>chrome.storage.sync.set(s)', initial)
    # Public site fixtures only; a content script must not request location services.
    requests = []
    def route(r):
        requests.append(r.request.url)
        if r.request.resource_type == 'document' and r.request.url.startswith('https://www.bilibili.com/'):
            r.fulfill(content_type='text/html; charset=utf-8', body=VIDEO if '/video/' in r.request.url else HOME)
        else:
            r.fulfill(content_type='application/json', body='{"code":0,"data":{"item":[]}}')
    ctx.route('https://**/*', route)
    errors = []
    home = ctx.new_page(); home.on('pageerror', lambda e: errors.append(str(e))); home.goto('https://www.bilibili.com/')
    options = ctx.new_page(); options.on('pageerror', lambda e: errors.append(str(e))); options.goto(f'chrome-extension://{eid}/ui/options.html')
    options.wait_for_selector('[data-scene-mode="study"]')
    # Activate through the real UI and establish a lock to check that modes do not change it.
    locked = options.evaluate("chrome.runtime.sendMessage({type:'lock-create',cooldownHours:1})")
    assert locked['locked'], locked
    approved = sw.evaluate("chrome.storage.local.get('focusLock').then(s=>s.focusLock.approved)")
    options.click('[data-scene-mode="study"]')
    home.wait_for_selector('#btr-scene-hub')
    assert home.locator('.recommended-container_floor-aside').is_hidden()
    assert home.locator('#btr-flow-feed').count() == 0
    assert home.locator('#btr-scene-hub h1').inner_text() == '今天，想学会什么？'
    assert home.locator('#btr-scene-hub a').count() == 6
    home.locator('#btr-scene-hub input').fill('线性代数')
    with home.expect_navigation(): home.locator('#btr-scene-hub button[type=submit]').click()
    assert home.url == 'https://search.bilibili.com/all?keyword=%E7%BA%BF%E6%80%A7%E4%BB%A3%E6%95%B0', home.url
    home.goto('https://www.bilibili.com/zh-Hans'); home.wait_for_selector('#btr-scene-hub')
    ok('学习模式以课程搜索入口替换推荐，停止本扩展无限下滑，搜索正确编码')
    video = ctx.new_page(); video.on('pageerror', lambda e: errors.append(str(e))); video.goto('https://www.bilibili.com/video/BV1xx411c7mD/')
    video.wait_for_selector('#btr-scene-badge')
    assert video.locator('.recommend-list-v1').is_hidden(); assert video.locator('#comment').is_hidden()
    options.check('#sceneStudyComments'); video.wait_for_function("!document.documentElement.hasAttribute('data-btr-scene-comments')")
    assert video.locator('#comment').is_visible()
    video.bring_to_front()
    video.wait_for_function("reply.shadowRoot.querySelector('.btr-comment-location')?.textContent==='IP属地：浙江'")
    ok('学习视频收起相关推荐；可独立恢复评论，现代 Shadow DOM 评论显示公开属地')
    options.click('[data-scene-mode="food"]')
    home.wait_for_function("document.querySelector('#btr-scene-hub')?.shadowRoot.textContent.includes('今天，想吃点什么？')")
    assert home.locator('#btr-scene-hub a').first.inner_text() == '家常菜教程'
    assert video.locator('#comment').is_visible(); assert video.locator('.recommend-list-v1').is_hidden()
    current = sw.evaluate('chrome.storage.sync.get(null)')
    for key in ['homeInfinite','homePreview','focusEnabled','focusStrict','focusWindowMinutes']:
        assert current[key] == initial[key], (key, current[key])
    assert sw.evaluate("chrome.storage.local.get('focusLock').then(s=>s.focusLock.approved)") == approved
    ok('美食入口与评论正常；场景切换不改个人首页设置、额度或自律锁')
    video.locator('#btr-scene-badge button').click()
    video.wait_for_function("!document.documentElement.hasAttribute('data-btr-scene-video')")
    assert video.locator('.recommend-list-v1').is_visible(); assert video.locator('#comment').is_visible()
    home.wait_for_function("!document.querySelector('#btr-scene-hub')")
    assert home.locator('.recommended-container_floor-aside').is_visible()
    ok('退出模式恢复原首页与视频布局，并同步所有已打开页面')
    # A renderer reused by the site must never retain the previous author's region.
    video.evaluate("reply.__data={reply_control:{location:'IP属地：上海'}}")
    video.wait_for_function("reply.shadowRoot.querySelector('.btr-comment-location')?.textContent==='IP属地：上海'")
    video.evaluate("reply.__data={reply_control:{}}")
    video.wait_for_function("!reply.shadowRoot.querySelector('.btr-comment-location')")
    # A delayed shadow root and a nested reply must be discovered after insertion.
    video.evaluate("window.sub=document.createElement('bili-comment-reply-renderer');commentRoot.append(sub)")
    video.wait_for_timeout(100)
    video.evaluate("sub.__data={reply_control:{location:'广东'}};sub.attachShadow({mode:'open'}).innerHTML='<div id=info>今天</div>'")
    video.wait_for_function("sub.shadowRoot.querySelector('.btr-comment-location')?.textContent==='IP属地：广东'")
    # If the site later provides its own visible location, our duplicate disappears.
    video.evaluate("sub.shadowRoot.querySelector('#info').insertAdjacentHTML('beforeend','<span id=location>IP属地：广东</span>')")
    video.wait_for_function("!sub.shadowRoot.querySelector('.btr-comment-location')")
    video.evaluate("sub.shadowRoot.querySelector('#location').remove()")
    video.wait_for_function("!!sub.shadowRoot.querySelector('.btr-comment-location')")
    options.uncheck('#commentLocation'); video.wait_for_function("!sub.shadowRoot.querySelector('.btr-comment-location')")
    options.check('#commentLocation'); video.bring_to_front(); video.wait_for_function("!!sub.shadowRoot.querySelector('.btr-comment-location')")
    assert not any('ipinfo' in url or 'ip-api' in url or 'reply' in url for url in requests), requests
    ok('属地支持延迟加载 / 子评论 / 节点复用 / 原生去重；关闭即时清理，没有属地查询请求')
    assert options.locator('#sbCat_jumpscare').input_value() == 'auto'
    assert options.locator('#sbCat_jumpscare option:checked').inner_text() == '自动静音'
    assert options.locator('#episodeEnabled').is_checked()
    popup = ctx.new_page(); popup.on('pageerror', lambda e: errors.append(str(e))); popup.goto(f'chrome-extension://{eid}/ui/popup.html')
    popup.click('[data-scene-mode="study"]'); options.wait_for_function("document.querySelector('[data-scene-mode=study]').getAttribute('aria-pressed')==='true'")
    for page in [options, popup]:
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    if os.environ.get('SHOTS') == '1':
        home.screenshot(path=str(ROOT.parent/'docs/media/study-mode.png'), full_page=True)
        options.locator('#scene').screenshot(path=str(ROOT.parent/'docs/media/scene-settings.png'))
    assert not errors, errors
    ok('弹窗 / 设置页同步场景状态，新分类与剧集开关可用；无未捕获异常或横向溢出')
    ctx.close()
(ROOT / 'tests/browser-experience-results.json').write_text(json.dumps({'environment': 'Unpacked MV3 in fresh Chromium profile; routed Bilibili fixtures', 'results': results}, ensure_ascii=False, indent=2))
print('TOTAL', len(results))
