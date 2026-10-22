#!/usr/bin/env python3
"""Verify all extension source checksums, or regenerate them explicitly with --write."""
import argparse
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'extension'
parser = argparse.ArgumentParser(); parser.add_argument('--write', action='store_true'); args = parser.parse_args()
files = [p for p in sorted(ROOT.rglob('*')) if p.is_file() and not p.is_symlink() and p.name != 'SHA256SUMS.txt' and '__pycache__' not in p.parts and not p.name.startswith('.')]
content = ''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(ROOT).as_posix()}\n' for p in files)
target = ROOT / 'SHA256SUMS.txt'
if args.write:
    target.write_text(content)
elif target.read_text() != content:
    raise SystemExit('Checksum manifest differs. Review changes, then run python3 scripts/checksums.py --write.')
print(f'{len(files)} extension files: checksums {"written" if args.write else "verified"}')
