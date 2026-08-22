#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# `python` is what actions/setup-python puts on PATH; a bare `python` is not
# guaranteed to exist on a plain macOS install. Prefer `python`, fall back to
# `python3` locally.
PYTHON="$(command -v python || command -v python3)"

# Get the path to certifi's CA bundle
CERTIFI_CA_BUNDLE=$("$PYTHON" -m certifi)

"$PYTHON" -m PyInstaller --noconfirm \
  --clean \
  --onedir \
  --windowed \
  --name InterAGt \
  --icon resources/icons/icon.icns \
  --collect-all alphagenome \
  --collect-all plotly \
  --collect-all pandas \
  --collect-all uvicorn \
  --collect-all fastapi \
  --collect-all pywebview \
  --collect-all keyring \
  --collect-all certifi \
  --add-data "backend:backend" \
  --add-data "helper_functions.py:."\
  --add-data "launcher_keystore.py:."\
  --add-data "app_launcher.py:."\
  --add-data "resources:resources" \
  --add-data "frontend/dist:frontend/dist" \
  --add-data "$CERTIFI_CA_BUNDLE:." \
  app_launcher.py 