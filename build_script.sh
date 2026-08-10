pyinstaller --noconfirm \
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
  --add-data "backend:backend" \
  --add-data "helper_functions.py:."\
  --add-data "app_launcher.py:."\
  --add-data "resources:resources" \
  --add-data "frontend/dist:frontend/dist" \
  app_launcher.py 