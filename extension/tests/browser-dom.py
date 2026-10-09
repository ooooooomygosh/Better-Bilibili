"""Local Chromium DOM regression with explicitly mocked Chrome APIs.
Not an installed-extension or logged-in Bilibili E2E test. The renderer uses set_content
and an explicit fixture location/Chrome API shim; image requests are fulfilled locally.
"""
import json,pathlib,os,re
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
results=[]
def ok(name):
 results.append({'test':name,'passed':True});print('PASS',name,flush=True)
def script(page,name):page.add_script_tag(content=(ROOT/name).read_text())
def fill(route):
 n=int(re.search(r'fixture-(\d+)',route.request.url).group(1));colors=['#4e6e80','#6c8155','#77647f','#756249','#476d69']
 svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="{colors[n%5]}"/><text x="30" y="175" fill="#fff" font-family="sans-serif" font-size="94" opacity=".65">{n+1:02d}</text></svg>'
 route.fulfill(status=200,content_type='image/svg+xml',body=svg)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/lib/chromium/chromium'),headless=True,args=['--no-sandbox'])
 ctx=browser.new_context(viewport={'width':1704,'height':864},device_scale_factor=1)
 ctx.route('https://www.bilibili.com/**',lambda r:r.fulfill(status=200,content_type='text/html',body=(ROOT/'tests/home-fixture.html').read_text()))
 ctx.route('https://i0.hdslb.com/**',fill)
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.set_content((ROOT/'tests/home-fixture.html').read_text())
 script(page,'tests/browser-shim.js');script(page,'src/home-core.js')
 page.evaluate("window.fixtureLocation={pathname:'/',origin:'https://www.bilibili.com',href:'https://www.bilibili.com/',reload:()=>{throw Error('unexpected reload')}}")
 page.evaluate("document.querySelectorAll('img').forEach((img,i)=>{img.src='data:image/svg+xml;base64,'+btoa('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"480\" height=\"270\"><rect width=\"480\" height=\"270\" fill=\"#4e6e80\"/></svg>')})")
 # Simulate 1.0 settings. The new page must use native theme without waiting for a service worker migration.
 page.evaluate("chromeMock.storage.sync.set({homeTheme:'dark'})")
 page.evaluate("code=>new Function('chrome','location','crypto',code)(window.chromeMock,window.fixtureLocation,{randomUUID:()=> 'fixture-tab-1234567890'})",(ROOT/'src/home-enhancer.js').read_text())
 bar=page.locator('#btr-flow-toolbar')
 def label(text):page.wait_for_function("t=>document.querySelector('#btr-flow-toolbar')?.shadowRoot.querySelector('.count')?.textContent===t",arg=text,timeout=12000)
 def snapshots():return page.evaluate("Object.values(fixtureStorage.all.local).find(v=>v?.snapshots)?.snapshots || []")
 label('1 / 1');page.wait_for_timeout(350);assert len(snapshots())==1
 ok('initial stable batch is saved once')
 assert page.locator('.feed-card:visible').count()==10
 assert not page.locator('.recommended-swipe').is_visible()
 rects=page.locator('.feed-card').evaluate_all('(items)=>items.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y}))')
 assert len(set(r['y'] for r in rects[:5]))==1 and len(set(r['y'] for r in rects[5:]))==1
 assert abs(rects[0]['x']-rects[5]['x'])<1
 ok('carousel footprint and legacy nth-child margins removed; ten populated cards fill two native rows')
 assert page.evaluate("getComputedStyle(document.body).backgroundColor")=='rgb(24, 24, 27)'
 assert not page.evaluate("document.documentElement.hasAttribute('data-btr-oled')")
 ok('old forced dark setting migrates to native; native dark colors are not overwritten')
 assert page.evaluate("getComputedStyle(document.querySelector('#btr-flow-toolbar')).position")=='static'
 bb=bar.bounding_box();feed=page.locator('.container').bounding_box();assert bb['y']+bb['height']<=feed['y']+1
 assert page.locator('.bili-header__banner').bounding_box()['height']==154
 ok('toolbar is inline, not a bottom overlay; seasonal banner and navigation remain')
 page.locator('.bili-video-card').first.hover();page.locator('.watch-later').first.click();assert page.evaluate('nativeClicks')==1
 ok('native hover control retains its original event listener')
 page.evaluate("const b=document.querySelector('#btr-flow-toolbar').shadowRoot.querySelector('.refresh');b.click();b.click();b.click();")
 assert page.evaluate('refreshCalls')==1;assert bar.get_by_role('button',name='← 上一批').is_disabled();label('2 / 2')
 ok('three synchronous refresh clicks invoke the native action exactly once')
 page.evaluate('window.savedNativeCard=document.querySelector(".bili-video-card")')
 bar.get_by_role('button',name='← 上一批').click()
 assert page.locator('#btr-flow-history .card').count()==10
 assert '第 1 批' in page.locator('#btr-flow-history .title').first.inner_text()
 assert page.locator('.container').count()==1 and not page.locator('.container').is_visible()
 assert page.locator('.bili-header__bar').is_visible()
 ok('previous batch uses safe card data in an inline view; native Vue tree remains mounted')
 bar.get_by_role('button',name='下一批 →').click()
 assert page.locator('#btr-flow-history').count()==0
 assert page.evaluate('savedNativeCard===document.querySelector(".bili-video-card")')
 assert page.evaluate('refreshCalls')==1
 ok('next saved batch restores the same native elements without fetching')
 page.evaluate("document.querySelector('.container').append(makeCard(batch,10),makeCard(batch,11))")
 page.wait_for_timeout(1800);label('2 / 2');assert len(snapshots()[-1]['cards'])==12
 ok('lazy growth updates the current batch instead of creating spurious history')
 before=page.evaluate('fixtureStorage.writes')
 page.evaluate("for(let i=0;i<30;i++){const e=document.createElement('span');e.textContent=i;document.querySelector('.bili-header__bar').append(e);e.remove();}")
 page.wait_for_timeout(1600);assert page.evaluate('fixtureStorage.writes')==before
 ok('unrelated header mutations do not write history or prune storage')
 page.evaluate("refreshMode='partial'");bar.get_by_role('button',name='换一批',exact=True).click();page.wait_for_timeout(1350)
 assert len(snapshots())==2;label('3 / 3');assert page.locator('.feed-card:visible').count()==10
 ok('partial three-card render is not committed; full stable batch is recorded')
 page.evaluate("chromeMock.storage.sync.set({homeTheme:'oled'})")
 page.wait_for_function("getComputedStyle(document.body).backgroundColor==='rgb(0, 0, 0)'")
 assert page.evaluate("getComputedStyle(document.querySelector('.bili-video-card')).backgroundColor")=='rgb(0, 0, 0)'
 assert page.evaluate("getComputedStyle(document.querySelector('img')).filter")=='none'
 ok('OLED makes native dark surfaces exactly #000000 without an image/video filter')
 page.screenshot(path=str(ROOT/'docs/home-oled-fixture.png'),full_page=False)
 page.evaluate("document.documentElement.classList.remove('dark')")
 page.wait_for_function("!document.documentElement.hasAttribute('data-btr-oled')")
 assert page.evaluate("getComputedStyle(document.body).backgroundColor")=='rgb(255, 255, 255)'
 ok('native dark-to-light change exits OLED; no self-latching black theme')
 page.evaluate("document.documentElement.classList.add('dark');chromeMock.storage.sync.set({homeTheme:'native',homeHideBanner:true})")
 page.wait_for_function("document.querySelector('.bili-header__banner').getBoundingClientRect().height===64")
 assert page.locator('.search').is_visible()
 ok('optional seasonal banner collapse keeps search and top navigation')
 for width,columns in [(1704,5),(1280,4),(900,3),(600,2)]:
  page.set_viewport_size({'width':width,'height':864});page.wait_for_timeout(250)
  assert page.locator('.container').evaluate("n=>getComputedStyle(n).gridTemplateColumns.split(' ').length")==columns
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
 ok('responsive layout preserves native 5/4/3/2-column breakpoints without horizontal overflow')
 page.set_viewport_size({'width':1704,'height':864})
 page.evaluate("const n=makeCard(batch,99);n.querySelector('.bili-video-card__info').append(Object.assign(document.createElement('span'),{className:'bili-video-card__info--ad',textContent:'广告'}));document.querySelector('.container').append(n)")
 page.wait_for_timeout(1400);assert page.locator('[data-btr-ad]').count()==1 and not page.locator('[data-btr-ad]').is_visible()
 assert page.locator('.feed-card:visible').count()==10
 ok('only explicit advertising badge is filtered; no title keyword or uploader blocking')
 page.evaluate("chromeMock.storage.sync.set({homeEnabled:false})")
 page.wait_for_function("!document.querySelector('#btr-flow-toolbar')")
 assert page.locator('.recommended-swipe').is_visible() and page.locator('.roll-btn').is_visible()
 assert page.locator('[data-btr-ready],[data-btr-grid],[data-btr-ad]').count()==0
 ok('master off restores native layout and controls and removes extension DOM markers')
 page.evaluate("chromeMock.storage.sync.set({homeEnabled:true,homeHideBanner:false})");page.wait_for_selector('#btr-flow-toolbar');page.wait_for_timeout(1600)
 page.evaluate("fixtureLocation.pathname='/video/BV1fixtureRoute'")
 page.wait_for_function("!document.querySelector('#btr-flow-toolbar')")
 assert not page.evaluate("document.documentElement.hasAttribute('data-btr-home-clean')")
 page.evaluate("fixtureLocation.pathname='/'");page.wait_for_selector('#btr-flow-toolbar');page.wait_for_timeout(1600)
 ok('SPA navigation removes homepage styling outside the homepage and remounts once on return')
 page.evaluate("refreshMode='none'");old=len(snapshots());bar.get_by_role('button',name='换一批',exact=True).click()
 page.wait_for_function("document.querySelector('#btr-flow-toolbar').shadowRoot.querySelector('.status').textContent.includes('未检测到')",timeout=12000)
 assert len(snapshots())==old and bar.get_by_role('button',name='换一批',exact=True).is_enabled()
 ok('no-change/failed refresh times out, unlocks the UI and keeps previous batches')
 page.evaluate("document.querySelector('.roll-btn').remove()")
 page.wait_for_timeout(350);bar.get_by_role('button',name='换一批',exact=True).click()
 assert '未找到原生' in bar.locator('.status').inner_text();assert page.evaluate('typeof chromeMock')=='object'
 ok('missing native refresh control produces a message, never reloads the document')
 # Rebuild the native grid and button to exercise remount discovery.
 page.evaluate("const c=document.querySelector('.container');c.replaceWith(c.cloneNode(true));const b=document.createElement('button');b.className='roll-btn';b.textContent='换一换';b.onclick=invokeRefresh;document.querySelector('.recommended-container_floor-aside').prepend(b);refreshMode='normal'")
 page.wait_for_timeout(1700);assert page.locator('#btr-flow-toolbar').count()==1
 bar.get_by_role('button',name='换一批',exact=True).click();page.wait_for_timeout(1900)
 assert page.evaluate('batch')==4
 ok('native grid replacement is detected without duplicate toolbar or lost refresh control')
 # Pending local writes must not resurrect snapshots after Clear.
 page.evaluate("fixtureStorage.delay=1000;document.querySelector('.container').append(makeCard(batch,10))")
 page.wait_for_timeout(1600)
 page.evaluate("(async()=>{fixtureStorage.delay=0;await chromeMock.storage.local.set({flowHistoryClearedAt:Date.now()});await chromeMock.storage.local.remove(Object.keys(fixtureStorage.all.local).filter(k=>k.startsWith('flowHistory:')));})()")
 page.wait_for_timeout(1800);assert snapshots()==[];label('—')
 ok('clear-history epoch rejects an in-flight pre-clear write; old records do not reappear')
 page.evaluate("fixtureStorage.fail=true")
 bar.get_by_role('button',name='换一批',exact=True).click();label('1 / 1')
 page.wait_for_function("document.querySelector('#btr-flow-toolbar').shadowRoot.textContent.includes('暂未写入')")
 assert page.locator('.feed-card:visible').count()==10
 ok('local storage failure is reported without breaking refresh or the live page')
 page.evaluate("fixtureStorage.fail=false;chromeMock.storage.sync.set({homeHistory:false})")
 page.wait_for_timeout(300);assert bar.get_by_role('button',name='← 上一批').is_hidden()
 assert bar.get_by_role('button',name='换一批',exact=True).is_visible()
 ok('history can be disabled independently while keeping clean layout and native refresh')
 # Actual options markup and JS with mock browser APIs; never activates a real proxy.
 option=ctx.new_page();option.on('pageerror',lambda e:errors.append(str(e)));option.on('dialog',lambda d:d.accept())
 markup=(ROOT/'ui/options.html').read_text();markup=re.sub(r'<script[^>]*>.*?</script>','',markup,flags=re.S);markup=re.sub(r'<link[^>]*>','',markup)
 option.set_content(markup);option.add_style_tag(content=(ROOT/'ui/common.css').read_text())
 script(option,'tests/browser-shim.js');option.evaluate("window.chrome=window.chromeMock;0")  # extension page: ui-kit reads chrome.storage for the theme
 for f in ['src/ui-kit.js','src/home-core.js','src/focus-core.js','src/lock-core.js']:script(option,f)
 # The service worker owns watch-limit writes (self-discipline lock); mock it as "no lock".
 option.evaluate("chromeMock.runtime.sendMessage=async m=>{if(m.type==='lock-state')return {locked:false};if(m.type==='focus-set'){await chromeMock.storage.sync.set(m.changes);return {applied:m.changes,deferred:{}};}return {};};0")
 option.evaluate("code=>new Function('chrome',code)(window.chromeMock)",(ROOT/'ui/options.js').read_text())
 option.wait_for_timeout(300)
 option.select_option('#homeTheme','oled');option.locator('#homeHideBanner').check(force=True)
 option.wait_for_function("fixtureStorage.all.sync.homeTheme==='oled'&&fixtureStorage.all.sync.homeHideBanner===true",timeout=3000)
 assert '自动保存' in option.locator('#saved').inner_text()
 ok('options auto-save homepage switches and theme selection with sticky save-bar feedback')
 option.locator('#focusEnabled').check(force=True);option.locator('#focusWindowMinutes').fill('45');option.locator('#focusWindowMinutes').press('Tab');option.locator('#focusWeeklyHours').fill('6');option.locator('#focusWeeklyHours').press('Tab')
 option.wait_for_function('fixtureStorage.all.sync.focusWindowMinutes===45&&fixtureStorage.all.sync.focusWeeklyHours===6',timeout=3000);assert option.evaluate('fixtureStorage.all.sync.focusEnabled===true')
 ok('options save 5-hour window and weekly limits as numbers (on change, via the service worker)')
 assert option.evaluate("getComputedStyle(document.querySelector('.savebar')).position")=='fixed'
 assert option.evaluate("getComputedStyle(document.querySelector('.toc')).position")=='sticky'
 ok('save bar is fixed to the window bottom; section navigation is sticky')
 TH="document.documentElement.dataset.theme||''";TOK="getComputedStyle(document.documentElement).getPropertyValue('--btr-bg').trim()"
 assert option.evaluate("document.querySelector('#uiTheme').value")=='bili' and option.evaluate(TH)=='light'
 option.evaluate("chromeMock.storage.local.set({biliTheme:{dark:true,at:Date.now()}})");option.wait_for_function(f"({TH})==='dark'",timeout=2000)
 assert option.evaluate(TOK)=='#1f2026',option.evaluate(TOK)
 option.evaluate("chromeMock.storage.local.set({biliTheme:{dark:false,at:Date.now()}})");option.wait_for_function(f"({TH})==='light'",timeout=2000)
 option.select_option('#uiTheme','dark');option.wait_for_function(f"fixtureStorage.all.sync.uiTheme==='dark'&&({TH})==='dark'",timeout=3000)
 option.emulate_media(color_scheme='dark');option.select_option('#uiTheme','system');option.wait_for_function(f"({TH})==='dark'",timeout=3000)
 option.emulate_media(color_scheme='light');option.wait_for_function(f"({TH})==='light'",timeout=3000)
 option.select_option('#uiTheme','light');option.evaluate("chromeMock.storage.local.set({biliTheme:{dark:true,at:Date.now()}})");option.wait_for_timeout(300);assert option.evaluate(TH)=='light'
 option.select_option('#uiTheme','bili');option.wait_for_function(f"({TH})==='dark'",timeout=3000)
 option.wait_for_timeout(500);option.screenshot(path=str(ROOT/'docs/options-dark-preview.png'))
 option.evaluate("chromeMock.storage.local.set({biliTheme:{dark:false,at:Date.now()}})");option.wait_for_function(f"({TH})==='light'",timeout=2000)
 ok('extension page theme: 跟随 B 站 (default, live from the recorded B 站 theme) / 跟随系统 / 浅色 / 深色, switching live')
 assert option.locator('#proxy').count()==0 and option.locator('.toc a[href="#proxy"]').count()==0 and option.evaluate('permissionRequests')==0
 ok('no proxy section or permission request (feature removed)')
 option.locator('#restore').click();option.wait_for_selector('.modal[role=dialog][aria-modal=true]')
 assert option.evaluate("document.activeElement?.closest('.modal')!=null") and option.evaluate("document.querySelector('main').inert")
 option.keyboard.press('Escape');option.wait_for_timeout(300);assert option.locator('.modal').count()==0 and option.locator('#homeTheme').input_value()=='oled'
 ok('restore asks in a styled in-page dialog (focus inside, page inert); Esc cancels and changes nothing')
 option.locator('#restore').click();option.wait_for_selector('.modal');option.get_by_role('button',name='恢复默认',exact=True).click()
 option.wait_for_function("document.querySelector('#homeTheme').value==='native'",timeout=3000);assert not option.locator('#homeHideBanner').is_checked()
 ok('restore defaults returns native theme')
 option.wait_for_function("!document.querySelector('.modal-back')",timeout=3000)
 option.evaluate("document.querySelector('#quickFab').scrollIntoView({block:'center'})");option.locator('#quickFab').uncheck(force=True);option.wait_for_function('fixtureStorage.all.sync.quickFab===false',timeout=3000)
 ok('controls outside the form (快捷面板) auto-save too')
 option.set_viewport_size({'width':1100,'height':700})
 option.evaluate("document.querySelector('#lock').scrollIntoView({block:'start'})");option.wait_for_timeout(300)
 BAR="(()=>{const r=document.querySelector('#savebar').getBoundingClientRect();return [r.bottom,innerHeight,r.top]})()"
 bar=option.evaluate(BAR);assert abs(bar[1]-bar[0])<1,bar
 CUR="document.querySelector('.toc a[aria-current=true]').getAttribute('href')"
 assert option.evaluate(CUR)=='#lock',option.evaluate(CUR)
 option.evaluate("scrollTo(0,document.documentElement.scrollHeight)");option.wait_for_timeout(300)
 bar=option.evaluate(BAR);assert abs(bar[1]-bar[0])<1,bar
 last=option.evaluate("(()=>{const m=document.querySelector('main.wrap');const kids=[...m.children].filter(n=>n.id!=='savebar');return Math.max(...kids.map(n=>n.getBoundingClientRect().bottom))})()")
 assert last<=bar[2]+1,(last,bar)  # page end (footer) clears the fixed bar
 assert option.evaluate(CUR)=='#help'
 ok('save bar is truly fixed at bottom:0 everywhere, and the page end (footer) stays clear of it')
 # Sections of very different heights: the section under the middle of the visible area is current.
 ids=option.evaluate("[...document.querySelectorAll('.toc a')].map(a=>a.getAttribute('href').slice(1))")
 hs=option.evaluate("[...document.querySelectorAll('.toc a')].map(a=>Math.round(document.querySelector(a.getAttribute('href')).getBoundingClientRect().height))")
 assert max(hs)>2*min(hs),hs
 MID="(()=>{const top=Math.max(0,document.querySelector('.toc').getBoundingClientRect().bottom),bot=innerHeight-document.querySelector('#savebar').offsetHeight;return (top+bot)/2})()"
 checked=0
 for i,sid in enumerate(ids):
  for off,want in ((-20,sid),(20,ids[i-1] if i else sid)):
   option.evaluate(f"(()=>{{const t=document.getElementById('{sid}');scrollTo(0,scrollY+t.getBoundingClientRect().top-({MID})-({off}))}})()");option.wait_for_timeout(120)
   # skip the last stretch (the line slides toward the bottom there) and positions where another section owns >50%
   if option.evaluate(f"document.documentElement.scrollHeight-innerHeight-scrollY<innerHeight-document.querySelector('#savebar').offsetHeight-({MID})"):continue
   if option.evaluate(f"[...document.querySelectorAll('.toc a')].some(a=>{{const r=document.querySelector(a.getAttribute('href')).getBoundingClientRect(),top=Math.max(0,document.querySelector('.toc').getBoundingClientRect().bottom),bot=innerHeight-document.querySelector('#savebar').offsetHeight;return a.getAttribute('href')!=='#{want}'&&Math.min(r.bottom,bot)-Math.max(r.top,top)>(bot-top)/2}})"):continue
   assert option.evaluate(CUR)=='#'+want,(sid,off,want,option.evaluate(CUR));checked+=1
 assert checked>=len(ids),(checked,len(ids))
 # A section owning more than half of the visible area is always current (the 1280×800 lag case).
 option.evaluate("(()=>{const t=document.getElementById('lock');scrollTo(0,scrollY+t.getBoundingClientRect().top-innerHeight*.38)})()");option.wait_for_timeout(120)
 own=option.evaluate("(()=>{const r=document.getElementById('lock').getBoundingClientRect(),top=document.querySelector('.toc').getBoundingClientRect().bottom,bot=innerHeight-document.querySelector('#savebar').offsetHeight;return (Math.min(r.bottom,bot)-Math.max(r.top,top))/(bot-top)})()")
 assert own>.5,own;assert option.evaluate(CUR)=='#lock',option.evaluate(CUR)
 option.set_viewport_size({'width':1704,'height':864})
 ok(f'section nav: the section under the middle of the visible area ({checked} positions, heights {min(hs)}–{max(hs)}px); one owning >50% is always current')
 option.evaluate('scrollTo(0,0)');option.screenshot(path=str(ROOT/'docs/options-preview.png'),full_page=True)
 assert not errors,errors;ok('no uncaught errors across homepage and options regression scenarios')
 (ROOT/'tests/browser-dom-results.json').write_text(json.dumps({'browser':browser.version,'environment':'Local fixture DOM only, mocked Chrome APIs; NOT installed extension or live Bilibili','tests':results,'uncaught_errors':errors},ensure_ascii=False,indent=2))
 print('TOTAL',len(results),flush=True);browser.close()
