$args = @(
    "--noconfirm"
    "--clean"
    "--onedir"
    "--windowed"
    "--name", "InterAGt"
    "--icon", "resources/icons/icon.ico"
    "--collect-all", "alphagenome"
    "--collect-all", "plotly"
    "--collect-all", "pandas"
    "--collect-all", "uvicorn"
    "--collect-all", "fastapi"
    "--collect-all", "pywebview"
    "--collect-all", "keyring"
    "--collect-all", "clr_loader"
    "--collect-all", "pythonnet"
    "--hidden-import", "clr"
    "--add-data", "app_launcher.py:."
    "--add-data", "backend:backend"
    "--add-data", "helper_functions.py:."
    "--add-data", "launcher_keystore.py:."
    "--add-data", "resources:resources"
    "--add-data", "frontend/dist:frontend/dist"
    "app_launcher.py"
)
# `python` is what actions/setup-python puts on PATH; the `py` launcher is not
# guaranteed to be installed there. Prefer `python`, fall back to `py` locally.
$python = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { "py" }
& $python -m PyInstaller @args

