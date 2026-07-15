pyinstaller --noconfirm \
  --clean \
  --onedir \
  --name AGInterpret \
  --collect-all streamlit \
  --collect-all alphagenome \
  --collect-all plotly \
  --collect-all pandas \
  --add-data "main.py:." \
  --add-data "plot_functions.py:." \
  --add-data "helper_functions.py:." \
  --add-data "resources:resources" \
  --add-data ".streamlit:.streamlit" \
  --add-data "static:static" \
  app_launcher.py 