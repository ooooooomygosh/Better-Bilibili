"""Slow-link guard: a takeover that delivers no media segment hands the video back to Bilibili's
player and is not retaken automatically; one that delivers keeps playing. Stub player, no network."""
import pathlib,json,os
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
results=[]
def ok(name):results.append({'test':name,'passed':True});print('PASS',name,flush=True)
def script(page,name):page.add_script_tag(content=(ROOT/'src'/name).read_text())
SETUP=r'''(deliver)=>{
 window.__BTR_TEST_STARTUP_WATCH_MS__=1500;
 window.fixtureLocation={hostname:'www.bilibili.com',pathname:'/video/BV1slowLink01/',search:'',href:'https://www.bilibili.com/video/BV1slowLink01/',origin:'https://www.bilibili.com'};
 window.fixtureHistory={pushState(){},replaceState(){}};
 window.calls=[];
 window.__INITIAL_STATE__={videoData:{bvid:'BV1slowLink01',aid:9,cid:301,pages:[{cid:301}]}};
 window.__playinfo__={data:{dash:{duration:600,video:[],audio:[]}}};
 window.player={getManifest:()=>({bvid:'BV1slowLink01',aid:9,cid:301,p:1}),getQuality:()=>({newQ:80,newA:2})};
 window.__BILI_NATIVE_MSE_PLAYER_FACTORY__={createNativePlayer(options){const r={options,destroyed:null};calls.push(r);
  if(deliver)setTimeout(()=>options.onSegment({kind:'video',bytes:65536,pieces:2}),300);
  return{video:document.querySelector('video'),wantsToPlay:()=>true,applySettings(){},updatePlayinfo(){},destroy(o){r.destroyed=o||{};}};}};
 window.fetch=async()=>{throw Error('no network in this fixture')};
}'''
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/lib/chromium/chromium'),headless=True,args=['--no-sandbox'])
 errors=[]
 for deliver in (False,True):
  page=b.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content('<div id="bilibili-player" style="width:640px;height:360px"><video width="640" height="360"></video></div>')
  script(page,'range-core.js');page.evaluate(SETUP,deliver)
  page.evaluate("code=>new Function('location','history',code)(window.fixtureLocation,window.fixtureHistory)",(ROOT/'src/page-hook.js').read_text())
  page.evaluate("postMessage({channel:'__BILI_RANGE_ACCELERATOR_V1__',type:'settings',payload:{enabled:true,mode:'auto',concurrency:8}},'*')")
  page.wait_for_function("calls.length===1",timeout=6000)
  page.wait_for_timeout(3000)
  if not deliver:
   assert page.evaluate("calls[0].destroyed&&calls[0].destroyed.resumeNative===true"),page.evaluate("JSON.stringify(calls.map(c=>c.destroyed))")
   page.wait_for_timeout(9000)  # auto-retake would have fired after 4 s
   assert page.evaluate("calls.length")==1,page.evaluate("calls.length")
   ok('no media segment within the startup window: handed back to Bilibili (resumeNative) and not retaken automatically')
   page.evaluate("postMessage({channel:'__BILI_RANGE_ACCELERATOR_V1__',type:'retry-takeover'},'*')");page.wait_for_function("calls.length===2",timeout=6000)
   ok('a manual retry still takes the video over again')
  else:
   assert page.evaluate("calls.length===1&&calls[0].destroyed===null")
   ok('a takeover that delivers its first segment keeps playing (no false hand-back)')
  page.close()
 page=b.new_page();page.set_content('<video></video>')
 for n in ['range-core.js','flow-policy.js','cdn-resolver.js','sidx.js','idm-downloader.js','native-mse-player.js']:script(page,n)
 native=page.evaluate("Object.getOwnPropertyDescriptor(SourceBuffer.prototype,'buffered').get.toString().includes('[native code]')")
 assert native,'buffered getter patched before any takeover'
 ok('SourceBuffer.buffered is left native until the extension actually takes a player over (Bilibili errors are not attributed to us)')
 page.close()
 assert not errors,errors;ok('no uncaught exceptions')
 b.close()
(ROOT/'tests/engine-slowstart-results.json').write_text(json.dumps({'scope':'page-hook with a stub player; no network','results':results},ensure_ascii=False,indent=1))
print('TOTAL',len(results))
