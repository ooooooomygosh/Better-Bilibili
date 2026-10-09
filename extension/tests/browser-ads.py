"""Native home-feed ads (current laputa-home markup, rebuilt from B 站's own card template): hidden with
隐藏广告卡片 ON at the first style pass via CSS :has() (no flash), unknown badge markup caught by the
observer fallback, the whole grid item hidden so the native grid has no hole; normal cards untouched.
Mocked chrome.* APIs; no network."""
import json,pathlib,os
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
results=[]
def ok(n):results.append({'test':n,'passed':True});print('PASS',n,flush=True)
HTML='''<!doctype html><html><head><style>
body{margin:0;font:13px sans-serif;background:#18181b;color:#ddd}
.recommended-container_floor-aside .container{display:grid;grid-template-columns:repeat(5,1fr);gap:20px 16px;width:1400px}
.bili-video-card__image{position:relative;aspect-ratio:16/9;background:#334}
.bili-video-card__stats{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between}
</style></head><body><main><div class="recommended-container_floor-aside"><div class="container"></div></div></main></body></html>'''
CARD=r'''window.card=(id,o={})=>{
 const href=o.href||`https://www.bilibili.com/video/BV1${id.padEnd(9,'x')}`;
 const left=o.emptyLeft?'':`<span class="bili-video-card__stats--item"><svg class="bili-video-card__stats--icon"></svg><span class="bili-video-card__stats--text">101.7万</span></span><span class="bili-video-card__stats--item"><svg class="bili-video-card__stats--icon"></svg><span class="bili-video-card__stats--text">679</span></span>`;
 const right=o.right??'<span class="bili-video-card__stats__duration">06:05</span>';
 const inner=`<div class="bili-video-card is-rcmd" data-id="${id}"><div class="bili-video-card__wrap"><a href="${href}" class="bili-video-card__image--link" target="_blank"><div class="bili-video-card__image"><div class="bili-video-card__image--wrap"><picture class="v-img bili-video-card__cover"><img alt=""></picture></div>${o.extraCover||''}<div class="bili-video-card__mask"><div class="bili-video-card__stats"><div class="bili-video-card__stats--left">${left}</div>${right}</div></div></div></a><div class="bili-video-card__info"><div class="bili-video-card__info--right"><h3 class="bili-video-card__info--tit" title="${o.title||'标题 '+id}"><a href="${href}">${o.title||'标题 '+id}</a></h3><div class="bili-video-card__info--bottom"><a class="bili-video-card__info--owner" href="${o.owner||'//space.bilibili.com/1'}"><span class="bili-video-card__info--author">${o.author||'UP'}</span><span class="bili-video-card__info--date">· 9-4</span></a></div></div></div></div></div>`;
 if(o.bare){const t=document.createElement('template');t.innerHTML=inner;return t.content.firstChild;}
 const f=document.createElement('div');f.className='feed-card';f.innerHTML=inner;return f;};'''
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/lib/chromium/chromium'),headless=True,args=['--no-sandbox'])
 ctx=b.new_context(viewport={'width':1500,'height':900})
 ctx.route('https://www.bilibili.com/**',lambda r:r.fulfill(status=200,content_type='text/html',body=HTML))
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('https://www.bilibili.com/')
 # What the previous visit left in the flag mirror: the skin switches on synchronously at document_start.
 page.evaluate("localStorage.setItem('btr-flow-flags',JSON.stringify({clean:true,carousel:true,banner:false,ads:true,infinite:false}))")
 page.add_script_tag(content=(ROOT/'tests/browser-shim.js').read_text());page.add_script_tag(content=(ROOT/'src/home-core.js').read_text());page.add_script_tag(content=CARD)
 page.evaluate("chromeMock.storage.sync.set({homeHideAds:true})")
 page.evaluate("code=>new Function('chrome','location','crypto',code)(window.chromeMock,window.location,{randomUUID:()=>'fixture-tab-1234567890'})",(ROOT/'src/home-enhancer.js').read_text())
 assert page.evaluate("document.documentElement.hasAttribute('data-btr-hide-ads')")
 # Insert the batch and read styles in the same task: nothing has had a chance to run but the CSS.
 same_task=page.evaluate("""()=>{const g=document.querySelector('.container');
  const items=[
   ['n0',card('n0')],
   ['adStats',card('ad1',{emptyLeft:true,right:'<span class="bili-video-card__stats--text">广告</span>',href:'https://www.bilibili.com/blackboard/activity-workbuddy.html',owner:'https://www.bilibili.com/blackboard/activity-workbuddy.html',author:'workbuddy',title:'开学新Buddy，事事都挺你！师生认证立领1000积分'})],
   ['n1',card('n1',{title:'广告人的一天',author:'推广'})],
   ['adRocket',card('ad2',{right:'<svg class="bili-video-card__stats--icon"></svg>'})],
   ['adCm',card('ad3',{href:'https://cm.bilibili.com/cm/api/fees/pc/sync/v2?ad=1'})],
   ['n2',card('n2')],
   ['adBare',card('ad4',{bare:true,right:'<span class="bili-video-card__stats--text">广告</span>'})],
   ['adNew',card('ad5',{extraCover:'<span class="some-future-badge"><i>广告</i></span>'})],
   ['n3',card('n3')],['n4',card('n4')],['n5',card('n5')],['n6',card('n6')]];
  for(const [k,n] of items){n.dataset.k=k;g.append(n);}
  return Object.fromEntries(items.map(([k,n])=>[k,getComputedStyle(n).display]));}""")
 for k in ('adStats','adRocket','adCm','adBare'):assert same_task[k]=='none',(k,same_task)
 for k in ('n0','n1','n2','n3'):assert same_task[k]!='none',(k,same_task)
 ok('ads in current B 站 markup (cover stats 广告 instead of duration, creative rocket icon, cm.bilibili.com link, bare .bili-video-card grid item) are hidden at the first style pass: CSS :has(), no flash')
 page.wait_for_timeout(300)
 assert page.evaluate("getComputedStyle(document.querySelector('[data-k=adNew]')).display")=='none'
 assert page.evaluate("document.querySelector('[data-k=adNew]').hasAttribute('data-btr-ad')")
 ok('unknown badge markup reading exactly 广告 on the cover is caught by the observer fallback (whole grid item marked)')
 vis=page.evaluate("[...document.querySelectorAll('.container > *')].filter(n=>getComputedStyle(n).display!=='none').map(n=>[n.dataset.k,Math.round(n.getBoundingClientRect().x),Math.round(n.getBoundingClientRect().y)])")
 assert [v[0] for v in vis]==['n0','n1','n2','n3','n4','n5','n6'],vis
 xs=sorted({v[1] for v in vis});ys=sorted({v[2] for v in vis})
 assert len(xs)==5 and len(ys)==2 and [v[1] for v in vis]==xs+xs[:2],vis
 ok('hidden ads take their grid item with them: the 7 normal cards fill cells 1–7 with no hole')
 assert page.evaluate("getComputedStyle(document.querySelector('[data-k=n1]')).display")!='none'
 ok('a normal card titled 广告人的一天 by an UP named 推广 stays (no keyword blocking)')
 page.evaluate("chromeMock.storage.sync.set({homeHideAds:false})");page.wait_for_timeout(300)
 shown=page.evaluate("[...document.querySelectorAll('.container > *')].filter(n=>getComputedStyle(n).display!=='none').length")
 assert shown==12,shown
 ok('隐藏广告卡片 OFF shows every native card again')
 assert not errors,errors;ok('no uncaught errors')
 b.close()
(ROOT/'tests/browser-ads-results.json').write_text(json.dumps({'environment':'local fixture rebuilt from laputa-home card template (index-12fc55c2.js), mocked chrome.*','results':results},ensure_ascii=False,indent=1))
print('TOTAL',len(results))
