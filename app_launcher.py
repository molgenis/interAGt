from __future__ import annotations

import argparse
import threading
import subprocess
import atexit
import time
from pathlib import Path

import webview
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

parser = argparse.ArgumentParser(description="AGInterpret app launcher")
parser.add_argument('--dev', action='store_true', help='Run with frontend dev server (Bun)')
parser.add_argument('--build', action='store_true', help='Build frontend, overwrite existing dist')
args = parser.parse_args()

# Import your backend app
from backend.core import get_cors_origins
from backend.main import app as backend_app
from launcher_keystore import keystore_router

# Create the main app
app = FastAPI()

# --dev mode serves the frontend on :4173 (bun run preview) against this
# app on :8000 - genuinely cross-origin, unlike production mode where both
# are :8000. backend_app carries its own CORSMiddleware for routes under
# /api, but that doesn't cover routes registered directly on this top-level
# app, so the keystore router below needs the same origins allowed here too.
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Keychain-backed API key storage. Lives on this top-level app (not on
# backend_app) so bare `uvicorn backend.main:app` never touches the OS
# keychain - the frontend's /api/keystore/api-key request 404s there and
# falls back to localStorage. Must be registered before the /api mount
# below: Starlette matches routes in registration order, and a Mount("/api")
# would otherwise greedily swallow every /api/* path, including this one,
# before it ever reaches these literal routes.
app.include_router(keystore_router, prefix="/api/keystore", tags=["keystore"])

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

        # Wait for Bun to start
        time.sleep(2)

        window_url = "http://localhost:4173"
    else:
        # Production mode: serve static files built into frontend/dist
        window_url = "http://localhost:8000"

    def cleanup():
        if frontend_process and frontend_process.poll() is None:
            print("\nShutting down frontend dev server...")
            frontend_process.terminate()
            frontend_process.wait()

    atexit.register(cleanup)

    # uvicorn's own reload supervisor installs signal handlers, which only
    # works on the main thread. That thread is needed for webview.start()
    # below (required on macOS), so reload is not available here; use
    # `uvicorn --reload` directly for backend auto-reload during development.
    server_thread = threading.Thread(
        target=uvicorn.run,
        args=("app_launcher:app",),
        kwargs={"host": "0.0.0.0", "port": 8000},
        daemon=True,
    )
    server_thread.start()

    # Give uvicorn a moment to bind the port before the window loads it,
    # matching the startup delay the old browser-tab launch used.
    time.sleep(2)

    webview.create_window("InterAGt", window_url)
    webview.start()

    # webview.start() blocks until the window is closed; run cleanup here
    # since atexit only fires on interpreter exit and the daemon uvicorn
    # thread alone won't trigger that.
    cleanup()

if __name__ == "__main__":
    main()