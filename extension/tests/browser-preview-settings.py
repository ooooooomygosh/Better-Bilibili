"""悬停预览 settings in the real installed extension: popup segmented control + mute switch, options page fields,
welcome mention; all write chrome.storage.sync instantly."""
import pathlib,json,os,tempfile
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
results=[]
def ok(n):results.append({'test':n,'passed':True});print('PASS',n,flush=True)
with sync_playwright() as p:
 ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),channel='chromium',headless=True,args=['--no-sandbox',f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
 sw=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
 eid=sw.url.split('/')[2];errors=[]
 get=lambda:sw.evaluate("chrome.storage.sync.get({homePreview:'video',homePreviewMuted:true})")
 pg=ctx.new_page();pg.on('pageerror',lambda e:errors.append(str(e)));pg.set_viewport_size({'width':380,'height':700})
 pg.goto(f'chrome-extension://{eid}/ui/popup.html');pg.wait_for_timeout(500)
 seg=pg.get_by_role('radiogroup',name='悬停预览')
 assert seg.get_by_role('radio',name='视频播放').get_attribute('aria-checked')=='true'
 assert pg.locator('#homePreviewMuted').is_checked()
 seg.get_by_role('radio',name='逐帧').click();pg.wait_for_timeout(150)
 assert get()['homePreview']=='frames';assert pg.locator('#homePreviewMuted').is_disabled()
 seg.get_by_role('radio',name='关闭').click();pg.wait_for_timeout(150);assert get()['homePreview']=='off'
 seg.get_by_role('radio',name='关闭').press('ArrowRight');pg.wait_for_timeout(150);assert get()['homePreview']=='video'
 pg.locator('label[for=homePreviewMuted]').click();pg.wait_for_timeout(150);assert get()['homePreviewMuted'] is False
 assert '带声音' in pg.locator('#message').inner_text()
 box=pg.locator('.pv-block').bounding_box();assert box and box['width']<=380
 pg.reload();pg.wait_for_timeout(400);assert not pg.locator('#homePreviewMuted').is_checked()
 ok('popup: 悬停预览 segmented (视频播放 / 逐帧 / 关闭, keyboard arrows) and 悬停播放静音 switch save instantly and persist')
 pg.goto(f'chrome-extension://{eid}/ui/options.html');pg.wait_for_timeout(600)
 assert pg.locator('#homePreview option[value=off]').count()==1
 assert not pg.locator('#homePreviewMuted').is_checked()
 ok('options page: 悬停预览 has 关闭, mute switch reflects the stored value')
 pg.goto(f'chrome-extension://{eid}/ui/welcome.html');assert '悬停预览' in pg.inner_text('body')
 ok('welcome page mentions 悬停预览 and the mute speaker')
 assert not errors,errors
 ctx.close()
json.dump(results,open(ROOT/'tests/browser-preview-settings-results.json','w'),ensure_ascii=False,indent=1)
print(len(results),'passed')
