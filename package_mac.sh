#!/bin/bash
# Builds InterAGt.app with PyInstaller (build_script.sh) and wraps it into a
# distributable .dmg (dist/InterAGt.dmg) with an /Applications symlink for
# drag-and-drop install.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

./build_script.sh

APP="dist/InterAGt.app"
if [ ! -d "$APP" ]; then
  echo "error: $APP not found (expected build_script.sh to produce it)" >&2
  exit 1
fi

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

cp -R "$APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

rm -f dist/InterAGt.dmg
hdiutil create -volname "InterAGt" \
  -srcfolder "$STAGING" \
  -ov -format UDZO \
  dist/InterAGt.dmg

echo "Installer created at dist/InterAGt.dmg"
