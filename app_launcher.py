import argparse
import threading
import subprocess
import webbrowser
import atexit
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

parser = argparse.ArgumentParser(description="AGInterpret app launcher")
parser.add_argument('--dev', action='store_true', help='Run with frontend dev server (Bun)')
parser.add_argument('--build', action='store_true', help='Build frontend, overwrite existing dist')
args = parser.parse_args()

# Import your backend app
from backend.main import app as backend_app

# Create the main app
app = FastAPI()

# Mount backend under /api
app.mount("/api", backend_app)

def build_and_copy_frontend() -> None:
    """Build frontend from source and copy to package directory."""
    frontend_src = Path(__file__).parent / "frontend"
    print("Building frontend...")
    subprocess.run(["bun", "run", "build"], cwd=frontend_src, check=True)

# Only mount frontend static files in production mode
if not args.dev:
    frontend_dist = Path(__file__).parent / "frontend" / "dist"
    if frontend_dist.exists() and not args.build:
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
    else:
        build_and_copy_frontend()
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

# Mount static assets (always available)
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


def main():
    import uvicorn

    frontend_process = None

    if args.dev:
        # Start Bun dev server
        frontend_src = Path(__file__).parent / "frontend"
        build_and_copy_frontend()
        print("Starting frontend development server (Bun) on port 5173...")
        frontend_process = subprocess.Popen(
            ["bun", "run", "preview"],
            cwd=frontend_src,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # Ensure frontend process is cleaned up on exit
        def cleanup():
            if frontend_process and frontend_process.poll() is None:
                print("\nShutting down frontend dev server...")
                frontend_process.terminate()
                frontend_process.wait()

        atexit.register(cleanup)

        # Wait for Bun to start
        time.sleep(2)

        # Open browser to frontend dev server
        def open_browser():
            webbrowser.open("http://localhost:4173")

        threading.Timer(1.0, open_browser).start()
    else:
        # Production mode: build and serve static files

        def open_browser():
            webbrowser.open("http://localhost:8000")

        threading.Timer(2.0, open_browser).start()

    try:
        # Start FastAPI
        uvicorn.run(
            "app_launcher:app",
            host="0.0.0.0",
            port=8000,
            reload=args.dev  # Enable reload in dev mode
        )
    except KeyboardInterrupt:
        pass
    finally:
        if frontend_process and frontend_process.poll() is None:
            frontend_process.terminate()
            frontend_process.wait()

if __name__ == "__main__":
    main()