"""Infinite feed regression on a B 站-shaped page served at https://www.bilibili.com/ with the feed
and nav APIs answered locally (real fetch + CORS + credentials path; mocked chrome.* storage).
Not a logged-in Bilibili E2E test."""
import json,pathlib,os,time,threading,re
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
results=[]
def ok(name):results.append({'test':name,'passed':True});print('PASS',name,flush=True)
FIXTURE='''<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif}main{width:1400px;margin:0 auto}.container{display:grid;grid-template-columns:repeat(5,1fr);gap:20px}.feed-card{height:180px}.load-more-anchor{height:10px}</style></head><body>
<main class="bili-feed4-layout"><div class="feed2"><section class="recommended-container_floor-aside"><div class="container is-version8"><div class="feed-roll-btn"><button class="roll-btn"><span>换一换</span></button></div></div></section><div class="load-more-anchor"></div></div></main>
<script>const g=document.querySelector('.container');for(let i=0;i<10;i++){const h=document.createElement('div');h.className='feed-card';h.innerHTML=`<div class="bili-video-card"><a href="/video/BV1native0${String(i).padStart(2,'0')}"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""></a><h3 class="bili-video-card__info--tit"><a href="/video/BV1native0${String(i).padStart(2,'0')}">原生 ${i}</a></h3></div>`;g.append(h);}</script></body></html>'''
state={'active':0,'max':0,'calls':0,'mode':'ok','idx':[]}
lock=threading.Lock()
CORS={'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true','content-type':'application/json'}
def bv(n):return 'BV1'+format(n,'09d').replace('0','A')
def rcmd(route):
 q=parse_qs(urlparse(route.request.url).query)
 with lock:state['calls']+=1;state['idx'].append(int(q['fresh_idx'][0]))
 if state['mode']=='risk':return route.fulfill(status=200,headers=CORS,body=json.dumps({'code':-352,'message':'风控校验失败'}))
 assert 'w_rid' in q and 'wts' in q
 i=int(q['fresh_idx'][0]);ps=int(q['ps'][0]);items=[]
 for k in range(ps):items.append({'goto':'av','bvid':bv(i*100+k),'title':f'第 {i} 次请求 · 视频 {k}','pic':'http://i0.hdslb.com/bfs/archive/x.jpg','duration':600+k,'pubdate':int(time.time())-3600,'owner':{'name':f'UP {k}'},'stat':{'view':12345*k,'danmaku':k}})
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
 for f in ['tests/browser-shim.js','src/home-core.js','src/feed-core.js']:page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("chromeMock.storage.sync.set({homeInfinite:true,homeInfiniteSize:12,homeInfiniteThreads:2})")
 page.evaluate("code=>new Function('chrome',code)(window.chromeMock)",(ROOT/'src/home-infinite.js').read_text())
 page.evaluate("code=>new Function('chrome','crypto',code)(window.chromeMock,{randomUUID:()=> 'fixture-tab-infinite-1234'})",(ROOT/'src/home-enhancer.js').read_text())
 feed="document.querySelector('#btr-flow-feed')"
 page.wait_for_function(f"{feed}?.shadowRoot?.querySelectorAll('.batch').length>=2",timeout=15000)
 assert page.evaluate("document.querySelector('#btr-flow-feed').previousElementSibling.matches('.recommended-container_floor-aside')")
 assert not page.locator('.load-more-anchor').is_visible()
 ok('feed mounts right after the native recommendation area and replaces the site lazy loader')
 assert page.evaluate('maxInflight')==2,page.evaluate('maxInflight');assert len(set(state['idx']))==len(state['idx'])
 ok('two lanes request concurrently with distinct page indices, WBI-signed')
 labels=page.evaluate(f"[...{feed}.shadowRoot.querySelectorAll('.chip')].map(n=>n.firstChild.textContent)")
 assert labels[:2]==['第 2 批','第 3 批'],labels
 bvids=page.evaluate(f"[...{feed}.shadowRoot.querySelectorAll('a.card')].map(a=>a.href)")
 assert len(bvids)==len(set(bvids)) and not any('BV1native000' in b for b in bvids) and len(bvids)==24,len(bvids)
 assert '广告' not in page.evaluate(f"{feed}.shadowRoot.textContent")
 ok('batches are numbered after the native batch; duplicates, ads and live rooms are dropped')
 page.evaluate(f"{feed}.shadowRoot.querySelector('.batch').scrollIntoView({{block:'center'}})");page.wait_for_timeout(500)
 side=page.evaluate(f"(()=>{{const s={feed}.shadowRoot.querySelector('.side');return {{n:s.querySelector('b').textContent,off:s.classList.contains('off'),total:s.querySelector('.total').textContent}}}})()")
 assert side['n']=='2' and not side['off'],side
 ok('side indicator shows the batch crossing the middle of the viewport')
 before=page.evaluate(f"{feed}.shadowRoot.querySelectorAll('.batch').length")
 for _ in range(4):page.mouse.wheel(0,4000);page.wait_for_timeout(600)
 page.wait_for_function(f"{feed}.shadowRoot.querySelectorAll('.batch').length>={before+2}",timeout=15000)
 after=page.evaluate(f"{feed}.shadowRoot.querySelectorAll('.batch').length")
 page.wait_for_timeout(300)
 n=int(page.evaluate(f"{feed}.shadowRoot.querySelector('.side b').textContent"));assert n>2,n
 ok(f'scrolling keeps appending batches ({before} -> {after}) and the indicator follows')
 page.screenshot(path=str(ROOT/'docs/infinite-feed-fixture.png'))
 state['mode']='risk'
 for _ in range(6):page.mouse.wheel(0,6000);page.wait_for_timeout(500)
 page.wait_for_function(f"{feed}.shadowRoot.querySelector('.foot button')",timeout=15000)
 calls=state['calls'];page.mouse.wheel(0,3000);page.wait_for_timeout(1500);assert state['calls']==calls
 assert '限制' in page.evaluate(f"{feed}.shadowRoot.querySelector('.foot').textContent")
 ok('risk-control answer pauses loading with a retry button and no further requests')
 state['mode']='ok';page.evaluate(f"{feed}.shadowRoot.querySelector('.foot button').click()")
 page.wait_for_function(f"{feed}.shadowRoot.querySelectorAll('.batch').length>{after}",timeout=15000)
 ok('retry resumes loading')
 page.evaluate("chromeMock.storage.sync.set({homeInfinite:false})");page.wait_for_timeout(400)
 assert page.evaluate(f"!{feed}") and page.locator('.load-more-anchor').count()==1 and not page.evaluate("document.documentElement.hasAttribute('data-btr-infinite')")
 ok('turning the option off removes the feed and restores the native lazy loader')
 assert not errors,errors;ok('no uncaught errors')
 browser.close()
(ROOT/'tests/browser-infinite-results.json').write_text(json.dumps({'scope':'Local feed/nav API answers on a B 站-shaped page; not logged-in Bilibili','results':results},ensure_ascii=False,indent=1))
print('TOTAL',len(results))
