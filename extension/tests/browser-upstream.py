"""Run upstream MIT regression fixtures against THIS extension's player sources.
All browser requests are served from fixtures; no Bilibili account or CDN is used.
"""
import json, os, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None, headless=True)
    context = browser.new_context()
    def serve(route):
        from urllib.parse import urlparse
        url = urlparse(route.request.url)
        if url.hostname != '127.0.0.1':
            route.abort(); return
        rel = url.path.lstrip('/')
        file = ROOT / ('tests/upstream/' + rel[4:] if rel.startswith('dev/') else rel)
        if not file.is_file():
            route.fulfill(status=404, body='fixture missing'); return
        route.fulfill(path=str(file), content_type='text/javascript' if file.suffix == '.js' else 'text/html')
    context.route('**/*', serve)
    for name in ['native-core-lock', 'bangumi-navigation', 'playback-diagnostics', 'buffer-window']:
        page = context.new_page(); errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(f'http://127.0.0.1:8765/dev/{name}-test.html')
        page.wait_for_function("id=>document.getElementById(id)?.dataset.pass==='true'", arg=f'{name}-result', timeout=30000)
        result = json.loads(page.locator(f'#{name}-result').inner_text())
        assert result['pass'], result
        assert not errors, errors
        results.append({'test': name, 'passed': True, 'result': result})
        print('PASS', name, flush=True); page.close()
    browser.close()
(ROOT / 'tests/browser-upstream-results.json').write_text(json.dumps({'environment': 'Chromium renderer, local fixtures; upstream MIT tests against fork sources', 'results': results}, ensure_ascii=False, indent=2))
print('TOTAL', len(results))
