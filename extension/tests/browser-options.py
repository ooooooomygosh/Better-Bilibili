"""Real options page inside the installed (unpacked) extension: section nav while scrolling with the
mouse wheel at 1280×800 and 1920×1200. Checks that the window is the scroll container, that every
toc link has a real section, and that a section filling more than half of the visible area is lit."""
import pathlib,json,os,tempfile
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
results=[]
def ok(n):results.append({'test':n,'passed':True});print('PASS',n,flush=True)
STATE="""()=>{const top=Math.max(0,document.querySelector('.toc').getBoundingClientRect().bottom),bot=innerHeight-document.querySelector('#savebar').offsetHeight;
 const own=[...document.querySelectorAll('.toc a')].map(a=>{const r=document.querySelector(a.getAttribute('href')).getBoundingClientRect();return [a.getAttribute('href'),Math.max(0,Math.min(r.bottom,bot)-Math.max(r.top,top))/(bot-top)]});
 return {y:scrollY,end:innerHeight+scrollY>=document.documentElement.scrollHeight-4,cur:document.querySelector('.toc a[aria-current=true]')?.getAttribute('href'),own}}"""
with sync_playwright() as p:
 ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),channel='chromium',headless=True,args=['--no-sandbox',f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
 sw=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
 eid=sw.url.split('/')[2];errors=[]
 for w,h in ((1280,800),(1920,1200)):
  pg=ctx.new_page();pg.on('pageerror',lambda e:errors.append(str(e)));pg.set_viewport_size({'width':w,'height':h})
  pg.goto(f'chrome-extension://{eid}/ui/options.html');pg.wait_for_timeout(600)
  info=pg.evaluate("""()=>({se:document.scrollingElement.tagName,scrollers:[...document.querySelectorAll('body *')].filter(e=>e.scrollHeight>e.clientHeight+2&&/(auto|scroll)/.test(getComputedStyle(e).overflowY)&&e.clientHeight>200).length,
   missing:[...document.querySelectorAll('.toc a')].filter(a=>!document.querySelector(a.getAttribute('href'))).length,proxy:!!document.getElementById('proxy')})""")
  assert info=={'se':'HTML','scrollers':0,'missing':0,'proxy':False},info
  pg.mouse.move(w/2,h/2);samples=0;seen=set()
  for i in range(60):
   pg.mouse.wheel(0,100);pg.wait_for_timeout(90)
   s=pg.evaluate(STATE);seen.add(s['cur'])
   if s['end']:
    assert s['cur']=='#help',s;break
   for sec,frac in s['own']:
    if frac>.5:assert s['cur']==sec,(w,h,s)
   samples+=1
  assert len(seen)==6,seen
  ok(f'{w}×{h}: window scrolls; wheel through the page ({samples} samples) lights every section, a section filling >50% of the visible area is always current, page end lights the last')
  pg.close()
 assert not errors,errors;ok('no uncaught errors on the real options page')
 ctx.close()
(ROOT/'tests/browser-options-results.json').write_text(json.dumps({'environment':'unpacked extension in Playwright Chromium (headless), real options.html','results':results},ensure_ascii=False,indent=1))
print('TOTAL',len(results))
