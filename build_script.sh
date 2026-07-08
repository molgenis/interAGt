pyinstaller --windowed \
  --noconfirm \
  --clean \
  --onedir \
  --name AGInterpet \
  --collect-all streamlit \
  --collect-all alphagenome \
  --collect-all plotly \
  --collect-all pandas \
  --add-data "main.py:." \
  --add-data "plot_functions.py:." \
  --add-data "resources:resources" \
  --add-data ".streamlit:.streamlit" \
  --add-data "static:static" \
  app_launcher.py 