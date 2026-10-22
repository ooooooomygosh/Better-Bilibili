#!/usr/bin/env python3
"""Run the release browser gate using Playwright's bundled Chromium on every OS."""
import os
from pathlib import Path
import subprocess
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    executable = p.chromium.executable_path
env = {**os.environ, 'CHROMIUM_PATH': executable}
for name in ['browser-upstream.py', 'browser-experience.py', 'browser-report.py', 'engine-browser.py', 'engine-slowstart.py', 'browser-sponsorblock-fixture.py', 'browser-preview-settings.py']:
    print(f'Running {name}', flush=True)
    subprocess.run([sys.executable, str(ROOT / 'extension/tests' / name)], cwd=ROOT, env=env, check=True)
