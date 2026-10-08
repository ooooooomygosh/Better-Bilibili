"""Quick panel regression: real markup and CSS in Chromium with mocked chrome.* APIs."""
import json,pathlib,os
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
results=[]
def ok(name):results.append({'test':name,'passed':True});print('PASS',name,flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/lib/chromium/chromium'),headless=True,args=['--no-sandbox'])
 ctx=browser.new_context(viewport={'width':1400,'height':900})
 ctx.route('https://www.bilibili.com/**',lambda r:r.fulfill(status=200,content_type='text/html',body='<!doctype html><html><body style="margin:0;background:#fff"><h1>video</h1></body></html>'))
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('https://www.bilibili.com/video/BV1xx411c7mD/')
 for f in ['tests/browser-shim.js','src/home-core.js','src/focus-core.js']:page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("chromeMock.runtime.getManifest=()=>({version:'test'});window.sent=[];chromeMock.runtime.sendMessage=async m=>{sent.push(m.type);if(m.type==='focus-check')return {enabled:true,window:{seconds:2700,limit:5400,percent:50,resetAt:Date.now()+3600000,remaining:2700},week:{seconds:7200,limit:36000,percent:20,resetAt:Date.now()+86400000,remaining:28800},videos:3,videoLimit:0,snoozes:0};};0")
 page.evaluate("chromeMock.storage.sync.set({focusEnabled:true})")
 page.evaluate("code=>new Function('chrome',code)(window.chromeMock)",(ROOT/'src/quick-panel.js').read_text())
 q="document.getElementById('btr-quick').shadowRoot"
 page.wait_for_function(f"{q}?.querySelector('.fab')",timeout=5000)
 assert page.evaluate("document.documentElement.hasAttribute('data-btr-quick')")
 assert page.evaluate(f"{q}.querySelector('.fab .ring').style.display")!='none'
 ok('floating button mounts, shows the 5-hour usage ring and marks the page so the old launcher hides')
 page.wait_for_function(f"{q}.querySelector('.tip')",timeout=4000)
 page.evaluate(f"{q}.querySelector('.tip button').click()")
 assert page.evaluate("fixtureStorage.all.local.flowQuickTipSeen")==True
 ok('first-run hint appears once and is remembered when dismissed')
 page.keyboard.press('Alt+t');page.wait_for_function(f"{q}.querySelector('.panel')",timeout=3000)
 sel=page.evaluate(f"{q}.querySelector('.tabs [aria-selected=true]').textContent")
 assert sel=='油门',sel
 ok('Alt+T opens the panel on the tab that fits the page (油门 on a video page)')
 assert page.evaluate(f"[...{q}.querySelectorAll('.wide')].some(b=>b.textContent.includes('高级播放设置'))")
 page.evaluate(f"{q}.querySelector('#q-enabled').click()");page.wait_for_timeout(200)
 assert page.evaluate("fixtureStorage.all.sync.enabled")==False
 page.evaluate(f"[...{q}.querySelectorAll('.seg button')].find(b=>b.textContent==='海外').click()");page.wait_for_timeout(200)
 assert page.evaluate("fixtureStorage.all.sync.mode")=='overseas'
 assert page.evaluate(f"[...{q}.querySelectorAll('.seg button')].find(b=>b.textContent==='海外').getAttribute('aria-pressed')")=='true'
 ok('油门 tab: switch and segmented control write settings and re-render live')
 page.evaluate(f"[...{q}.querySelectorAll('.tabs button')].find(b=>b.textContent==='首页').click()");page.wait_for_timeout(200)
 page.evaluate(f"{q}.querySelector('#q-homeInfinite').click()");page.wait_for_timeout(250)
 assert page.evaluate("fixtureStorage.all.sync.homeInfinite")==True
 assert page.evaluate(f"[...{q}.querySelectorAll('.seg button')].map(b=>b.textContent).join(',')").startswith('12,24,36,稳,标准,快')
 page.evaluate(f"[...{q}.querySelectorAll('.seg button')].find(b=>b.textContent==='36').click()");page.wait_for_timeout(200)
 assert page.evaluate("fixtureStorage.all.sync.homeInfiniteSize")==36
 ok('首页 tab: turning on 无限下滑 reveals batch size and speed controls')
 page.evaluate(f"[...{q}.querySelectorAll('.tabs button')].find(b=>b.textContent==='刹车').click()");page.wait_for_timeout(300)
 assert page.evaluate(f"{q}.querySelectorAll('.meter').length")==2
 page.evaluate(f"[...{q}.querySelectorAll('.presets button')].find(b=>b.textContent.startsWith('自律')).click()");page.wait_for_timeout(200)
 assert page.evaluate("fixtureStorage.all.sync.focusWindowMinutes")==45 and page.evaluate("fixtureStorage.all.sync.focusWeeklyHours")==5
 assert page.evaluate(f"[...{q}.querySelectorAll('.presets button')].find(b=>b.textContent.startsWith('自律')).getAttribute('aria-pressed')")=='true'
 ok('刹车 tab: usage meters and presets apply and highlight')
 page.keyboard.press('Escape');page.wait_for_timeout(400)
 assert not page.evaluate(f"!!{q}.querySelector('.panel')")
 page.evaluate(f"{q}.querySelector('.fab').click()");page.wait_for_function(f"{q}.querySelector('.panel')",timeout=3000)
 page.mouse.click(200,400);page.wait_for_timeout(400)
 assert not page.evaluate(f"!!{q}.querySelector('.panel')")
 ok('Esc and outside clicks close the panel; the button reopens it')
 page.evaluate("chromeMock.storage.sync.set({quickFab:false})");page.wait_for_timeout(200)
 assert not page.evaluate(f"!!{q}.querySelector('.fab')")
 page.evaluate("__BTR_QUICK__.open('home')");page.wait_for_function(f"{q}.querySelector('.panel')",timeout=3000)
 ok('hiding the floating button keeps the panel reachable programmatically (popup / toolbar)')
 assert not errors,errors;ok('no uncaught errors')
 browser.close()
(ROOT/'tests/browser-quick-results.json').write_text(json.dumps({'scope':'Mocked chrome.* APIs; real panel markup and CSS in Chromium','results':results},ensure_ascii=False,indent=1))
print('TOTAL',len(results))
