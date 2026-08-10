"""Configuration, error types, and logging setup for the backend."""
from __future__ import annotations

import logging
import logging.config
import os
from pathlib import Path
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Paths and configuration
# ---------------------------------------------------------------------------

BACKEND_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_ROOT.parent
RESOURCES_DIR = Path(
    os.getenv("RESOURCES_DIR", str(PROJECT_ROOT / "resources"))
).expanduser().resolve()
MODEL_CACHE_SIZE = max(1, int(os.getenv("MODEL_CACHE_SIZE", "4")))

# LLM summaries. The key, endpoint and model all arrive in the request body
# (same posture as the AlphaGenome key); these are only the fallbacks used when
# a request omits endpoint/model. Keep in sync with the defaults in
# `frontend/src/llmSettings.ts`.
LLM_CACHE_SIZE = max(1, int(os.getenv("LLM_CACHE_SIZE", "4")))
DEFAULT_LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.mistral.ai/v1")
DEFAULT_LLM_MODEL = os.getenv("LLM_MODEL", "mistral-large-latest")
LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "120"))

DEFAULT_LOG_DIR = PROJECT_ROOT / "logs"
DEFAULT_LOG_FILE = DEFAULT_LOG_DIR / "backend.log"


def get_cors_origins() -> list[str]:
    raw_origins = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:4173,http://127.0.0.1:4173",
    )
    return [origin.strip() for origin in raw_origins.split(",") if origin.strip()]


# ---------------------------------------------------------------------------
# Error hierarchy
# ---------------------------------------------------------------------------


class AppError(Exception):
    code: str = "internal_error"
    status_code: int = 500

    def __init__(
        self,
        message: str,
        code: Optional[str] = None,
        status_code: Optional[int] = None,
        details: Optional[list[dict[str, Any]]] = None,
    ) -> None:
        super().__init__(message)
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.details = details


class InvalidRequestError(AppError):
    code = "invalid_request"
    status_code = 400


class InvalidVariantError(AppError):
    code = "invalid_variant"
    status_code = 400


class MissingApiKeyError(AppError):
    code = "missing_api_key"
    status_code = 401


class UpstreamServiceError(AppError):
    code = "upstream_failure"
    status_code = 502


class MissingLlmKeyError(AppError):
    """No LLM key supplied for an AI-summary request."""

    code = "missing_llm_key"
    status_code = 401


class InvalidLlmCredentialsError(AppError):
    """The LLM endpoint rejected the supplied key."""

    code = "invalid_llm_credentials"
    status_code = 401


class LlmServiceError(AppError):
    """The LLM endpoint was unreachable or failed the request.

    Kept separate from `UpstreamServiceError` so the frontend can tell an
    AlphaGenome outage apart from a misconfigured LLM endpoint.
    """

    code = "llm_failure"
    status_code = 502


class NoVariantResultsError(AppError):
    code = "no_variant_results"
    status_code = 400


class NoTrackDataError(AppError):
    """Raised when none of the requested tracks yielded any plottable data.

    Carries a `details` list of {track, reason_code, message} so the caller
    can tell apart e.g. a track unsupported by the organism from a track x
    tissue combination AlphaGenome simply never measured.
    """

    code = "no_track_data"
    status_code = 400


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------


def get_log_level() -> str:
    return os.getenv("BACKEND_LOG_LEVEL", "INFO").upper()


def get_log_file_path() -> Path:
    raw_path = os.getenv("BACKEND_LOG_FILE")
    if raw_path:
        return Path(raw_path).expanduser().resolve()
    return DEFAULT_LOG_FILE


def configure_logging() -> Path:
    log_file = get_log_file_path()
    try:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        logging.config.dictConfig(
            {
                "version": 1,
                "disable_existing_loggers": False,
                "formatters": {
                    "standard": {
                        "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
                    },
                },
                "handlers": {
                    "console": {
                        "class": "logging.StreamHandler",
                        "formatter": "standard",
                        "level": get_log_level(),
                    },
                    "file": {
                        "class": "logging.FileHandler",
                        "formatter": "standard",
                        "filename": str(log_file),
                        "level": get_log_level(),
                    },
                },
                "root": {
                    "handlers": ["console", "file"],
                    "level": get_log_level(),
                },
            }
        )
    except (PermissionError, OSError) as e:
        # Warning?
        logging.config.dictConfig(
            {
                "version": 1,
                "disable_existing_loggers": False,
                "formatters": {
                    "standard": {
                        "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
                    },
                },
                "handlers": {
                    "console": {
                        "class": "logging.StreamHandler",
                        "formatter": "standard",
                        "level": get_log_level(),
                    },
                },
                "root": {
                    "handlers": ["console"],
                    "level": get_log_level(),
                },
            }
        )
    return log_file