from __future__ import annotations

import logging
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api import health_router, metadata_router, plots_router, variants_router
from backend.core import AppError, configure_logging, get_cors_origins


LOG_FILE_PATH = configure_logging()
LOGGER = logging.getLogger(__name__)


def create_app() -> FastAPI:
    app = FastAPI(title="interAGt API", version="0.1.0")

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid4())
        started_at = perf_counter()

        LOGGER.info(
            "request_started request_id=%s method=%s path=%s query=%s",
            request_id,
            request.method,
            request.url.path,
            request.url.query,
        )

        response = await call_next(request)
        duration_ms = round((perf_counter() - started_at) * 1000, 2)
        response.headers["x-request-id"] = request_id
        LOGGER.info(
            "request_completed request_id=%s method=%s path=%s status_code=%s duration_ms=%s",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_origins(),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        LOGGER.warning(
            "app_error path=%s code=%s status_code=%s message=%s details=%s",
            request.url.path,
            exc.code,
            exc.status_code,
            str(exc),
            exc.details,
        )
        error_body: dict[str, object] = {"code": exc.code, "message": str(exc)}
        if exc.details is not None:
            error_body["details"] = exc.details
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": error_body},
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        LOGGER.warning(
            "validation_error path=%s errors=%s",
            request.url.path,
            jsonable_encoder(exc.errors()),
        )
        return JSONResponse(
            status_code=400,
            content={
                "error": {
                    "code": "invalid_request",
                    "message": "Request validation failed.",
                    "details": jsonable_encoder(exc.errors()),
                }
            },
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(
        request: Request, exc: Exception
    ) -> JSONResponse:
        LOGGER.exception("unexpected_error path=%s", request.url.path)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "An unexpected server error occurred.",
                }
            },
        )

    app.include_router(health_router, tags=["health"])
    app.include_router(metadata_router, prefix="/metadata", tags=["metadata"])
    app.include_router(variants_router, prefix="/variants", tags=["variants"])
    app.include_router(plots_router, prefix="/plots", tags=["plots"])

    LOGGER.info("app_started log_file=%s cors_origins=%s", LOG_FILE_PATH, get_cors_origins())

    return app


app = create_app()
