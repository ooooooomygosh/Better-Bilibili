#!/usr/bin/env python3
"""Portable, reproducible MV3 package with a fresh checksum manifest. Stdlib only."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'extension'
manifest = json.loads((EXT / 'manifest.json').read_text())
version = manifest['version']
name = f'BiliThrottle-{version}'
files = {}
for path in sorted(EXT.rglob('*')):
    rel = path.relative_to(EXT)
    if not path.is_file() or path.is_symlink() or rel.parts[0] == 'tests' or '__pycache__' in rel.parts:
        continue
    if rel.as_posix() in {'SHA256SUMS.txt', 'docs/changes.patch'} or path.name.startswith('.'):
        continue
    if rel.parts[0] == 'docs' and path.suffix.lower() in {'.png', '.jpg', '.webp'}:
        continue
    files[rel.as_posix()] = path.read_bytes()
for entry in manifest['content_scripts']:
    for source in entry.get('js', []) + entry.get('css', []):
        if source not in files:
            raise SystemExit(f'Missing packaged content script: {source}')
for source in [manifest['background']['service_worker'], manifest['action']['default_popup'], manifest['options_page']]:
    if source not in files:
        raise SystemExit(f'Missing packaged extension entry: {source}')
files['SHA256SUMS.txt'] = ''.join(f'{hashlib.sha256(body).hexdigest()}  {rel}\n' for rel, body in sorted(files.items())).encode()
epoch = int(os.environ.get('SOURCE_DATE_EPOCH') or subprocess.check_output(['git', '-C', str(ROOT), 'log', '-1', '--format=%ct'], text=True).strip())
stamp = time.gmtime(max(315532800, epoch))[:6]
output = ROOT / 'dist'; output.mkdir(exist_ok=True)
archive = output / f'{name}.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
    for rel, body in sorted(files.items()):
        info = zipfile.ZipInfo(f'{name}/{rel}', stamp)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3; info.external_attr = 0o100644 << 16
        package.writestr(info, body)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n')
print(archive.relative_to(ROOT))
