"""观看周报 (ui/report.html) inside the installed (unpacked) extension. Seeds chrome.storage.local with two
plausible weeks from the service worker, pins the page clock to Sunday 2026-10-18 21:40 (local) so "this week"
is complete, and checks light + dark at 1280×900: key numbers, the week switcher, the share card (1080×1440 PNG),
the empty state, and that a real focus-tick from an extension page is recorded by the service worker (stats on,
quota off). SHOTS=1 also writes the promo screenshots to docs/media/."""
import pathlib,json,os,tempfile,base64,random
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1];REPO=ROOT.parent
results=[]
def ok(n):results.append({'test':n,'passed':True});print('PASS',n,flush=True)

# A student / office-worker week: weekday evenings, a long Wednesday, weekend afternoons. UP names are fictional.
UPS=[('3546101','芝士焗饭研究所'),('2208517','阿蓝的电路板'),('1730964','猫头鹰读书会'),('4412078','山间小厨老周'),('987123','宇宙尽头的地铁站'),('5530021','数学不难君'),('660419','偷懒的程序员')]
THIS=[('2026-10-12',35,[(12,10),(21,25)]),('2026-10-13',50,[(20,20),(22,30)]),('2026-10-14',95,[(12,15),(21,40),(22,40)]),('2026-10-15',40,[(22,40)]),
 ('2026-10-16',70,[(19,30),(23,40)]),('2026-10-17',75,[(14,35),(16,20),(22,20)]),('2026-10-18',35,[(10,15),(20,20)])]
LAST=[('2026-10-05',60,[(21,30),(23,30)]),('2026-10-06',55,[(12,15),(22,40)]),('2026-10-07',80,[(21,40),(23,40)]),('2026-10-08',65,[(20,35),(22,30)]),
 ('2026-10-09',90,[(21,50),(0,40)]),('2026-10-10',110,[(15,50),(22,60)]),('2026-10-11',90,[(14,40),(21,50)])]
BRAKES={'2026-10-14':2,'2026-10-17':1,'2026-10-10':1}
def day(key,mins,spread,weights):
 h=[0]*24
 for hr,m in spread:h[hr]+=m*60
 rnd=random.Random(key);s=mins*60;up={};left=s
 for i,(mid,name) in enumerate(UPS):
  part=int(s*weights[i]);up[mid]=[name,part];left-=part
 return {'s':s,'n':max(1,round(mins/9)),'h':h,'up':{k:v for k,v in up.items() if v[1]>0},'b':BRAKES.get(key,0)}
W_THIS=[.26,.19,.14,.12,.08,.05,.03];W_LAST=[.22,.12,.1,.16,.14,.08,.06]
SEED={'v':1,'days':{**{k:day(k,m,sp,W_THIS) for k,m,sp in THIS},**{k:day(k,m,sp,W_LAST) for k,m,sp in LAST}},'brake':'','noticed':'2026-10-12'}
assert sum(d['s'] for k,d in SEED['days'].items() if k>='2026-10-12')==6*3600+40*60
CLOCK="""(()=>{const D=Date,T=new D(2026,9,18,21,40).getTime(),off=T-D.now();class F extends D{constructor(...a){super(...(a.length?a:[D.now()+off]));}static now(){return D.now()+off;}}globalThis.Date=F;})();"""
SHOTS=os.environ.get('SHOTS')=='1';MEDIA=REPO/'docs/media'
exe=os.environ.get('CHROMIUM_PATH') or None
with sync_playwright() as p:
 ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),channel=None if exe else 'chromium',executable_path=exe,headless=True,
  args=['--no-sandbox',f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'],viewport={'width':1280,'height':900})
 ctx.add_init_script(CLOCK)
 sw=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
 eid=sw.url.split('/')[2];errors=[];url=f'chrome-extension://{eid}/ui/report.html'
 sw.evaluate("s=>chrome.storage.local.set({watchStats:s})",SEED)
 def page(theme):
  sw.evaluate(f"chrome.storage.sync.set({{uiTheme:'{theme}'}})")
  pg=ctx.new_page();pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('console',lambda m:m.type=='error' and errors.append(m.text))
  pg.goto(url);pg.wait_for_function(f"()=>document.documentElement.dataset.theme==='{theme}'&&document.querySelector('#total').textContent!==null&&document.querySelector('#range').textContent",timeout=4000);pg.wait_for_timeout(900)
  return pg
 for theme in ('light','dark'):
  pg=page(theme)
  t=pg.evaluate("""()=>({total:document.querySelector('#total').textContent,line:document.querySelector('#line').textContent,delta:document.querySelector('#delta').textContent,
   videos:document.querySelector('#videos').textContent,brakes:document.querySelector('#brakes').textContent,longest:document.querySelector('#longest').textContent,
   range:document.querySelector('#range').textContent,ups:[...document.querySelectorAll('#ups .name')].map(n=>n.textContent),bars:document.querySelectorAll('#bars path.cur').length,
   ghost:document.querySelectorAll('#bars path.last').length,peak:document.querySelector('#peak').textContent,empty:!document.querySelector('#empty').hidden,
   bg:getComputedStyle(document.body).backgroundColor,hscroll:document.documentElement.scrollWidth>innerWidth})""")
  assert t['total']=='6小时40分',t;assert '少刷 2 小时 30 分' in t['line'] and '节流成功' in t['line'],t
  assert t['delta'].startswith('↓ 27%') and '9 小时 10 分' in t['delta'],t
  assert t['brakes']=='3次' and t['longest'].startswith('周三') and t['range']=='本周 · 10月12日 – 10月18日',t
  assert t['ups'][0]=='芝士焗饭研究所' and len(t['ups'])==5 and t['bars']==7 and t['ghost']==7 and '22:00' in t['peak'] and not t['empty'] and not t['hscroll'],t
  lum=sum(int(x) for x in t['bg'][t['bg'].index('(')+1:t['bg'].index(')')].split(',')[:3])
  assert (lum<150)==(theme=='dark'),t['bg']
  # Hover a bar: the tooltip names the day and both weeks.
  pg.hover('#bars rect.hit >> nth=2');tip=pg.text_content('#tip');assert '周三' in tip and '1 小时 35 分' in tip and '上周 1 小时 20 分' in tip,tip
  pg.mouse.move(5,5)
  if SHOTS:
   bottom=pg.evaluate("document.querySelector('.r-hours').getBoundingClientRect().bottom+scrollY+28")
   pg.screenshot(path=str(MEDIA/('weekly-report.png' if theme=='light' else 'weekly-report-dark.png')),clip={'x':0,'y':0,'width':1280,'height':bottom},full_page=True)
  ok(f'{theme}: 6 小时 40 分 vs 上周 9 小时 10 分 (↓27%, 节流成功), 3 次踩刹车, 最长一天周三, top UP, 7+7 bars, 22 点 peak, bar tooltip, no horizontal scroll')
  # Share card
  pg.click('#share');pg.wait_for_selector('#shareBack:not([hidden])')
  c=pg.evaluate("(()=>{const c=document.querySelector('#card');return {w:c.width,h:c.height,url:c.toDataURL('image/png')}})()")
  png=base64.b64decode(c['url'].split(',')[1]);assert png[:8]==b'\x89PNG\r\n\x1a\n' and c['w']==1080 and c['h']==1440 and len(png)>40000,(c['w'],c['h'],len(png))
  import struct;assert struct.unpack('>II',png[16:24])==(1080,1440)
  if SHOTS and theme=='light':(MEDIA/'weekly-share-card.png').write_bytes(png)
  pg.check('#hideUps');hidden=pg.evaluate("document.querySelector('#card').toDataURL('image/png')");assert hidden!=c['url'],'hiding UP names must change the card'
  pg.uncheck('#hideUps')
  r=pg.evaluate("document.querySelector('#copy').click()");pg.wait_for_function("()=>document.querySelector('#shareMsg').textContent",timeout=3000)
  pg.keyboard.press('Escape');assert pg.is_hidden('#shareBack')
  ok(f'{theme}: share card is a {len(png)//1024} KB 1080×1440 PNG; 隐藏 UP 主名字 redraws it; copy answers ({pg.text_content("#shareMsg")}); Esc closes')
  # Week switcher
  pg.click('#prev');pg.wait_for_timeout(200)
  w=pg.evaluate("[document.querySelector('#range').textContent,document.querySelector('#total').textContent,document.querySelector('#next').disabled,document.querySelector('#line').textContent]")
  assert w[0]=='上周 · 10月5日 – 10月11日' and w[1]=='9小时10分' and w[2] is False and '没有记录' in w[3],w
  pg.click('#prev');assert pg.is_visible('#empty') and pg.is_disabled('#share')
  pg.click('#next');pg.click('#next');assert pg.is_disabled('#next') and pg.text_content('#total')=='6小时40分'
  ok(f'{theme}: 上一周 shows 9 小时 10 分 (no earlier record), two weeks back is the empty state, 下一周 returns and stops at this week')
  pg.close()
 # On B 站 (fixture page, real clock): the weekly notice shows once, 查看 opens the
 # report through the service worker, and real playback of the main player is recorded with its UP (quota off).
 import datetime
 today=datetime.date.today();mon=today-datetime.timedelta(days=today.weekday());lastmon=mon-datetime.timedelta(days=7)
 seed={'v':1,'days':{(lastmon+datetime.timedelta(days=i)).isoformat():{'s':1800+600*i,'n':3,'h':[0]*21+[1800+600*i,0,0],'up':{},'b':0} for i in range(7)},'brake':'','noticed':''}
 sw.evaluate("s=>chrome.storage.local.set({watchStats:s})",seed);sw.evaluate("chrome.storage.sync.set({statsEnabled:true,statsWeeklyNotice:true,focusEnabled:false})")
 ctx.route('https://www.bilibili.com/**',lambda r:r.fulfill(status=200,content_type='text/html; charset=utf-8',
  body='<!doctype html><html><body style="margin:0;background:#fff"><div class="up-info--right"><a class="up-name" href="//space.bilibili.com/3546101?spm=x">\n 芝士焗饭研究所 \n</a></div><video id="v" muted autoplay playsinline style="width:800px;height:450px"></video><canvas id="c" width="160" height="90" hidden></canvas><script>const c=document.getElementById("c"),x=c.getContext("2d");let f=0;setInterval(()=>{x.fillStyle="hsl("+(f++*7%360)+",70%,60%)";x.fillRect(0,0,160,90);},50);const v=document.getElementById("v");v.srcObject=c.captureStream(20);v.play().catch(()=>{});</script></body></html>'))
 b=ctx.new_page();b.on('pageerror',lambda e:errors.append('bili: '+str(e)));b.goto('https://www.bilibili.com/video/BV1xx411c7mD/')
 b.wait_for_function("()=>document.querySelector('[data-btr-toast=btr-weekly]')?.shadowRoot?.textContent.includes('上周观看报告出炉了')",timeout=8000)
 txt=b.evaluate("document.querySelector('[data-btr-toast=btr-weekly]').shadowRoot.querySelector('.body').textContent")
 assert '上周观看报告出炉了：7 小时' in txt and '查看' not in txt,txt
 with ctx.expect_page() as rp:b.evaluate("document.querySelector('[data-btr-toast=btr-weekly]').shadowRoot.querySelector('button.primary').click()")
 rep=rp.value;rep.wait_for_load_state();assert rep.url.endswith('/ui/report.html'),rep.url;rep.close()
 b2=ctx.new_page();b2.goto('https://www.bilibili.com/');b2.wait_for_timeout(3500);assert b2.locator('[data-btr-toast=btr-weekly]').count()==0,'the notice shows once a week';b2.close()
 ok(f'B 站 page: weekly notice "{txt}" shows once, 查看 opens ui/report.html via the service worker')
 played=b.evaluate("new Promise(r=>{const v=document.querySelector('#v');if(!v.paused&&v.readyState>=2)return r(true);v.addEventListener('playing',()=>r(true),{once:true});setTimeout(()=>r(!v.paused&&v.readyState>=2),5000)})")
 if played:
  b.wait_for_timeout(7000)
  r=sw.evaluate("chrome.storage.local.get(['watchStats','focusUsage']).then(v=>({d:v.watchStats.days[Object.keys(v.watchStats.days).sort().pop()],q:v.focusUsage||null}))")
  assert r['d']['s']>=5 and r['d']['up'].get('3546101',[None])[0]=='芝士焗饭研究所' and r['q'] is None,r
  ok(f"real playback with the quota off: {r['d']['s']} s recorded for 芝士焗饭研究所 (mid read from a.up-name), focusUsage untouched, video never paused")
  assert not b.evaluate("document.querySelector('#v').paused")
 else:print('SKIP fixture video did not play in this Chromium build',flush=True)
 b.close()
 # Empty storage -> empty state; a real focus-tick (quota off, stats on) is recorded by the service worker.
 sw.evaluate("chrome.storage.local.remove('watchStats')")
 pg=page('light');assert pg.is_visible('#empty') and pg.is_hidden('#hero') and pg.text_content('#emptyTitle')=='这周还没有观看记录'
 r=pg.evaluate("""async()=>{for(let i=0;i<3;i++)await chrome.runtime.sendMessage({type:'focus-tick',seconds:5,id:'BV1xx411c7mD',up:{mid:'3546101',name:'芝士焗饭研究所'}});
  const {watchStats,focusUsage}=await chrome.storage.local.get(['watchStats','focusUsage']);const d=Object.values(watchStats.days)[0];return {s:d.s,n:d.n,up:d.up,q:focusUsage||null}}""")
 assert r['s']==15 and r['n']==1 and r['up']=={'3546101':['芝士焗饭研究所',15]} and r['q'] is None,r
 ok('empty state without data; focus-tick with the quota off records 15 s / 1 video / UP in watchStats and leaves focusUsage untouched')
 sw.evaluate("chrome.storage.sync.set({statsEnabled:false})");pg.wait_for_timeout(300)
 pg.evaluate("chrome.runtime.sendMessage({type:'focus-tick',seconds:5,id:'BV1xx411c7mD'})")
 s=pg.evaluate("chrome.storage.local.get('watchStats').then(v=>Object.values(v.watchStats.days)[0].s)");assert s==15,s
 ok('statsEnabled off: ticks are not recorded')
 pg.close()
 assert not errors,errors;ok('no uncaught errors on the report page')
 ctx.close()
(ROOT/'tests/browser-report-results.json').write_text(json.dumps({'environment':'unpacked extension in Playwright Chromium (headless), real report.html, clock pinned to 2026-10-18 21:40','results':results},ensure_ascii=False,indent=1))
print('TOTAL',len(results))
