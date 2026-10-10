"""Blank-homepage regressions and the adaptive request controller, on a B 站-shaped fixture served at
https://www.bilibili.com/ with the feed APIs answered locally (412 / -352 / timeouts / empty lists)."""
import json,pathlib,os,time,threading
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
results=[]
def ok(name):results.append({'test':name,'passed':True});print('PASS',name,flush=True)
FIXTURE='''<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif}main{width:1400px;margin:0 auto}.container{display:grid;grid-template-columns:repeat(5,1fr);gap:20px}.container>.feed-card{height:180px}/* minimal stand-in for Bilibili's own card stylesheet, which the light-DOM cards rely on */.bili-video-card__image{position:relative;border-radius:6px;overflow:hidden}.bili-video-card__image--wrap{position:relative;padding-top:56.25%}.bili-video-card__cover{position:absolute;inset:0}.bili-video-card__cover img,.bili-video-card__cover picture{width:100%;height:100%;object-fit:cover;display:block}.bili-video-card__stats{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between;padding:6px 8px;color:#fff;font-size:12px;background:linear-gradient(transparent,rgba(0,0,0,.6))}.bili-video-card__stats--left{display:flex;gap:10px}.bili-video-card__info{display:flex;gap:8px;margin-top:10px}.bili-video-card__info--tit{margin:0 0 4px;font-size:15px;line-height:22px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.bili-video-card__info--tit a{color:#18191c;text-decoration:none}.bili-video-card__info--bottom,.bili-video-card__info--owner{color:#9499a0;font-size:13px;text-decoration:none}.bili-video-card__info--author{margin-right:6px}.load-more-anchor{height:10px}</style></head><body>
<main class="bili-feed4-layout"><div class="feed2"><section class="recommended-container_floor-aside"><div class="container is-version8"><div class="feed-roll-btn"><button class="roll-btn"><span>换一换</span></button></div></div></section><div class="load-more-anchor"></div></div></main>
<script>const g=document.querySelector('.container');for(let i=0;i<10;i++){const h=document.createElement('div');h.className='feed-card';h.innerHTML=`<div class="bili-video-card"><a href="/video/BV1native0${String(i).padStart(2,'0')}"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""></a><h3 class="bili-video-card__info--tit"><a href="/video/BV1native0${String(i).padStart(2,'0')}">原生 ${i}</a></h3></div>`;g.append(h);}for(let i=0;i<7;i++){const k=document.createElement('div');k.className='feed-card';k.innerHTML='<div class="bili-video-card is-rcmd"><div class="bili-video-card__skeleton"><div class="bili-video-card__skeleton--cover"></div></div></div>';g.append(k);}</script></body></html>'''

EMPTY=FIXTURE.replace("for(let i=0;i<10;i++)","for(let i=0;i<0;i++)").replace("for(let i=0;i<7;i++)","for(let i=0;i<0;i++)")
CORS={'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true','content-type':'application/json'}
NAV={'code':-101,'data':{'isLogin':False,'wbi_img':{'img_url':'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png','sub_url':'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'}}}
def bv(n):return 'BV1'+format(n,'09d').replace('0','A')
def items(i):return [{'goto':'av','bvid':bv(i*100+k),'title':f'视频 {i}-{k}','pic':'http://i0.hdslb.com/bfs/archive/x.jpg','duration':600,'pubdate':int(time.time())-3600,'owner':{'name':'UP','mid':1},'stat':{'view':1,'danmaku':1},'cid':5000+i*100+k} for k in range(12)]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/lib/chromium/chromium'),headless=True,args=['--no-sandbox'])
 def open_page(html,script,hydrated=True,infinite=True,local=None,preview='video'):
  st={'calls':0,'script':list(script)}
  ctx=browser.new_context(viewport={'width':1600,'height':900})
  ctx.route('https://www.bilibili.com/',lambda r:r.fulfill(status=200,content_type='text/html',body=html))
  ctx.route('https://api.bilibili.com/x/web-interface/nav*',lambda r:r.fulfill(status=200,headers=CORS,body=json.dumps(NAV)))
  ctx.route('https://i0.hdslb.com/**',lambda r:r.fulfill(status=200,content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"/>'))
  def rcmd(route):
   st['calls']+=1;m=st['script'].pop(0) if st['script'] else 'ok';i=int(parse_qs(urlparse(route.request.url).query)['fresh_idx'][0])
   if m=='412':return route.fulfill(status=412,headers=CORS,body='')
   if m=='352':return route.fulfill(status=200,headers=CORS,body=json.dumps({'code':-352,'message':'风控校验失败'}))
   if m=='empty':return route.fulfill(status=200,headers=CORS,body=json.dumps({'code':0,'data':{'item':[]}}))
   if m=='abort':return route.abort('connectionreset')
   route.fulfill(status=200,headers=CORS,body=json.dumps({'code':0,'data':{'item':items(i)}}))
  ctx.route('https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd*',rcmd)
  st['shots']=0;st['play']=0
  def shot(r):st['shots']+=1;r.fulfill(status=200,headers=CORS,body=json.dumps({'code':0,'data':{'image':['//i0.hdslb.com/bfs/videoshot/x.jpg'],'img_x_len':10,'img_y_len':10,'index':list(range(101))}}))
  def play(r):st['play']+=1;q=parse_qs(urlparse(r.request.url).query);assert 'w_rid' in q and q.get('platform')==['html5'];r.fulfill(status=200,headers=CORS,body=json.dumps({'code':0,'data':{'durl':[{'url':'https://upos-sz-mirror08c.bilivideo.com/clip.mp4'}]}}))
  ctx.route('https://api.bilibili.com/x/player/videoshot*',shot)
  ctx.route('https://api.bilibili.com/x/player/wbi/playurl*',play)
  ctx.route('https://upos-sz-mirror08c.bilivideo.com/**',lambda r:r.fulfill(status=200,content_type='video/mp4',body=(ROOT/'tests/fixtures/video.mp4').read_bytes()))
  page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('https://www.bilibili.com/')
  for f in ['tests/browser-shim.js','src/ui-kit.js','src/home-core.js','src/filter-core.js','src/feed-core.js','src/adaptive-core.js']:page.add_script_tag(content=(ROOT/f).read_text())
  if not hydrated:page.evaluate("document.documentElement.removeAttribute('data-btr-hydrated')")
  page.evaluate("s=>chromeMock.storage.sync.set(s)",{'homeInfinite':infinite,'homeModeChosen':True,'homeInfiniteSize':24,'homeInfiniteThreads':2,'homePreview':preview})
  if local:page.evaluate("s=>chromeMock.storage.local.set(s)",local)
  page.evaluate("code=>new Function('chrome',code)(window.chromeMock)",(ROOT/'src/home-infinite.js').read_text())
  page.evaluate("code=>new Function('chrome','crypto',code)(window.chromeMock,{randomUUID:()=> 'fixture-tab-resil-1234'})",(ROOT/'src/home-enhancer.js').read_text())
  return ctx,page,st,errors
 toast="[...document.querySelectorAll('[data-btr-toast]')].map(h=>h.dataset.btrToast+':'+h.shadowRoot.querySelector('.body').textContent)"

 # 1. nothing is inserted into the page's app tree until Vue hydration is over
 ctx,page,st,errors=open_page(FIXTURE,[],hydrated=False,infinite=False)
 time.sleep(1.2);assert page.evaluate("!document.querySelector('#btr-flow-toolbar')")
 page.evaluate("document.documentElement.setAttribute('data-btr-hydrated','vue')")
 page.wait_for_function("!!document.querySelector('#btr-flow-toolbar')",timeout=5000)
 assert page.evaluate("document.querySelector('#btr-flow-toolbar').tagName")=='BTR-TOOLBAR'
 ok('toolbar waits for hydration, then mounts as a custom element Vue cannot adopt');ctx.close()

 # 2. a homepage with no visible video: we step aside and offer a reload
 ctx,page,st,errors=open_page(EMPTY,[],infinite=False)
 page.wait_for_function("document.documentElement.hasAttribute('data-btr-home-fallback')",timeout=20000)
 assert not page.evaluate("document.documentElement.hasAttribute('data-btr-home-clean')")
 assert not page.evaluate("!!document.querySelector('#btr-flow-toolbar')")
 t=page.evaluate(toast);assert any(x.startswith('btr-home:首页推荐没显示出来') for x in t),t
 ok('blank homepage watchdog removes our styles and shows a reload toast');ctx.close()

 # 2b. a healthy homepage never trips the watchdog
 ctx,page,st,errors=open_page(FIXTURE,[],infinite=False);time.sleep(13)
 assert not page.evaluate("document.documentElement.hasAttribute('data-btr-home-fallback')");assert page.evaluate(toast)==[]
 ok('healthy homepage keeps the enhancements (no false fallback)');ctx.close()

 # 3. HTTP 412: breaker opens, no hammering, toast + countdown, manual retry = one probe, state persisted
 for code in ['412','352']:
  ctx,page,st,errors=open_page(FIXTURE,[code]*20)
  page.wait_for_function("[...document.querySelectorAll('[data-btr-toast]')].some(h=>h.dataset.btrToast==='btr-feed')",timeout=15000)
  n=st['calls'];time.sleep(3);assert st['calls']==n,(n,st['calls']);assert n<=2,n
  foot=page.evaluate("document.querySelector('#btr-flow-feed .btr-feed-ui').shadowRoot.querySelector('.foot').textContent");assert '秒后自动继续' in foot,foot
  saved=page.evaluate("fixtureStorage.all.local.flowAdaptive");assert saved['openUntil']>time.time()*1000+20000,saved
  st['script']=[]
  page.evaluate("[...document.querySelectorAll('[data-btr-toast]')].find(h=>h.dataset.btrToast==='btr-feed').shadowRoot.querySelector('button.primary').click()")
  page.wait_for_function("document.querySelectorAll('#btr-flow-feed .btr-batch').length>=1",timeout=15000)
  assert st['calls']>=n+1
  ok(f'{code}: circuit opens after {n} request(s), stays silent, persists the cooldown; 现在重试 probes and recovers');ctx.close()

 # 4. cooldown persisted from an earlier page: a reload does not get around it
 ctx,page,st,errors=open_page(FIXTURE,[],local={'flowAdaptive':{'lanes':1,'batch':1,'gap':1400,'trips':1,'openUntil':int(time.time()*1000)+60000,'at':int(time.time()*1000)}})
 time.sleep(4);assert st['calls']==0,st['calls'];assert page.evaluate(toast)
 ok('a cooldown saved before reload is honoured (no request)');ctx.close()

 # 5. transient failures (connection reset, empty list) are retried with backoff and the feed still loads
 ctx,page,st,errors=open_page(FIXTURE,['abort','empty'])
 page.wait_for_function("document.querySelectorAll('#btr-flow-feed .btr-batch').length>=1",timeout=20000)
 assert page.evaluate(toast)==[];assert not errors,errors
 a=page.evaluate("fixtureStorage.all.local.flowAdaptive");assert a['lanes']>=1
 ok('connection reset and empty answers are retried transparently; feed loads, no toast');ctx.close()
 # 6. hover preview, default = inline video like B 站's native cards
 ctx,page,st,errors=open_page(FIXTURE,[])
 page.wait_for_function("document.querySelectorAll('#btr-flow-feed .btr-batch .feed-card').length>=5",timeout=20000)
 link=page.locator('#btr-flow-feed .btr-batch .bili-video-card__image--link').first;link.scroll_into_view_if_needed();link.hover()
 page.wait_for_function("(()=>{const v=document.querySelector('#btr-flow-feed .btr-inline video');return v&&v.muted&&v.src.includes('bilivideo.com')})()",timeout=8000)
 # Playwright's Chromium ships without H.264; where the codec exists the clip must actually be playing.
 if page.evaluate("document.createElement('video').canPlayType('video/mp4; codecs=\"avc1.42E01E\"')"):page.wait_for_function("(()=>{const v=document.querySelector('#btr-flow-feed .btr-inline video');return !v.paused&&v.currentTime>0})()",timeout=8000)
 assert st['play']==1 and st['shots']==0,(st['play'],st['shots'])
 page.evaluate("document.querySelector('#btr-flow-feed .btr-inline-mute').click()");assert page.evaluate("document.querySelector('#btr-flow-feed .btr-inline video').muted")==False
 assert page.evaluate("location.href")=='https://www.bilibili.com/'
 page.mouse.move(5,5);page.wait_for_function("!document.querySelector('#btr-flow-feed .btr-inline')",timeout=3000)
 ok('video mode: hover plays the clip inline (muted, progress bar, mute toggle that does not open the video), stops on leave');ctx.close()
 # 7. 逐帧预览: storyboard prefetched when cards enter the viewport, first frame shows fast on hover
 ctx,page,st,errors=open_page(FIXTURE,[],preview='frames')
 page.wait_for_function("document.querySelectorAll('#btr-flow-feed .btr-batch .feed-card').length>=5",timeout=20000)
 link=page.locator('#btr-flow-feed .btr-batch .bili-video-card__image--link').first;link.scroll_into_view_if_needed();time.sleep(1.2)
 assert st['shots']>=1,'storyboard prefetched before hover'
 t0=time.time();link.hover();page.wait_for_function("!!document.querySelector('#btr-flow-feed .btr-shot.on')",timeout=3000);dt=time.time()-t0
 assert dt<0.6,dt;assert st['play']==0
 page.mouse.move(5,5);page.wait_for_function("!document.querySelector('#btr-flow-feed .btr-shot')",timeout=3000)
 ok(f'frames mode: storyboard prefetched in view, first frame {int(dt*1000)} ms after hover (was 450 ms dwell + 2 requests), gone on leave');ctx.close()
 browser.close()
json.dump(results,open(ROOT/'tests/browser-resilience-results.json','w'),ensure_ascii=False,indent=1)
print(len(results),'passed')
