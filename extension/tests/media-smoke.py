"""Actual Chromium MSE decoding with synthetic local bytes, NOT a Bilibili E2E test.
Run generate-fixtures.sh first. No extension install or outside network is needed.
"""
import base64,json,pathlib,struct,os
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
def representation(name):
 b=(ROOT/'tests/fixtures'/f'{name}.mp4').read_bytes();off=0;init_end=0;idx=None
 while off+8<=len(b):
  n,t=struct.unpack_from('>I4s',b,off)
  if t==b'moov':init_end=off+n-1
  if t==b'sidx':idx=f'{off}-{off+n-1}';break
  if not n:break
  off+=n
 assert idx
 c='mp4a.40.2'
 if name=='video':
  i=b.index(b'avcC');c='avc1.'+b[i+5:i+8].hex()
 return {'name':name,'bytes':base64.b64encode(b).decode(),'rep':{'id':80 if name=='video' else 30280,'baseUrl':f'https://upos-sz-mirrorali.bilivideo.com/synthetic-{name}.m4s','mimeType':f'{name}/mp4','codecs':c,'codecid':7 if name=='video' else 0,'width':480 if name=='video' else 0,'height':270 if name=='video' else 0,'bandwidth':620000 if name=='video' else 64000,'frameRate':'24','SegmentBase':{'Initialization':f'0-{init_end}','indexRange':idx}}}
results=[]
def ok(s):results.append({'test':s,'passed':True});print('PASS',s,flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/lib/chromium/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="player"><video controls autoplay muted width="480" height="270"></video></div></body></html>')
 for n in ['range-core','flow-policy','cdn-resolver','sidx','idm-downloader','native-mse-player']:page.add_script_tag(content=(ROOT/'src'/f'{n}.js').read_text())
 page.evaluate(r'''fixtures=>{
 const data=Object.fromEntries(fixtures.map(x=>[x.rep.baseUrl,new Uint8Array(atob(x.bytes).split('').map(c=>c.charCodeAt(0)))]));
 window.wire={requests:0,bytes:0,credentials:new Set()};window.states=[];window.fatalErrors=[];
 const nativeFetch=async(url,init)=>{
  if(init.signal?.aborted)throw init.signal.reason;
  const bytes=data[url];if(!bytes)throw Error('Unexpected synthetic URL '+url);
  const r=new Headers(init.headers).get('range').match(/^bytes=(\d+)-(\d+)$/);if(!r)throw Error('Range required');
  const start=Number(r[1]),end=Number(r[2]),body=bytes.slice(start,end+1);wire.requests++;wire.bytes+=body.length;wire.credentials.add(init.credentials);
  return new Response(body,{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(body.length)}});
 };
 window.testSettings={enabled:true,mode:'custom',customHosts:['upos-sz-mirrorali.bilivideo.com'],smartPolicy:true,autoConcurrency:true,strategy:'economy',memoryBudgetMB:32};
 const playinfo={data:{quality:80,dash:{duration:24,video:[fixtures[0].rep],audio:[fixtures[1].rep]}}};
 window.testPlayer=__BILI_NATIVE_MSE_PLAYER_FACTORY__.createNativePlayer({container:document.getElementById('player'),playinfo,getSettings:()=>testSettings,nativeFetch,initialTime:0.1,initialResume:true,autoplay:true,onState:s=>states.push({state:s.playerState,ahead:s.bufferedAhead}),onFatal:e=>fatalErrors.push(String(e))});
 }''',[representation('video'),representation('audio')])
 try:
  page.wait_for_function('testPlayer.video.currentTime > 1 && testPlayer.video.videoWidth === 480',timeout=20000)
  ok('Real MediaSource: synthetic H.264 video decodes and playback advances')
  debug=page.evaluate('testPlayer.getDebug()');assert {x['kind']for x in debug['tracks']}=={'video','audio'};assert debug['progressiveAppends']>0
  ok('Real MediaSource: both AAC audio and video tracks append progressively')
  assert page.evaluate('wire.requests')>=6;assert page.evaluate('[...wire.credentials]')==['omit'];ok('Real downloader: init, SIDX and media ranges use no credentials')
  initial_buffer=page.evaluate('Array.from({length:testPlayer.video.buffered.length},(_,i)=>[testPlayer.video.buffered.start(i),testPlayer.video.buffered.end(i)])');assert not any(a<=21<=b for a,b in initial_buffer),initial_buffer
  page.evaluate('testPlayer.video.currentTime=21');page.wait_for_function('testPlayer.video.currentTime > 21.3 && !testPlayer.video.seeking',timeout=20000)
  ok('Real MediaSource: seeking outside initial buffer resumes near requested position')
  page.evaluate('testPlayer.video.playbackRate=2');page.wait_for_function('testPlayer.video.playbackRate===2 && testPlayer.video.currentTime>22',timeout=5000)
  ok('Real MediaSource: playback continues at 2x rate without a codec switch')
  assert not errors,errors;assert not page.evaluate('fatalErrors'),page.evaluate('fatalErrors');ok('Real media test: no uncaught errors or reported fatal playback errors')
  debug=page.evaluate('testPlayer.getDebug()');wire=page.evaluate('({requests:wire.requests,bytes:wire.bytes,credentials:[...wire.credentials]})')
  page.evaluate('testPlayer.destroy(false)');ok('Real MediaSource: player teardown completes')
  (ROOT/'tests/media-results.json').write_text(json.dumps({'browser':browser.version,'environment':'Actual MediaSource decoding with synthetic H264/AAC bytes provided by a local-memory fetch mock; no extension installation, no Bilibili CDN/network, no Bilibili native UI','tests':results,'wire':wire,'buffer_before_seek':initial_buffer,'debug':debug,'uncaught_errors':errors},ensure_ascii=False,indent=2))
  print('TOTAL',len(results))
 except Exception:
  print(json.dumps(page.evaluate('({debug:testPlayer?.getDebug(),states:states.slice(-10),fatalErrors})'),ensure_ascii=False,indent=2));print(errors);raise
 finally:browser.close()
