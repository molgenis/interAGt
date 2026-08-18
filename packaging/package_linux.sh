#!/bin/bash
# Builds InterAGt with PyInstaller (build_linux.sh) and wraps it into a
# distributable AppImage (dist/InterAGt.AppImage) — the Linux counterpart to
# package_mac.sh (.dmg) and package_win.ps1 (Inno Setup .exe).
#
# Requires appimagetool. It is downloaded automatically if not on PATH; set
# APPIMAGETOOL to point at an existing copy to skip the download.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

./packaging/build_linux.sh

BUILD="dist/InterAGt"
if [ ! -d "$BUILD" ]; then
  echo "error: $BUILD not found (expected build_linux.sh to produce it)" >&2
  exit 1
fi

# appimagetool requires ARCH to be set explicitly; it does not infer it.
ARCH="${ARCH:-$(uname -m)}"
case "$ARCH" in
  x86_64 | aarch64) ;;
  *) echo "error: unsupported arch '$ARCH' (expected x86_64 or aarch64)" >&2; exit 1 ;;
esac

APPDIR="$(mktemp -d)/InterAGt.AppDir"
trap 'rm -rf "$(dirname "$APPDIR")"' EXIT

mkdir -p "$APPDIR/usr/bin" \
         "$APPDIR/usr/share/applications" \
         "$APPDIR/usr/share/icons/hicolor/256x256/apps"

cp -R "$BUILD"/. "$APPDIR/usr/bin/"

# appimagetool looks for the .desktop file and its matching icon at the AppDir
# root; the copies under usr/share are what a desktop environment picks up once
# the AppImage is integrated.
cp resources/icons/icon.png "$APPDIR/InterAGt.png"
cp resources/icons/icon.png "$APPDIR/usr/share/icons/hicolor/256x256/apps/InterAGt.png"

cat > "$APPDIR/InterAGt.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=InterAGt
Comment=Interactive interface for predicting genetic variant effects using AlphaGenome
Exec=InterAGt
Icon=InterAGt
Categories=Science;Biology;
Terminal=false
DESKTOP
cp "$APPDIR/InterAGt.desktop" "$APPDIR/usr/share/applications/"

# QTWEBENGINE_DISABLE_SANDBOX: Chromium's sandbox needs unprivileged user
# namespaces, which Ubuntu 24.04+ AppArmor denies to unpackaged binaries — the
# window would otherwise fail to start. The webview only ever loads
# http://localhost:8000, served by this same process, so the exposure is
# limited to content the app already controls.
cat > "$APPDIR/AppRun" <<'APPRUN'
#!/bin/bash
HERE="$(dirname "$(readlink -f "$0")")"
export QTWEBENGINE_DISABLE_SANDBOX=1
exec "$HERE/usr/bin/InterAGt" "$@"
APPRUN
chmod +x "$APPDIR/AppRun"

if [ -n "${APPIMAGETOOL:-}" ]; then
  TOOL="$APPIMAGETOOL"
elif command -v appimagetool >/dev/null 2>&1; then
  TOOL="$(command -v appimagetool)"
else
  TOOL="$(dirname "$APPDIR")/appimagetool"
  curl -fsSL -o "$TOOL" \
    "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage"
  chmod +x "$TOOL"
fi

rm -f dist/InterAGt.AppImage
# appimagetool is itself an AppImage, so it needs FUSE to self-mount;
# APPIMAGE_EXTRACT_AND_RUN makes it unpack to a temp dir instead, which is what
# lets this work inside CI containers that have no FUSE.
ARCH="$ARCH" APPIMAGE_EXTRACT_AND_RUN=1 "$TOOL" "$APPDIR" dist/InterAGt.AppImage

echo "Installer created at dist/InterAGt.AppImage"
