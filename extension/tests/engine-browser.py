"""Interactive CID routing + diagnostic UI, using a stub native player and fetch.
Based on upstream issue34 regression scenarios. No external navigation or network.
"""
import pathlib,json,os
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
results=[]
def ok(name):results.append({'test':name,'passed':True});print('PASS',name,flush=True)
def script(page,name):page.add_script_tag(content=(ROOT/'src'/name).read_text())
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/lib/chromium/chromium'),headless=True,args=['--no-sandbox'])
 page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('<div id="bilibili-player" style="width:640px;height:360px"><video width="640" height="360"></video></div>')
 script(page,'range-core.js')
 page.evaluate(r'''()=>{
 window.fixtureLocation={hostname:'www.bilibili.com',pathname:'/video/BV1steinGate1/',search:'',href:'https://www.bilibili.com/video/BV1steinGate1/',origin:'https://www.bilibili.com'};
 window.fixtureHistory={pushState(){},replaceState(){}};
 window.branch=101;window.calls=[];window.apiRequests=[];
 window.__INITIAL_STATE__={videoData:{bvid:'BV1steinGate1',aid:7,cid:101,pages:[{cid:101}],rights:{is_stein_gate:1}}};
 window.__playinfo__={data:{dash:{duration:6,video:[],audio:[]},marker:'n101'}};
 window.player={getManifest:()=>({bvid:'BV1steinGate1',aid:7,cid:branch,p:1}),getQuality:()=>({newQ:80,newA:2})};
 window.__BILI_NATIVE_MSE_PLAYER_FACTORY__={createNativePlayer(options){const record={route:options.identity.key,marker:options.playinfo?.data?.marker,options,updates:[]};calls.push(record);return{video:document.querySelector('video'),applySettings(){},updatePlayinfo(p){record.updates.push(p.data?.marker);},destroy(){record.destroyed=true;}};}};
 window.fetch=async input=>{const url=new URL(String(input),fixtureLocation.href);apiRequests.push(url.href);await new Promise(r=>setTimeout(r,5));if(url.pathname==='/x/web-interface/view')return new Response(JSON.stringify({code:0,data:{aid:7,bvid:'BV1steinGate1',cid:101,pages:[{cid:101}]}}));if(url.pathname.includes('playurl'))return new Response(JSON.stringify({code:0,data:{dash:{duration:6,video:[],audio:[]},marker:'n'+url.searchParams.get('cid')}}));throw Error('unexpected fixture request');};
 }''')
 page.evaluate("code=>new Function('location','history',code)(window.fixtureLocation,window.fixtureHistory)",(ROOT/'src/page-hook.js').read_text())
 page.evaluate("postMessage({channel:'__BILI_RANGE_ACCELERATOR_V1__',type:'settings',payload:{enabled:true,mode:'mainland',concurrency:32}},'*')")
 page.wait_for_function("calls.length===1&&calls[0].marker==='n101'",timeout=6000)
 assert page.evaluate('calls[0].route')=='bv1steingate1:p1'
 ok('interactive first branch comes from embedded playinfo')
 assert page.evaluate('calls[0].options.preferredAudio')==2
 ok('native newA audio preference reaches the takeover factory')
 page.evaluate("(async()=>{await fetch('https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1steinGate1&cid=202');await fetch('https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1steinGate1&cid=303');})()")
 page.wait_for_timeout(150);assert page.evaluate('calls.length')==1;assert page.evaluate('calls[0].updates.length')==0
 ok('prefetched interactive branches do not interrupt the current branch')
 page.evaluate('branch=202;calls.at(-1).options.onNativeSourceChange()')
 page.wait_for_function("calls.at(-1).route==='bv1steingate1:p1:n202'&&calls.at(-1).marker==='n202'",timeout=6000)
 assert page.evaluate("apiRequests.filter(u=>new URL(u).searchParams.get('cid')==='202').length")==1
 ok('switching to a prefetched branch reuses that branch without duplicate playurl fetch')
 page.evaluate('branch=404;calls.at(-1).options.onNativeSourceChange()')
 page.wait_for_function("calls.at(-1).route==='bv1steingate1:p1:n404'&&calls.at(-1).marker==='n404'",timeout=6000)
 assert page.evaluate("apiRequests.filter(u=>new URL(u).searchParams.get('cid')==='404').length")==1
 assert not page.evaluate("apiRequests.some(u=>u.includes('/x/web-interface/view'))")
 ok('uncached branch is requested by its own CID, not the first branch CID')
 page.evaluate('branch=101;calls.at(-1).options.onNativeSourceChange()')
 page.wait_for_function("calls.at(-1).route==='bv1steingate1:p1'&&calls.at(-1).marker==='n101'",timeout=6000)
 ok('returning to the first branch restores the first branch identity')
 # Settings panel with a controlled diagnostic report; no actual clipboard or account access.
 panel=b.new_page();panel.on('pageerror',lambda e:errors.append(str(e)));panel.set_content('<html><body>Local settings fixture</body></html>')
 for n in ['range-core.js','cdn-resolver.js','diagnostics-core.js','settings-panel.js']:script(panel,n)
 panel.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text;}}});window.__biliThreadRipperDebug={report:()=>JSON.stringify({version:'1.1.0',test:'https://a.bilivideo.com/x.m4s?upsig=private',page:'https://www.bilibili.com/video/BV1example?token=private'})};")
 panel.evaluate("postMessage({channel:'__BILI_RANGE_ACCELERATOR_V1__',type:'settings',payload:{debugNotices:true}},'*')")
 panel.wait_for_timeout(100);panel.evaluate('__BTR_SETTINGS_PANEL__.open()')
 panel.locator('#debug-copy').click();panel.wait_for_function("typeof copied==='string'")
 copied=panel.evaluate('copied');assert '1.1.0' in copied and '2026.10.4.1' in copied and 'MV3' in copied
 assert 'upsig' not in copied and 'private' not in copied and 'x.m4s' not in copied
 assert panel.locator('#github-link').get_attribute('target')=='_blank'
 ok('diagnostic copy includes fork/upstream versions and redacts signed media addresses')
 panel.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('fixture denied')}}});document.execCommand=()=>false")
 panel.locator('#debug-copy').click();assert panel.locator('#debug-copy-text').is_visible();assert panel.locator('#debug-copy-text').get_attribute('readonly') is not None
 ok('clipboard denial offers selected read-only diagnostic text instead of failing silently')
 assert not errors,errors;ok('no uncaught exceptions in branch routing or diagnostic UI scenarios')
 (ROOT/'tests/engine-browser-results.json').write_text(json.dumps({'browser':b.version,'environment':'Renderer fixture, stub native player/fetch/clipboard; not live Bilibili or HDR hardware validation','tests':results,'uncaught_errors':errors},ensure_ascii=False,indent=2))
 print('TOTAL',len(results));b.close()
