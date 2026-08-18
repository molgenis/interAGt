"""OS-keychain-backed storage for the AlphaGenome API key.

Launcher-only, mirroring `helper_functions.py`: not part of `backend/`
because it depends on `keyring`, which only makes sense for the
pywebview-packaged desktop build. `app_launcher.py` mounts this router on
its own top-level app, never on `backend.main`'s app, so the bare
`uvicorn backend.main:app --reload` dev workflow never touches the OS
keychain and the frontend falls back to localStorage there instead.

Service name "interagt" is shared across any future secondary keys stored
this way (e.g. the LLM key from ApiKeyDialog/llmSettings.ts), each under
its own username/key-name.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel

LOGGER = logging.getLogger(__name__)

SERVICE_NAME = "interagt"
ALPHAGENOME_KEY_NAME = "alphagenome_api_key"

keystore_router = APIRouter()


class ApiKeyPayload(BaseModel):
    api_key: str


class ApiKeyResponse(BaseModel):
    api_key: str | None


def _load_keyring():
    try:
        import keyring

        return keyring
    except Exception:
        LOGGER.warning("keystore_backend_unavailable reason=import_failed", exc_info=True)
        return None


@keystore_router.get("/api-key", response_model=ApiKeyResponse)
def get_api_key() -> ApiKeyResponse:
    kr = _load_keyring()
    if kr is None:
        return ApiKeyResponse(api_key=None)
    try:
        value = kr.get_password(SERVICE_NAME, ALPHAGENOME_KEY_NAME)
    except Exception:
        LOGGER.warning("keystore_get_failed", exc_info=True)
        return ApiKeyResponse(api_key=None)
    return ApiKeyResponse(api_key=value)


@keystore_router.post("/api-key", response_model=ApiKeyResponse)
def set_api_key(payload: ApiKeyPayload) -> ApiKeyResponse:
    kr = _load_keyring()
    if kr is None:
        return ApiKeyResponse(api_key=None)
    try:
        if payload.api_key:
            kr.set_password(SERVICE_NAME, ALPHAGENOME_KEY_NAME, payload.api_key)
        else:
            _delete_quietly(kr)
    except Exception:
        LOGGER.warning("keystore_set_failed", exc_info=True)
        return ApiKeyResponse(api_key=None)
    return ApiKeyResponse(api_key=payload.api_key or None)


@keystore_router.delete("/api-key", response_model=ApiKeyResponse)
def clear_api_key() -> ApiKeyResponse:
    kr = _load_keyring()
    if kr is not None:
        _delete_quietly(kr)
    return ApiKeyResponse(api_key=None)


def _delete_quietly(kr) -> None:
    try:
        kr.delete_password(SERVICE_NAME, ALPHAGENOME_KEY_NAME)
    except Exception:
        # No entry to delete, or backend rejected it - either way there is
        # nothing stored, which is the desired end state.
        pass
