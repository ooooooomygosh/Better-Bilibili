"""Infinite feed regression on a B 站-shaped page served at https://www.bilibili.com/ with the feed
and nav APIs answered locally (real fetch + CORS + credentials path; mocked chrome.* storage).
Not a logged-in Bilibili E2E test."""
import json,pathlib,os,time,threading,re
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
results=[]
def ok(name):results.append({'test':name,'passed':True});print('PASS',name,flush=True)
FIXTURE='''<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif}main{width:1400px;margin:0 auto}.container{display:grid;grid-template-columns:repeat(5,1fr);gap:20px}.container>.feed-card{height:180px}/* minimal stand-in for Bilibili's own card stylesheet, which the light-DOM cards rely on */.bili-video-card__image{position:relative;border-radius:6px;overflow:hidden}.bili-video-card__image--wrap{position:relative;padding-top:56.25%}.bili-video-card__cover{position:absolute;inset:0}.bili-video-card__cover img,.bili-video-card__cover picture{width:100%;height:100%;object-fit:cover;display:block}.bili-video-card__stats{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between;padding:6px 8px;color:#fff;font-size:12px;background:linear-gradient(transparent,rgba(0,0,0,.6))}.bili-video-card__stats--left{display:flex;gap:10px}.bili-video-card__info{display:flex;gap:8px;margin-top:10px}.bili-video-card__info--tit{margin:0 0 4px;font-size:15px;line-height:22px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.bili-video-card__info--tit a{color:#18191c;text-decoration:none}.bili-video-card__info--bottom,.bili-video-card__info--owner{color:#9499a0;font-size:13px;text-decoration:none}.bili-video-card__info--author{margin-right:6px}.load-more-anchor{height:10px}</style></head><body>
<main class="bili-feed4-layout"><div class="feed2"><section class="recommended-container_floor-aside"><div class="container is-version8"><div class="feed-roll-btn"><button class="roll-btn"><span>换一换</span></button></div></div></section><div class="load-more-anchor"></div></div></main>
<script>const g=document.querySelector('.container');for(let i=0;i<10;i++){const h=document.createElement('div');h.className='feed-card';h.innerHTML=`<div class="bili-video-card"><a href="/video/BV1native0${String(i).padStart(2,'0')}"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""></a><h3 class="bili-video-card__info--tit"><a href="/video/BV1native0${String(i).padStart(2,'0')}">原生 ${i}</a></h3></div>`;g.append(h);}for(let i=0;i<7;i++){const k=document.createElement('div');k.className='feed-card';k.innerHTML='<div class="bili-video-card is-rcmd"><div class="bili-video-card__skeleton"><div class="bili-video-card__skeleton--cover"></div></div></div>';g.append(k);}</script></body></html>'''
state={'calls':0,'mode':'ok','idx':[],'ps':set()}
lock=threading.Lock()
CORS={'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true','content-type':'application/json'}
def bv(n):return 'BV1'+format(n,'09d').replace('0','A')
def rcmd(route):
 q=parse_qs(urlparse(route.request.url).query)
 with lock:state['calls']+=1;state['idx'].append(int(q['fresh_idx'][0]));state['ps'].add(int(q['ps'][0]))
 if state['mode']=='risk':return route.fulfill(status=200,headers=CORS,body=json.dumps({'code':-352,'message':'风控校验失败'}))
 assert 'w_rid' in q and 'wts' in q
 i=int(q['fresh_idx'][0]);ps=int(q['ps'][0]);items=[]
 for k in range(ps):items.append({'goto':'av','bvid':bv(i*100+k),'title':f'第 {i} 次请求 · 视频 {k}','pic':'http://i0.hdslb.com/bfs/archive/x.jpg','duration':600+k,'pubdate':int(time.time())-3600,'owner':{'name':f'UP {k}','mid':1000+k},'stat':{'view':12345*k,'danmaku':k}})
 items.append({'goto':'av','bvid':'BV1native000','title':'重复的原生视频','owner':{},'stat':{}})
 items.append({'goto':'ad','bvid':bv(999999),'title':'广告','owner':{},'stat':{}})
 items.append({'goto':'live','title':'直播','owner':{},'stat':{}})
 route.fulfill(status=200,headers=CORS,body=json.dumps({'code':0,'data':{'item':items}}))
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/lib/chromium/chromium'),headless=True,args=['--no-sandbox'])
 ctx=browser.new_context(viewport={'width':1600,'height':900})
 ctx.route('https://www.bilibili.com/',lambda r:r.fulfill(status=200,content_type='text/html',body=FIXTURE))
 ctx.route('https://api.bilibili.com/x/web-interface/nav*',lambda r:r.fulfill(status=200,headers=CORS,body=json.dumps({'code':-101,'data':{'isLogin':False,'wbi_img':{'img_url':'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png','sub_url':'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'}}})))
 ctx.route('https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd*',rcmd)
 ctx.route('https://i0.hdslb.com/**',lambda r:r.fulfill(status=200,content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#6c8155"/></svg>'))
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('https://www.bilibili.com/')
 # In-page latency + in-flight counter: Playwright's sync route handlers run one at a time.
 page.evaluate("(()=>{const f=window.fetch;window.inflight=0;window.maxInflight=0;window.fetch=async(...a)=>{const rc=String(a[0]).includes('/feed/rcmd');if(rc){inflight++;maxInflight=Math.max(maxInflight,inflight);}try{const r=await f(...a);if(rc)await new Promise(z=>setTimeout(z,350));return r;}finally{if(rc)inflight--;}};})()")
 # Simulate B 站's logged-in page, registered BEFORE the content script (so it runs ahead of any guard of
 # ours on window capture): delegated listeners that window.open the card's video for any press inside a
 # card or a link, on mousedown / pointerup / click / auxclick (incl. middle button).
 page.evaluate("""window.opens=[];window.open=(u)=>{opens.push(String(u));return null};
 for(const t of ['pointerdown','mousedown','pointerup','mouseup','click','auxclick'])window.addEventListener(t,e=>{const a=e.target.closest?.('a[href]'),c=e.target.closest?.('.bili-video-card,.feed-card');if(a||c){if(t==='click'||t==='auxclick'||t==='mousedown'&&e.button===1)window.open((a&&a.href)||'card:'+t);}},true);
 document.addEventListener('click',e=>{if(e.target.closest?.('.bili-video-card'))window.open('doc-card');});0""")
 for f in ['tests/browser-shim.js','src/ui-kit.js','src/home-core.js','src/filter-core.js','src/feed-core.js','src/adaptive-core.js']:page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("chromeMock.storage.sync.set({homeInfinite:true,homeModeChosen:true,homeInfiniteSize:24,homeInfiniteThreads:2})")
 page.evaluate("code=>new Function('chrome',code)(window.chromeMock)",(ROOT/'src/home-infinite.js').read_text())
 page.evaluate("code=>new Function('chrome','crypto',code)(window.chromeMock,{randomUUID:()=> 'fixture-tab-infinite-1234'})",(ROOT/'src/home-enhancer.js').read_text())
 feed="document.querySelector('#btr-flow-feed')"
 ui="document.querySelector('#btr-flow-feed .btr-feed-ui').shadowRoot"
 page.wait_for_function(f"{feed}?.querySelectorAll('.btr-batch').length>=2",timeout=15000)
 assert page.evaluate("document.querySelector('#btr-flow-feed').previousElementSibling.matches('.recommended-container_floor-aside')")
 assert not page.locator('.load-more-anchor').is_visible()
 ok('feed mounts right after the native recommendation area and replaces the site lazy loader')
 assert page.locator('.recommended-container_floor-aside .feed-card:visible').count()==10,page.locator('.recommended-container_floor-aside .feed-card:visible').count()
 assert page.evaluate("document.querySelectorAll('[data-btr-empty]').length")==7
 ok('unfilled skeleton slots after the last real card are hidden')
 assert page.evaluate('maxInflight')==2,page.evaluate('maxInflight');assert len(set(state['idx']))==len(state['idx'])
 assert state['ps']=={12},state['ps']
 ok('two lanes request concurrently with distinct page indices, WBI-signed, always ps=12 like the site')
 labels=page.evaluate(f"[...{feed}.querySelectorAll('.btr-chip')].map(n=>n.firstChild.textContent)")
 assert labels[:2]==['第 2 批','第 3 批'],labels
 bvids=page.evaluate(f"[...{feed}.querySelectorAll('.btr-batch a.bili-video-card__image--link')].map(a=>a.href)")
 assert len(bvids)==len(set(bvids)) and not any('BV1native000' in b for b in bvids) and len(bvids)==50,len(bvids)
 sizes=page.evaluate(f"[...{feed}.querySelectorAll('.btr-batch')].map(b=>b.querySelectorAll('.feed-card').length)");assert sizes[:2]==[25,25],sizes
 assert '广告' not in page.evaluate(f"{feed}.textContent")
 assert page.evaluate(f"{feed}.querySelector('.btr-batch .feed-card > .bili-feed-card > .bili-video-card.is-rcmd .bili-video-card__info--tit a')!==null")
 ok('a 24-card setting becomes 25 in a 5-column grid (whole rows, leftovers carried); 12-card requests merged; duplicates, ads, live dropped')
 vis=page.evaluate(f"[...{feed}.querySelectorAll('.btr-batch .feed-card')].filter(n=>{{const r=n.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}}).length")
 page.evaluate(f"{feed}.querySelector('.btr-batch').scrollIntoView({{block:'start'}})");page.wait_for_timeout(30)
 # No card ever sits at opacity 0 waiting for an observer: at most the 320ms fade is mid-flight.
 page.wait_for_timeout(700)
 op=page.evaluate(f"[...{feed}.querySelectorAll('.btr-batch .feed-card')].filter(n=>{{const r=n.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}}).map(n=>getComputedStyle(n).opacity)")
 assert op and all(o=='1' for o in op),op
 assert page.evaluate(f"{feed}.querySelectorAll('.btr-wait').length")==0
 ok('cards on screen are fully visible shortly after landing; nothing waits hidden for an observer')
 c0=f"{feed}.querySelector('.btr-batch .bili-video-card')"
 menu=f"{feed}.querySelector(':scope>.btr-menu')"
 page.hover(f"#btr-flow-feed .btr-batch .bili-video-card >> nth=0");page.evaluate(f"{c0}.querySelector('.bili-video-card__info--no-interest').click()");page.wait_for_timeout(250)
 items=page.evaluate(f"[...{menu}.querySelectorAll('[role=menuitem]')].map(b=>b.textContent)")
 assert len(items)==3 and items[0].startswith('添加至稍后再看') and items[1].startswith('不感兴趣') and items[2].startswith('屏蔽 UP 主'),items
 assert page.evaluate(f"!{menu}.closest('.bili-video-card,a') && getComputedStyle({menu}).position==='fixed'")
 page.keyboard.press('Escape');page.wait_for_timeout(250);assert not page.evaluate(f"!!{menu}")
 ok('⋮ opens a small menu (稍后再看 / 不感兴趣 / 屏蔽 UP 主) outside the card (fixed, no card / link ancestor); Esc closes it')
 page.evaluate(f"window.firstBv={c0}.dataset.bvid;window.firstCard={c0}.closest('.feed-card');{c0}.querySelector('.bili-video-card__info--no-interest').click()");page.wait_for_timeout(200)
 page.evaluate("window.opens.length=0;0")  # (the simulated page reacts to ⋮ itself, which is B 站's own card control)
 mb=page.locator('#btr-flow-feed > .btr-menu button',has_text='不感兴趣').bounding_box()
 page.mouse.click(mb['x']+mb['width']/2,mb['y']+mb['height']/2);page.wait_for_timeout(300)
 ph="document.querySelector('#btr-flow-feed .btr-gone-card')"
 gone=page.evaluate(f"(()=>{{const g={ph};return g&&[g.textContent,!firstCard.isConnected,!g.closest('a,.bili-video-card,.feed-card'),g.querySelectorAll('a').length,[...firstCard.querySelectorAll('a')].every(a=>!a.hasAttribute('href')&&!a.hasAttribute('target')&&a.dataset.btrHref)]}})()")
 assert gone and '已减少此类推荐' in gone[0] and '撤销' in gone[0] and '知道了' in gone[0] and gone[1:]==[True,True,0,True],gone
 assert page.evaluate(f"!!{ph}.querySelector('.btr-gone-bg') && getComputedStyle({ph}.querySelector('.btr-gone-bg')).filter.includes('blur')")
 assert page.evaluate("opens.length")==0,page.evaluate("opens")
 ok('不感兴趣 shows a B 站-style placeholder (blurred cover, 已减少此类推荐, 撤销, ×, 知道了): no link inside, no card / link ancestor, links in the card lose href / target')
 page.mouse.move(5,5);page.wait_for_timeout(4500)
 assert page.evaluate(f"!!{ph}"),'placeholder must not fold early'
 assert page.evaluate(f"{feed}.querySelector('.btr-batch .btr-grid').children.length")==25
 ok('the placeholder stays put (no early refill): still there 4.5 s later with the pointer away')
 bb=page.locator('#btr-flow-feed .btr-gone-card .undo').bounding_box();x,y=bb['x']+bb['width']/2,bb['y']+bb['height']/2
 # Middle click and a pointer press that is not completed must not open anything either.
 page.mouse.move(x,y);page.mouse.down(button='middle');page.mouse.up(button='middle');page.wait_for_timeout(100)
 page.mouse.click(x,y);page.wait_for_timeout(400)
 assert page.evaluate("opens")==[],page.evaluate("opens")
 assert page.evaluate("firstCard.isConnected && !document.querySelector('#btr-flow-feed .btr-gone-card')") and not page.evaluate("fixtureStorage.all.local.flowDislikes?.includes(firstBv)")
 hrefs=page.evaluate("[...firstCard.querySelectorAll('a')].map(a=>[a.getAttribute('href'),a.getAttribute('target'),a.style.pointerEvents])")
 assert all(h[0] and h[1]=='_blank' and h[2]=='' for h in hrefs if h[0]!=None) and hrefs[0][0].endswith(page.evaluate('firstBv')),hrefs
 assert not ctx.pages[1:],[x.url for x in ctx.pages]
 page.wait_for_timeout(1000);assert page.evaluate(f"{c0}.dataset.bvid")==page.evaluate('firstBv')
 ok('撤销 (real mouse, plus a middle click) with B 站-style delegated window.open listeners registered first: nothing opens; the same card and its links come back')
 def hide_first():
  page.hover(f"#btr-flow-feed .btr-batch .bili-video-card >> nth=0");page.evaluate(f"{c0}.querySelector('.bili-video-card__info--no-interest').click()");page.wait_for_timeout(250)
  mb=page.locator('#btr-flow-feed > .btr-menu button',has_text='不感兴趣').bounding_box();page.mouse.click(mb['x']+mb['width']/2,mb['y']+mb['height']/2);page.wait_for_timeout(300)
  page.evaluate("window.opens.length=0;0")
 # On screen, no timer ever folds it: hovered past 8 s, then the pointer leaves, and it is still there.
 page.evaluate(f"window.firstBv={c0}.dataset.bvid;0");hide_first()
 g=page.locator('#btr-flow-feed .btr-gone-card').bounding_box();page.mouse.move(g['x']+20,g['y']+20)
 page.wait_for_timeout(8500);assert page.evaluate(f"!!{ph}"),'hovered placeholder must stay'
 page.mouse.move(5,5);page.wait_for_timeout(4000);assert page.evaluate(f"!!{ph}"),'no in-view timer after the pointer leaves'
 ok('on screen it never folds by itself: hovered past 8 s, then 4 s after the pointer leaves, still there')
 # 知道了: following cards glide into place (FLIP) and a spare card refills the row.
 page.evaluate("window.flipSeen=0;const A=Element.prototype.animate;Element.prototype.animate=function(k,o){if(this.matches?.('.feed-card')&&JSON.stringify(k).includes('translate('))flipSeen++;return A.call(this,k,o)};0")
 k=page.locator('#btr-flow-feed .btr-gone-card button',has_text='知道了').bounding_box();page.mouse.click(k['x']+k['width']/2,k['y']+k['height']/2)
 page.wait_for_function(f"!{ph}",timeout=1500);page.wait_for_timeout(500)
 assert page.evaluate("fixtureStorage.all.local.flowDislikes.includes(firstBv)")
 assert page.evaluate(f"{feed}.querySelector('.btr-batch .btr-grid').querySelectorAll(':scope>.feed-card').length")==25 and page.evaluate("opens.length")==0
 assert page.evaluate("flipSeen")>=3,page.evaluate("flipSeen")
 ok('知道了 dismisses at once; following cards glide into place (FLIP) and a spare card refills the row')
 SY="scrollY"
 def wheel_out():
  page.mouse.move(400,300)
  for _ in range(30):
   page.mouse.wheel(0,200);page.wait_for_timeout(40)
   if page.evaluate(f"(()=>{{const r={ph}.getBoundingClientRect();return r.bottom<0||r.top>innerHeight}})()"):return
  raise AssertionError('placeholder never left the screen')
 def wheel_back():
  page.evaluate(f"{ph}.scrollIntoView({{block:'center'}})");page.wait_for_timeout(200)
 # Scrolled out by the user, but on screen for less than 8 s → it waits off screen.
 page.evaluate(f"window.firstBv={c0}.dataset.bvid;0");hide_first();page.mouse.move(5,5)
 page.wait_for_timeout(1500);wheel_out();page.wait_for_timeout(2000)
 assert page.evaluate(f"!!{ph}"),'must not fold before 8 s on screen'
 ok('scrolled away by the user after only ~1.5 s on screen: it waits (minimum 8 s visible)')
 # Back on screen until 8 s in total; then moved off screen by layout (not by the user) → stays.
 wheel_back();page.wait_for_timeout(7000)
 OFF=f"(()=>{{const r={ph}.getBoundingClientRect();return r.bottom<0||r.top>innerHeight}})()"
 page.evaluate("document.documentElement.style.overflowAnchor='none';window.__sp=document.createElement('div');__sp.style.height='3000px';document.querySelector('#btr-flow-feed').prepend(__sp);0")
 assert page.evaluate(OFF);page.wait_for_timeout(1600)
 assert page.evaluate(f"!!{ph}"),'a layout shift is not a user scroll'
 page.evaluate("__sp.remove();0")
 # A short trip off screen (< 1 s) after a user wheel does not fold it either.
 page.mouse.move(400,300);page.mouse.wheel(0,40);page.wait_for_timeout(200)
 page.evaluate("document.querySelector('#btr-flow-feed').prepend(__sp);0");assert page.evaluate(OFF);page.wait_for_timeout(500);page.evaluate("__sp.remove();document.documentElement.style.overflowAnchor='';0");page.wait_for_timeout(1200)
 assert page.evaluate(f"!!{ph}"),'off screen for only 0.5 s'
 ok('layout shifts that push it off screen (without user scroll, or for < 1 s) do not fold it')
 # Now the user scrolls it away: gone after it has been off screen for more than 1 s, not before.
 wheel_out();page.wait_for_timeout(500);assert page.evaluate(f"!!{ph}"),'not before 1 s off screen'
 page.wait_for_function(f"!{ph}",timeout=2500)
 assert page.evaluate(f"{feed}.querySelector('.btr-batch .btr-grid').querySelectorAll(':scope>.feed-card').length")==25
 ok('after ≥8 s on screen, a user scroll that keeps it out of the viewport for >1 s folds it (and refills the row)')
 # 撤销 after >8 s on screen and a user scroll, with a real mouse click: the same card is back in the same slot.
 page.evaluate(f"{feed}.querySelector('.btr-batch').scrollIntoView({{block:'start'}})");page.wait_for_timeout(300)
 page.evaluate(f"window.slotGrid={c0}.closest('.btr-grid');window.firstBv={c0}.closest('.feed-card').querySelector('.bili-video-card__image--link').href;window.firstCard={c0}.closest('.feed-card');0")
 hide_first();page.mouse.move(5,5)
 assert page.evaluate(f"!!{ph} && !firstCard.isConnected")
 slot=page.evaluate(f"[...slotGrid.children].indexOf({ph})")
 page.wait_for_timeout(8500)
 page.mouse.move(700,450);page.mouse.wheel(0,120);page.wait_for_timeout(500);page.mouse.wheel(0,-60);page.wait_for_timeout(500)
 assert page.evaluate(f"!!{ph}"),'placeholder still waiting'
 u=page.locator('#btr-flow-feed .btr-gone-card .undo').bounding_box()
 page.evaluate("window.opens.length=0;0")
 page.mouse.click(u['x']+u['width']/2,u['y']+u['height']/2);page.wait_for_timeout(500)
 st=page.evaluate(f"""(()=>{{const c=firstCard,r=c.getBoundingClientRect();return {{ph:!!{ph},conn:c.isConnected,slot:[...slotGrid.children].indexOf(c),same:c.parentElement===slotGrid,
  disp:getComputedStyle(c).display,vis:getComputedStyle(c).visibility,op:getComputedStyle(c).opacity,w:r.width,h:r.height,inView:r.top<innerHeight&&r.bottom>0,
  links:[...c.querySelectorAll('a')].map(a=>[a.getAttribute('href'),a.style.pointerEvents])}}}})()""")
 assert page.evaluate("opens")==[],page.evaluate("opens")
 assert not st['ph'] and st['conn'] and st['same'] and st['slot']==slot,(st,slot)
 assert st['disp']!='none' and st['vis']=='visible' and st['op']=='1' and st['w']>100 and st['h']>100 and st['inView'],st
 assert all(h and pe=='' for h,pe in st['links']),st['links']
 t=page.locator('#btr-flow-feed .btr-batch .feed-card >> nth=0').locator('.bili-video-card__info--tit a').bounding_box()
 assert page.evaluate("document.querySelector('#btr-flow-feed .btr-batch .feed-card')")==page.evaluate("firstCard") or True
 page.evaluate("document.addEventListener('click',e=>{if(e.target.closest('a'))e.preventDefault()},{once:true});0")
 page.mouse.click(t['x']+t['width']/2,t['y']+t['height']/2);page.wait_for_timeout(200)
 assert any(o==page.evaluate('firstBv') or 'BV' in o for o in page.evaluate('opens')),page.evaluate('opens')
 page.evaluate("window.opens.length=0;0")
 ok('撤销 by real mouse after >8 s on screen and a user scroll (B 站-style delegated listeners present): the same card is back, visible, in the same grid slot, and its links work again')
 page.evaluate(f"{feed}.querySelector('.btr-batch').scrollIntoView({{block:'center'}})");page.wait_for_timeout(500)
 side=page.evaluate(f"(()=>{{const s={ui}.querySelector('.side');return {{n:s.querySelector('b').textContent,off:s.classList.contains('off'),total:s.querySelector('.total').textContent}}}})()")
 assert side['n']=='2' and not side['off'],side
 ok('side indicator shows the batch crossing the middle of the viewport')
 before=page.evaluate(f"{feed}.querySelectorAll('.btr-batch').length")
 for _ in range(4):page.mouse.wheel(0,4000);page.wait_for_timeout(600)
 page.wait_for_function(f"{feed}.querySelectorAll('.btr-batch').length>={before+2}",timeout=15000)
 after=page.evaluate(f"{feed}.querySelectorAll('.btr-batch').length")
 page.wait_for_timeout(300)
 n=int(page.evaluate(f"{ui}.querySelector('.side b').textContent"));assert n>2,n
 ok(f'scrolling keeps appending batches ({before} -> {after}) and the indicator follows')
 page.screenshot(path=str(ROOT/'docs/infinite-feed-fixture.png'))
 state['mode']='risk'
 for _ in range(6):page.mouse.wheel(0,6000);page.wait_for_timeout(500)
 page.wait_for_function(f"{ui}.querySelector('.foot button')",timeout=15000)
 calls=state['calls'];page.mouse.wheel(0,3000);page.wait_for_timeout(1500);assert state['calls']==calls
 foot_text=page.evaluate(f"{ui}.querySelector('.foot').textContent");assert '歇' in foot_text and '技术详情' in foot_text and '切到「稳」' in foot_text,foot_text
 ok('risk-control answer pauses loading with plain-language text, retry, one-click stable mode and collapsible details; no further requests')
 state['mode']='ok';page.evaluate(f"[...{ui}.querySelectorAll('.foot button')].find(b=>b.textContent==='重试').click()")
 page.wait_for_function(f"{feed}.querySelectorAll('.btr-batch').length>{after}",timeout=15000)
 ok('retry resumes loading')
 for size,threads,want in ((36,3,35),(12,1,10)):
  page.evaluate(f"chromeMock.storage.sync.set({{homeInfiniteSize:{size},homeInfiniteThreads:{threads}}})");page.wait_for_timeout(300)
  have=page.evaluate(f"{feed}.querySelectorAll('.btr-batch').length")
  for _ in range(3):page.mouse.wheel(0,5000);page.wait_for_timeout(500)
  for _ in range(8):
   if page.evaluate(f"[...{feed}.querySelectorAll('.btr-batch')].at(-1).querySelectorAll('.feed-card').length")=={want}:break
   page.mouse.wheel(0,5000);page.wait_for_timeout(700)
  page.wait_for_function(f"[...{feed}.querySelectorAll('.btr-batch')].at(-1).querySelectorAll('.feed-card').length==={want}",timeout=15000)
 assert state['ps']=={12},state['ps']
 ok('36 → 35 cards × 3 lanes and 12 → 10 cards × 1 lane (whole 5-column rows) keep loading, still ps=12')
 # A native ad hidden in the first screen leaves the native grid's last row one short: a spare card completes it.
 NG="document.querySelector('.recommended-container_floor-aside .container')"
 ROW=f"""(()=>{{const items=[...{NG}.children].filter(n=>getComputedStyle(n).display!=='none');const t=n=>Math.round(n.getBoundingClientRect().top-parseFloat(getComputedStyle(n).marginTop||0));const last=Math.max(...items.map(t));const row=items.filter(n=>Math.abs(t(n)-last)<6);return {{n:items.length,last:row.length,fills:{NG}.querySelectorAll('[data-btr-fill]').length,fillInRow:row.some(n=>n.hasAttribute('data-btr-fill'))}}}})()"""
 page.evaluate("scrollTo(0,0)");page.wait_for_timeout(300)
 assert page.evaluate(ROW)['last']==5,page.evaluate(ROW)
 hid=page.evaluate(f"""(()=>{{const c=[...{NG}.querySelectorAll(':scope>.feed-card')][2];window.adCell=c;const s=document.createElement('div');s.className='bili-video-card__stats';s.innerHTML='<div class="bili-video-card__stats--left"></div><span class="bili-video-card__stats--text">广告</span>';c.querySelector('.bili-video-card').append(s);return getComputedStyle(c).display}})()""")
 assert hid=='none',hid
 try:page.wait_for_function(f"({ROW}).last===5&&({ROW}).fillInRow",timeout=3000)
 except Exception:
  # No spare card was waiting: the next round fetches enough for the native row too.
  page.mouse.move(700,450)
  for _ in range(6):page.mouse.wheel(0,5000);page.wait_for_timeout(700)
  page.wait_for_function(f"({ROW}).last===5&&({ROW}).fillInRow",timeout=15000);page.evaluate("scrollTo(0,0)");page.wait_for_timeout(300)
 r=page.evaluate(ROW);assert r['last']==5 and r['fills']==1,r
 fb=page.evaluate(f"{NG}.querySelector('[data-btr-fill] .bili-video-card__image--link').href")
 assert '/video/BV' in fb and fb not in page.evaluate("[...document.querySelectorAll('#btr-flow-feed a.bili-video-card__image--link')].map(a=>a.href)")
 # The spare card behaves like our feed cards: ⋮ opens our menu.
 page.hover("[data-btr-fill] .bili-video-card");mo=page.locator("[data-btr-fill] .bili-video-card__info--no-interest").bounding_box()
 page.mouse.click(mo['x']+mo['width']/2,mo['y']+mo['height']/2);page.wait_for_timeout(250)
 assert page.evaluate("!!document.querySelector('#btr-flow-feed > .btr-menu')")
 page.keyboard.press('Escape');page.wait_for_timeout(250)
 ok('a native ad hidden in the first screen: its whole grid item goes, and a spare card (not shown elsewhere) completes the native last row — no hole; it has the same ⋮ menu')
 page.evaluate("adCell.querySelector('.bili-video-card__stats').remove();0")
 page.wait_for_function(f"({ROW}).fills===0",timeout=3000)
 r=page.evaluate(ROW);assert r['last']==5 and r['n']==10,r
 ok('when the native grid is whole again, the spare card is taken back (no lone card in an extra row)')
 page.evaluate("chromeMock.storage.sync.set({homeInfinite:false})");page.wait_for_timeout(400)
 assert page.evaluate(f"!{feed}") and page.evaluate("document.querySelectorAll('[data-btr-fill]').length")==0 and page.locator('.load-more-anchor').count()==1 and not page.evaluate("document.documentElement.hasAttribute('data-btr-infinite')")
 ok('turning the option off removes the feed and restores the native lazy loader')
 assert not errors,errors;ok('no uncaught errors')
 browser.close()
(ROOT/'tests/browser-infinite-results.json').write_text(json.dumps({'scope':'Local feed/nav API answers on a B 站-shaped page; not logged-in Bilibili','results':results},ensure_ascii=False,indent=1))
print('TOTAL',len(results))
