#!/usr/bin/env bash
# macOS / Linux wrapper; the packager uses only Python's standard library.
set -euo pipefail
exec python3 "$(cd "$(dirname "$0")" && pwd)/build.py"
