#!/bin/bash
# Linux counterpart to build_mac.sh (macOS) / build_win.ps1 (Windows).
# Produces the PyInstaller onedir build at dist/InterAGt/.
#
# The Linux-specific parts, versus build_mac.sh:
#   * pywebview has no OS-provided webview on Linux, so the Qt backend is used.
#     PyQt6-WebEngine ships its own Chromium as a pip wheel (installed via
#     `pip install pywebview[qt]`), which PyInstaller's bundled PyQt6 hooks
#     collect reliably. That is what makes the artifact self-contained; the GTK
#     backend would instead require WebKitGTK present on the user's machine.
#   * --windowed and --icon are macOS/Windows-only PyInstaller options and are
#     dropped here. The Linux desktop entry and icon are applied by
#     package_linux.sh when it assembles the AppImage.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# `python` is what actions/setup-python puts on PATH; fall back to `python3`
# locally, matching build_mac.sh.
PYTHON="$(command -v python || command -v python3)"

"$PYTHON" -m PyInstaller --noconfirm \
  --clean \
  --onedir \
  --name InterAGt \
  --collect-all alphagenome \
  --collect-all plotly \
  --collect-all pandas \
  --collect-all uvicorn \
  --collect-all fastapi \
  --collect-all pywebview \
  --collect-all keyring \
  --collect-all qtpy \
  --hidden-import PyQt6.QtWebEngineCore \
  --hidden-import PyQt6.QtWebEngineWidgets \
  --add-data "backend:backend" \
  --add-data "helper_functions.py:."\
  --add-data "launcher_keystore.py:."\
  --add-data "app_launcher.py:."\
  --add-data "resources:resources" \
  --add-data "frontend/dist:frontend/dist" \
  app_launcher.py
