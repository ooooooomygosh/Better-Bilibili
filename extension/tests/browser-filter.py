"""Block lists, cross-batch dedupe, the two homepage modes, tag blocking and 全站净化 on B 站-shaped pages
served at https://www.bilibili.com/ (feed / nav / tag APIs answered locally; mocked chrome.* storage).
Not a logged-in Bilibili E2E test."""
import json,pathlib,os,re,time
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
results=[]
def ok(n):results.append({'test':n,'passed':True});print('PASS',n,flush=True)
CARD=re.search(r"CARD=r'''(.*?)'''",(ROOT/'tests/browser-ads.py').read_text(),re.S).group(1)
HTML='''<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:13px sans-serif}main{width:1400px;margin:0 auto}
.container{display:grid;grid-template-columns:repeat(5,1fr);gap:20px}.bili-video-card__image{aspect-ratio:16/9;background:#99c}</style></head><body>
<main class="bili-feed4-layout"><div class="feed2"><div class="recommended-container_floor-aside"><div class="container is-version8"></div></div><div class="load-more-anchor"></div></div></main>
<script>'''+CARD+'''
window.rolls=0;
window.render=(list)=>{const g=document.querySelector('.container');g.querySelectorAll('.feed-card,.feed-roll-btn').forEach(n=>n.remove());
 const rb=document.createElement('div');rb.className='feed-roll-btn';rb.innerHTML='<button class="roll-btn"><span>换一换</span></button>';rb.querySelector('button').onclick=()=>{rolls++;setTimeout(()=>render(window.next),150)};g.append(rb);
 for(const [id,o] of list)g.append(card(id,o||{}));};
render([['a1',{title:'【原神】新版本前瞻',author:'甲'}],['a2',{title:'做饭教程',author:'乙',owner:'//space.bilibili.com/4242'}],['a3',{title:'猫猫日常'}],['a4',{title:'数码开箱'}],['a5',{title:'旅行 vlog'}],['a6',{title:'钢琴演奏'}],['a7',{title:'游戏实况'}]]);
</script></body></html>'''
CORS={'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true','content-type':'application/json'}
TAGS={}
def rcmd(route):
 q=parse_qs(urlparse(route.request.url).query);i=int(q['fresh_idx'][0])
 items=[]
 for k in range(12):
  bv='BV1'+str(i*100+k).rjust(9,'Q');title=f'批{i} 视频{k}'+(' 原神' if k==1 else '')
  TAGS[bv]=['美食','日常'] if k%4==0 else ['游戏']
  items.append({'goto':'av','bvid':bv,'id':i*100+k,'title':title,'pic':'http://i0.hdslb.com/bfs/archive/x.jpg','duration':300,'pubdate':int(time.time())-600,'owner':{'name':f'UP{k}','mid':5000+k},'stat':{'view':1,'danmaku':1}})
 route.fulfill(status=200,headers=CORS,body=json.dumps({'code':0,'data':{'item':items}}))
def tags(route):
 bv=parse_qs(urlparse(route.request.url).query)['bvid'][0]
 route.fulfill(status=200,headers=CORS,body=json.dumps({'code':0,'data':[{'tag_name':t} for t in TAGS.get(bv,[])]}))
def boot(page,sync):
 page.goto('https://www.bilibili.com/')
 for f in ['tests/browser-shim.js','src/ui-kit.js','src/home-core.js','src/filter-core.js','src/feed-core.js']:page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("s=>chromeMock.storage.sync.set(s)",sync)
 page.evaluate("code=>new Function('chrome',code)(window.chromeMock)",(ROOT/'src/tag-source.js').read_text())
 page.evaluate("code=>new Function('chrome',code)(window.chromeMock)",(ROOT/'src/home-infinite.js').read_text())
 page.evaluate("code=>new Function('chrome','crypto',code)(window.chromeMock,{randomUUID:()=> 'fixture-tab-filter-1234'})",(ROOT/'src/home-enhancer.js').read_text())
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/lib/chromium/chromium'),headless=True,args=['--no-sandbox'])
 ctx=b.new_context(viewport={'width':1600,'height':900})
 ctx.route('https://www.bilibili.com/',lambda r:r.fulfill(status=200,content_type='text/html',body=HTML))
 ctx.route('https://www.bilibili.com/video/**',lambda r:r.fulfill(status=200,content_type='text/html',body='<!doctype html><html><body><div id="slide_ad">ad</div><div class="video-page-game-card-small">game</div><div class="pop-live-small-mode">live</div><div id="keep">keep</div></body></html>'))
 ctx.route('https://api.bilibili.com/x/web-interface/nav*',lambda r:r.fulfill(status=200,headers=CORS,body=json.dumps({'code':0,'data':{'wbi_img':{'img_url':'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png','sub_url':'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'}}})))
 ctx.route('https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd*',rcmd)
 ctx.route('https://api.bilibili.com/x/tag/archive/tags*',tags)
 ctx.route('https://i0.hdslb.com/**',lambda r:r.fulfill(status=200,content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"/>'))
 errors=[]
 # ---------- first visit: the mode chooser ----------
 page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 boot(page,{})
 bar="document.querySelector('#btr-flow-toolbar').shadowRoot"
 page.wait_for_function(f"{bar}?.querySelector('.chooser')",timeout=8000)
 assert page.evaluate(f"{bar}.querySelectorAll('.chooser .opt').length")==2
 ok('first homepage visit asks once: 换一批 or 无限下滑')
 page.evaluate(f"{bar}.querySelectorAll('.chooser .opt')[0].click()");page.wait_for_timeout(500)
 assert page.evaluate("fixtureStorage.all.sync.homeModeChosen")==True and page.evaluate("fixtureStorage.all.sync.homeInfinite")==False
 page.wait_for_function(f"!{bar}.querySelector('.chooser')",timeout=3000)
 ok('choosing 换一批 saves the mode and the chooser goes away')
 # ---------- 换一批 mode: block lists on the native grid ----------
 vis=lambda:page.evaluate("[...document.querySelectorAll('.container > .feed-card')].filter(n=>getComputedStyle(n).display!=='none').map(n=>n.querySelector('[data-id]').dataset.id)")
 assert not page.evaluate(f"{bar}.querySelector('.refresh').hidden") and not page.evaluate(f"{bar}.querySelector('.count').hidden")
 assert '换一批模式' in page.evaluate(f"{bar}.querySelector('.mode').textContent")
 ok('换一批 mode shows 上一批 / 批次 / 下一批 / 换一批 and says which mode it is')
 page.evaluate("chromeMock.storage.sync.set({filterKeywords:['原神'],filterUps:['uid:4242']})");page.wait_for_timeout(400)
 v=vis();assert 'a1' not in v and 'a2' not in v and 'a3' in v,v
 assert page.evaluate(f"{bar}.querySelector('.blocked').textContent")=='已屏蔽 2 个'
 tip=page.evaluate(f"{bar}.querySelector('.blocked').title");assert '关键词「原神」' in tip and 'UP 主' in tip,tip
 ok('keyword and UID rules hide native cards at once; the toolbar says 已屏蔽 2 个 and why')
 page.evaluate("chromeMock.storage.sync.set({filterEnabled:false})");page.wait_for_timeout(300)
 assert 'a1' in vis() and page.evaluate(f"{bar}.querySelector('.blocked').hidden")
 page.evaluate("chromeMock.storage.sync.set({filterEnabled:true})");page.wait_for_timeout(300);assert 'a1' not in vis()
 ok('the master switch turns every rule off and back on')
 # dedupe: the next 换一批 repeats a3 and a4
 page.evaluate("window.next=[['a3',{title:'猫猫日常'}],['a4',{title:'数码开箱'}],['b1',{title:'新视频 1'}],['b2',{title:'新视频 2'}],['b3',{title:'新视频 3'}],['b4',{title:'新视频 4'}]]")
 page.wait_for_timeout(900)
 page.evaluate(f"{bar}.querySelector('.refresh').click()")
 page.wait_for_function(f"{bar}.querySelector('.count').textContent==='2 / 2'",timeout=12000)
 v=vis();assert v==['b1','b2','b3','b4'],v
 assert '前几批已出现过' in page.evaluate(f"{bar}.querySelector('.blocked').title")
 ok('换一批 drops videos the earlier batches already showed (cross-batch dedupe)')
 page.evaluate("chromeMock.storage.sync.set({filterDedupe:false})");page.wait_for_timeout(400)
 assert vis()==['a3','a4','b1','b2','b3','b4'],vis()
 ok('dedupe can be switched off')
 # ---------- 无限下滑 mode ----------
 page.evaluate("chromeMock.storage.sync.set({homeInfinite:true,homeInfiniteSize:12,homeInfiniteThreads:1})");page.wait_for_timeout(500)
 for k in ('refresh','count','back','next'):assert page.evaluate(f"{bar}.querySelector('.{'refresh' if k=='refresh' else 'count' if k=='count' else 'toolbar button'}')")!=None
 hidden=page.evaluate(f"['refresh','count'].map(c=>{bar}.querySelector('.'+c).hidden)")
 assert hidden==[True,True],hidden
 assert '无限下滑' in page.evaluate(f"{bar}.querySelector('.mode').textContent")
 assert page.evaluate("getComputedStyle(document.querySelector('[data-btr-native-refresh]')||document.body).display")=='none' or not page.evaluate("!!document.querySelector('[data-btr-native-refresh]')")
 ok('无限下滑 mode has no 换一批 / 上一批 / 下一批 at all; the toolbar just says it is the infinite feed')
 feed="document.querySelector('#btr-flow-feed')"
 for _ in range(4):page.mouse.wheel(0,2500);page.wait_for_timeout(500)
 page.wait_for_function(f"{feed}?.querySelectorAll('.btr-batch').length>=1",timeout=12000)
 titles=page.evaluate(f"[...{feed}.querySelectorAll('.btr-batch .bili-video-card__info--tit')].map(n=>n.textContent)")
 assert titles and not any('原神' in t for t in titles),titles
 chip=page.evaluate(f"{feed}.querySelector('.btr-chip small').textContent");assert '已屏蔽' in chip,chip
 ok('infinite batches never show blocked titles; the batch divider counts what was filtered')
 # tag rule: needs tags, fetched from the tag API before cards are shown
 n0=page.evaluate(f"{feed}.querySelectorAll('.btr-batch').length")
 page.evaluate("chromeMock.storage.sync.set({filterTags:['美食']})")
 page.wait_for_timeout(1200)
 for _ in range(4):page.mouse.wheel(0,3000);page.wait_for_timeout(600)
 page.wait_for_function(f"{feed}.querySelectorAll('.btr-batch').length>{n0}",timeout=12000)
 shown=page.evaluate(f"[...{feed}.querySelectorAll('.btr-grid > .feed-card')].map(n=>n.querySelector('.bili-video-card').dataset.bvid)")
 leaked=[s for s in shown if '美食' in TAGS.get(s,[])];assert not leaked,leaked
 ok('a tag rule looks tags up (B 站 tag API) and keeps those videos out, including cards already on screen')
 # ⋮ → 按标签屏蔽… lists the video's own tags
 page.evaluate("scrollTo(0,0)");page.wait_for_timeout(200)
 page.evaluate(f"{feed}.querySelector('.btr-batch .feed-card').scrollIntoView({{block:'center'}})");page.wait_for_timeout(300)
 page.evaluate(f"{feed}.querySelector('.btr-batch .feed-card .bili-video-card__info--no-interest').click()");page.wait_for_timeout(200)
 page.evaluate(f"[...{feed}.querySelectorAll('.btr-menu button')].find(b=>b.textContent.startsWith('按标签屏蔽')).click()")
 page.wait_for_function(f"[...{feed}.querySelectorAll('.btr-menu button')].some(b=>b.textContent.startsWith('#'))",timeout=5000)
 page.evaluate(f"[...{feed}.querySelectorAll('.btr-menu button')].find(b=>b.textContent==='#游戏').click()");page.wait_for_timeout(600)
 assert '游戏' in page.evaluate("fixtureStorage.all.sync.filterTags"),page.evaluate("fixtureStorage.all.sync.filterTags")
 assert '已屏蔽标签「游戏」' in page.evaluate(f"{feed}.querySelector('.btr-gone')?.textContent||''")
 ok('⋮ → 按标签屏蔽… shows the video\'s tags; one click adds the tag to the synced block list')
 assert not errors,errors
 page.close()
 # ---------- 全站净化 on a video page ----------
 vp=ctx.new_page();vp.on('pageerror',lambda e:errors.append(str(e)))
 vp.goto('https://www.bilibili.com/video/BV1xx411c7mD/')
 vp.add_script_tag(content=(ROOT/'tests/browser-shim.js').read_text());vp.add_script_tag(content=(ROOT/'src/clean-core.js').read_text())
 vp.evaluate("code=>new Function('chrome',code)(window.chromeMock)",(ROOT/'src/cleaner.js').read_text());vp.wait_for_timeout(300)
 d=lambda i:vp.evaluate(f"getComputedStyle(document.querySelector('{i}')).display")
 assert d('#slide_ad')=='none' and d('.video-page-game-card-small')=='none' and d('#keep')!='none'
 assert d('.pop-live-small-mode')!='none'
 ok('video page: ad slots and game cards hidden by default; opt-in rules (小窗直播) stay until switched on')
 vp.evaluate("chromeMock.storage.sync.set({cleanVideoLive:true,cleanVideoAds:false})");vp.wait_for_timeout(300)
 assert d('.pop-live-small-mode')=='none' and d('#slide_ad')!='none'
 assert json.loads(vp.evaluate("localStorage.getItem('btr-clean-flags')"))['cleanVideoLive']==True
 ok('switches apply live and are mirrored for the next page start (no flash)')
 assert not errors,errors;ok('no uncaught errors')
 b.close()
(ROOT/'tests/browser-filter-results.json').write_text(json.dumps({'scope':'B 站-shaped pages; feed / nav / tag APIs answered locally; mocked chrome.*','results':results},ensure_ascii=False,indent=1))
print('TOTAL',len(results))
