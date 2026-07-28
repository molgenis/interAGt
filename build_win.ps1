$args = @(
    "--noconfirm"
    "--clean"
    "--onedir"
    "--name", "InterAGt"
    "--collect-all", "alphagenome"
    "--collect-all", "plotly"
    "--collect-all", "pandas"
    "--collect-all", "uvicorn"
    "--collect-all", "fastapi"
    "--add-data", "app_launcher.py:."
    "--add-data", "backend:backend"
    "--add-data", "helper_functions.py:."
    "--add-data", "resources:resources"
    "--add-data", ".streamlit:.streamlit"
    "--add-data", "frontend/dist:frontend/dist"
    "app_launcher.py"
)
py -m PyInstaller @args

