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
 ctx.route('https://s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/**',lambda r:r.fulfill(status=200,content_type='text/css',body=':root{--bg1:#17181A}body{background:#17181a}' if '/dark' in r.request.url else ':root{--bg1:#FFFFFF}body{background:#fff}'))
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('https://www.bilibili.com/video/BV1xx411c7mD/')
 page.add_script_tag(content=(ROOT/'tests/browser-shim.js').read_text())
 page.evaluate("window.chrome=window.chromeMock;0")  # as in the isolated world: ui-kit sees chrome.storage
 for f in ['src/ui-kit.js','src/home-core.js','src/focus-core.js']:page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("chromeMock.runtime.getManifest=()=>({version:'test'});window.sent=[];chromeMock.runtime.sendMessage=async m=>{sent.push(m.type);if(m.type==='focus-check')return {enabled:true,window:{seconds:2700,limit:5400,percent:50,resetAt:Date.now()+3600000,remaining:2700},week:{seconds:7200,limit:36000,percent:20,resetAt:Date.now()+86400000,remaining:28800},videos:3,videoLimit:0,snoozes:0};if(m.type==='lock-state')return window.lockView;if(m.type==='focus-set'){if(window.lockView.locked){const d={};for(const k of Object.keys(m.changes))d[k]=Date.now()+86400000;window.lockView.pending=Object.fromEntries(Object.entries(m.changes).map(([k,v])=>[k,{value:v,requestedAt:Date.now(),effectiveAt:d[k]}]));return {applied:{},deferred:d,lock:window.lockView};}await chromeMock.storage.sync.set(m.changes);return {applied:m.changes,deferred:{}};}if(m.type==='lock-cancel'){delete window.lockView.pending[m.key];return {ok:true};}};window.lockView={locked:false};0")
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
 page.evaluate("(()=>{const i=document.createElement('input');i.id='typing';document.body.append(i);i.focus();})()")
 page.keyboard.press('Alt+t');page.wait_for_timeout(300)
 assert not page.evaluate(f"!!{q}.querySelector('.panel')")
 page.evaluate("document.getElementById('typing').blur()")
 ok('Alt+T is ignored while typing in an input')
 page.keyboard.press('Alt+t');page.wait_for_function(f"{q}.querySelector('.panel')",timeout=3000)
 sel=page.evaluate(f"{q}.querySelector('.tabs [aria-selected=true]').textContent")
 assert sel=='油门',sel
 ok('Alt+T opens the panel on the tab that fits the page (油门 on a video page)')
 page.evaluate(f"{q}.querySelector('.tabs [aria-selected=true]').focus()");page.keyboard.press('ArrowLeft');page.wait_for_timeout(150)
 assert page.evaluate(f"{q}.querySelector('.tabs [aria-selected=true]').textContent")=='首页'
 assert page.evaluate(f"{q}.activeElement?.textContent")=='首页'
 assert page.evaluate(f"[...{q}.querySelectorAll('.tabs [role=tab]')].map(b=>b.tabIndex).join()")=='-1,0,-1'
 assert page.evaluate(f"!!{q}.getElementById({q}.querySelector('.tabs [aria-selected=true]').getAttribute('aria-controls'))")
 page.keyboard.press('ArrowRight');page.wait_for_timeout(150)
 assert page.evaluate(f"{q}.querySelector('.tabs [aria-selected=true]').textContent")=='油门'
 ok('tabs are keyboard-navigable (arrows, roving tabindex, aria-controls)')
 page.evaluate(f"[...{q}.querySelectorAll('.tabs button')].find(b=>b.textContent==='刹车').click()");page.wait_for_timeout(400)
 anim=page.evaluate(f"(()=>{{[...{q}.querySelectorAll('.tabs button')].find(b=>b.textContent==='油门').click();return {q}.querySelector('.panel').getAnimations().some(a=>a.effect.getKeyframes().some(k=>'height' in k))}})()")
 assert anim
 page.wait_for_timeout(400)
 assert page.evaluate(f"getComputedStyle({q}.querySelector('.panel')).zIndex")=='1001'
 ok('switching tabs glides the panel height; the panel sits under B 站 header popovers (z-index 1001)')
 R=f"{q}.querySelector('.root').classList.contains('dark')"
 assert not page.evaluate(R)
 page.evaluate("document.documentElement.classList.add('bili_dark')");page.wait_for_function(R,timeout=2000)
 page.evaluate("document.documentElement.classList.remove('bili_dark')");page.wait_for_function(f"!{R}",timeout=2000)
 ok('homepage-style switch (html.bili_dark) flips the open panel live, both ways')
 page.evaluate("(()=>{const l=document.createElement('link');l.rel='stylesheet';l.id='th';l.href='https://s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/light.css';document.head.append(l);})()");page.wait_for_timeout(400)
 assert not page.evaluate(R)
 page.evaluate("document.getElementById('th').href='https://s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/dark.css'");page.wait_for_function(R,timeout=2500)
 page.evaluate("document.getElementById('th').href='https://s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/light.css'");page.wait_for_function(f"!{R}",timeout=2500)
 page.evaluate("document.getElementById('th').remove()")
 ok('video-page-style switch (bili-theme stylesheet href swap) flips the open panel live, both ways')
 page.evaluate("document.documentElement.classList.add('bili_dark')");page.wait_for_function("fixtureStorage.all.local.biliTheme?.dark===true",timeout=2500)
 page.evaluate("document.documentElement.classList.remove('bili_dark')");page.wait_for_function("fixtureStorage.all.local.biliTheme?.dark===false",timeout=2500)
 ok('the detected B 站 theme is recorded in storage.local (biliTheme) for the extension pages to follow')
 # 完整设置: a just-woken service worker may drop the first request; one real click must still get through.
 page.evaluate("window.optSent=0;const o2=chromeMock.runtime.sendMessage;chromeMock.runtime.sendMessage=async m=>{if(m.type==='flow-open-options'){optSent++;return optSent===1?undefined:{ok:true};}return o2(m);};0")
 fb=page.evaluate(f"(()=>{{const r=[...{q}.querySelectorAll('.foot button')].find(b=>b.textContent==='完整设置').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]}})()")
 page.mouse.click(*fb);page.wait_for_function("optSent===2",timeout=4000);page.wait_for_timeout(200)
 assert page.evaluate("optSent")==2 and page.evaluate(f"!{q}.querySelector('.toast')||!{q}.querySelector('.toast').textContent.includes('没能打开')")
 ok('完整设置 works on the first click: waits for the service worker answer and retries once when it is dropped')
 # A translucent B 站 header popover over the panel: the panel fades out, and back when it closes.
 page.evaluate("""(()=>{const h=document.createElement('div');h.className='bili-header__bar';h.style.cssText='position:fixed;top:0;left:0;right:0;height:64px;z-index:1002;background:#fff';
  const a=document.createElement('div');a.id='av';a.style.cssText='position:absolute;right:20px;top:10px;width:40px;height:40px';
  const pop=document.createElement('div');pop.className='v-popover';pop.style.cssText='position:fixed;right:10px;top:64px;width:360px;height:800px;display:none;background:rgba(255,255,255,.6);backdrop-filter:blur(10px)';
  h.append(a,pop);document.body.append(h);})();0""")
 panelOp=f"getComputedStyle({q}.querySelector('.panel')).opacity"
 page.mouse.move(*fb);page.wait_for_timeout(100)
 page.hover('#av');page.evaluate("document.querySelector('.v-popover').style.display='block'");page.wait_for_function(f"{q}.querySelector('.panel').classList.contains('veiled')",timeout=2000);page.wait_for_timeout(350)
 assert float(page.evaluate(panelOp))<.05,page.evaluate(panelOp)
 page.evaluate("document.querySelector('.v-popover').style.display='none'");page.mouse.move(200,500);page.wait_for_function(f"!{q}.querySelector('.panel').classList.contains('veiled')",timeout=2000);page.wait_for_timeout(350)
 assert page.evaluate(panelOp)=='1'
 page.evaluate("document.querySelector('.bili-header__bar').remove()")
 ok('a B 站 header popover over the panel fades the panel out smoothly, and it comes back when the popover closes')
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
 page.evaluate(f"window.keepMeter={q}.querySelector('.meter')")
 page.evaluate("chromeMock.storage.sync.set({quality:80})");page.wait_for_timeout(250)
 assert page.evaluate(f"window.keepMeter==={q}.querySelector('.meter')")
 ok('unrelated storage changes patch the panel in place instead of rebuilding it')
 page.evaluate("window.lockView={locked:true,hasPassword:false,cooldownHours:24,pending:{},approved:{}}")
 page.keyboard.press('Escape');page.wait_for_timeout(400)
 page.evaluate("__BTR_QUICK__.open('brake')");page.wait_for_function(f"{q}.querySelector('.panel')",timeout=3000)
 page.evaluate(f"[...{q}.querySelectorAll('.presets button')].find(b=>b.textContent.startsWith('适中')).click()");page.wait_for_timeout(400)
 assert page.evaluate("fixtureStorage.all.sync.focusWindowMinutes")==45
 assert page.evaluate(f"[...{q}.querySelectorAll('button')].some(b=>b.textContent==='撤销')"),page.evaluate(f"{q}.querySelector('.panel').innerText")
 ok('with the self-discipline lock on, loosening presets are deferred and listed with an undo button')
 page.evaluate("window.lockView.hasPassword=true;const o=chromeMock.runtime.sendMessage;chromeMock.runtime.sendMessage=async m=>m.type==='focus-set'&&m.password?(m.password==='right'?{applied:{},deferred:{}}:{error:'密码不对（还可以再试 4 次）。'}):o(m);0")
 page.keyboard.press('Escape');page.wait_for_timeout(400);page.evaluate("__BTR_QUICK__.open('brake')");page.wait_for_function(f"{q}.querySelector('.lock form input')",timeout=3000)
 page.evaluate(f"(()=>{{const i={q}.querySelector('.lock form input');i.value='wrong';{q}.querySelector('.lock form').requestSubmit();}})()");page.wait_for_timeout(400)
 e=page.evaluate(f"(()=>{{const e={q}.querySelector('.lock .pwerr');return e&&!e.hidden&&e.textContent}})()")
 assert e and '密码不对' in e,e
 assert page.evaluate(f"{q}.querySelector('.lock form input').getAttribute('aria-invalid')")=='true'
 page.evaluate("window.lockView={locked:false}")
 ok('wrong lock password shows inline right under the field (aria-invalid), the form stays put')
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
