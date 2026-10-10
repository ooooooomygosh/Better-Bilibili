"""Regression: the real B 站 homepage wraps 换一换 as div.feed-roll-btn > button.roll-btn > svg + span,
inside the recommendation grid, with the click handler on the inner button only. 1.x–2.0.0 clicked
the outer div, so the native refresh never ran and the toolbar timed out. Mocked Chrome APIs; not a
logged-in Bilibili E2E test."""
import json,pathlib,os
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
results=[]
def ok(name):results.append({'test':name,'passed':True});print('PASS',name,flush=True)
FIXTURE='''<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif}.container{display:grid;grid-template-columns:repeat(5,1fr);gap:20px;width:1400px}.feed-card{height:200px}</style></head><body>
<main><section class="recommended-container_floor-aside"><div class="container is-version8"></div></section></main>
<script>
window.batch=0;window.refreshCalls=0;window.wrapperClicks=0;
const card=(b,i)=>{const h=document.createElement('div');h.className='feed-card';h.innerHTML=`<div class="bili-video-card is-rcmd"><div class="bili-video-card__wrap"><a href="/video/BV${b}refresh${i}" class="bili-video-card__image--link"><picture class="v-img bili-video-card__cover"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""></picture></a><div class="bili-video-card__info"><h3 class="bili-video-card__info--tit" title="第 ${b} 批 视频 ${i}"><a href="/video/BV${b}refresh${i}">第 ${b} 批 视频 ${i}</a></h3><span class="bili-video-card__info--author">UP ${i}</span></div></div></div>`;return h;};
window.render=()=>{const g=document.querySelector('.container');g.querySelectorAll('.feed-card').forEach(n=>n.remove());const b=++batch;for(let i=0;i<11;i++)g.append(card(b,i));};
const g=document.querySelector('.container');
const swipe=document.createElement('div');swipe.className='recommended-swipe grid-anchor';swipe.textContent='carousel';g.append(swipe);
const wrap=document.createElement('div');wrap.className='feed-roll-btn';
wrap.innerHTML='<button class="primary-btn roll-btn"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 1h14v14H1z"/></svg><span>换一换</span></button>';
wrap.addEventListener('click',e=>{if(e.target===wrap)wrapperClicks++;});
wrap.querySelector('button').addEventListener('click',()=>{refreshCalls++;setTimeout(render,200);});
g.append(wrap);render();
</script></body></html>'''
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/lib/chromium/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1600,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(FIXTURE)
 page.add_script_tag(content=(ROOT/'tests/browser-shim.js').read_text());page.add_script_tag(content=(ROOT/'src/home-core.js').read_text());page.add_script_tag(content=(ROOT/'src/filter-core.js').read_text())
 page.evaluate("window.fixtureLocation={pathname:'/',origin:'https://www.bilibili.com',href:'https://www.bilibili.com/',reload:()=>{throw Error('unexpected reload')}}")
 page.evaluate("code=>new Function('chrome','location','crypto',code)(window.chromeMock,window.fixtureLocation,{randomUUID:()=> 'fixture-tab-refresh-1234'})",(ROOT/'src/home-enhancer.js').read_text())
 count=lambda t:page.wait_for_function("t=>document.querySelector('#btr-flow-toolbar')?.shadowRoot.querySelector('.count')?.textContent===t",arg=t,timeout=12000)
 count('1 / 1')
 assert page.evaluate("document.querySelector('.feed-roll-btn').hasAttribute('data-btr-native-refresh')")
 assert not page.locator('.feed-roll-btn').is_visible()
 ok('wrapped native control is found and the whole wrapper is hidden')
 refresh=page.locator('#btr-flow-toolbar').get_by_role('button',name='换一批',exact=True)
 refresh.click();count('2 / 2')
 assert page.evaluate('refreshCalls')==1 and page.evaluate('wrapperClicks')==0
 assert page.evaluate("document.querySelector('.bili-video-card__info--tit a').textContent").startswith('第 2 批')
 ok('toolbar 换一批 reaches the handler on the inner button and records the new batch')
 assert refresh.is_enabled()
 refresh.click();count('3 / 3');assert page.evaluate('refreshCalls')==2
 ok('a second refresh after the hidden wrapper still works')
 status=page.evaluate("document.querySelector('#btr-flow-toolbar').shadowRoot.querySelector('.status').textContent")
 assert status=='',status
 assert not errors,errors;ok('no timeout message and no uncaught errors')
 browser.close()
(ROOT/'tests/browser-refresh-results.json').write_text(json.dumps({'scope':'Mocked Chrome APIs, synthetic B 站-shaped markup; not logged-in Bilibili','results':results},ensure_ascii=False,indent=1))
print('TOTAL',len(results))
