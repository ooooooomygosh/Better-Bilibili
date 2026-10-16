#!/usr/bin/env bash
# Package extension/ as dist/BiliThrottle-<version>.zip (folder BiliThrottle-<version>/ inside, manifest.json at its top).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/extension/manifest.json').version")"
NAME="BiliThrottle-$VERSION"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -r "$ROOT/extension" "$STAGE/$NAME"
# Ship only what the browser loads plus the plain-text docs: tests, fixture media, preview images and the old patch stay in
# the repository (they made the zip ~4x bigger and are not needed to run the extension).
rm -rf "$STAGE/$NAME/tests" "$STAGE/$NAME/docs/changes.patch"
find "$STAGE/$NAME/docs" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.webp' \) -delete
(cd "$STAGE/$NAME" && find . -type f ! -name SHA256SUMS.txt -printf '%P\n' | LC_ALL=C sort | xargs -d '\n' sha256sum > SHA256SUMS.txt)
mkdir -p "$ROOT/dist"
rm -f "$ROOT/dist/$NAME.zip"
(cd "$STAGE" && zip -qr -X "$ROOT/dist/$NAME.zip" "$NAME")
(cd "$ROOT/dist" && sha256sum "$NAME.zip" > "$NAME.zip.sha256")
echo "dist/$NAME.zip"
