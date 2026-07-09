import os
import sys
import threading
import webbrowser
from streamlit.web import cli as stcli


if __name__ == "__main__":
    base_path = getattr(
        sys,
        "_MEIPASS",
        os.path.dirname(os.path.abspath(__file__))
    )

    app_path = os.path.join(base_path, "main.py")

    # Open browser after a short delay
    threading.Timer(
        2.0,
        lambda: webbrowser.open("http://localhost:8501")
    ).start()

    sys.argv = [
        "streamlit",
        "run",
        app_path,
        "--server.port=8501",
        "--server.headless=true",
        "--browser.gatherUsageStats=false",
        "--global.developmentMode=false",
    ]

    stcli.main()