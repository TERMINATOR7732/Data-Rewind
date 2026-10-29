"""Data Rewind FastAPI application entry point.

Conforms to SPEC-MOD-07 §1.1, §2, §3, and §4.
Bound strictly to loopback (127.0.0.1).
Configured with strict CORS origin guards and standardized error envelopes.
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from data_rewind import __version__
from data_rewind.api.routers import (
    comparisons,
    datasets,
    health,
    pipelines,
    reports,
    scenarios,
    verifications,
    workspaces,
)
from data_rewind.api.schemas import ErrorDetail, ErrorEnvelope
from data_rewind.core.domain.errors import DataRewindError

logger = logging.getLogger("data_rewind.api")


def create_app() -> FastAPI:
    """Create and configure the Data Rewind FastAPI application."""
    app = FastAPI(
        title="Data Rewind API",
        description="Local-first forensic pipeline investigation and fix-verification workbench API.",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    # Loopback origin security with narrow hosted origin expansion
    allowed_origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]
    custom_cors = os.getenv("DATA_REWIND_CORS_ORIGINS")
    if custom_cors:
        for origin in custom_cors.split(","):
            cleaned = origin.strip().rstrip("/")
            if cleaned and cleaned not in allowed_origins:
                allowed_origins.append(cleaned)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Standardized error handlers conforming to SPEC-MOD-07 §4
    @app.exception_handler(DataRewindError)
    async def data_rewind_error_handler(request: Request, exc: DataRewindError) -> JSONResponse:
        error_detail = ErrorDetail(
            code=exc.code,
            message=str(exc),
            details=exc.details,
            remediation=exc.details.get("remediation") if exc.details else None,
            timestamp=datetime.now(UTC).isoformat(),
        )
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content=ErrorEnvelope(error=error_detail).model_dump(),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        error_detail = ErrorDetail(
            code="REQUEST_VALIDATION_ERROR",
            message="The submitted request body or parameters failed schema validation.",
            details={"errors": exc.errors()},
            remediation="Ensure all required parameters adhere to the API contract.",
            timestamp=datetime.now(UTC).isoformat(),
        )
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=ErrorEnvelope(error=error_detail).model_dump(),
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        detail: Any = exc.detail
        if isinstance(detail, dict) and "code" in detail:
            error_detail = ErrorDetail(
                code=str(detail.get("code", "HTTP_ERROR")),
                message=str(detail.get("message", "An HTTP error occurred.")),
                details=detail.get("details", {}),
                remediation=detail.get("remediation"),
                timestamp=datetime.now(UTC).isoformat(),
            )
        else:
            error_detail = ErrorDetail(
                code=f"HTTP_{exc.status_code}",
                message=str(detail),
                timestamp=datetime.now(UTC).isoformat(),
            )
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorEnvelope(error=error_detail).model_dump(),
        )

    @app.exception_handler(Exception)
    async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled server exception: %s", exc)
        error_detail = ErrorDetail(
            code="INTERNAL_SERVER_ERROR",
            message="An unexpected server error occurred during request processing.",
            details={"error_type": type(exc).__name__},
            remediation="Inspect local logs and verify system prerequisites.",
            timestamp=datetime.now(UTC).isoformat(),
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorEnvelope(error=error_detail).model_dump(),
        )

    # Mount API routers under /api/v1
    prefix = "/api/v1"
    app.include_router(health.router, prefix=prefix)
    app.include_router(scenarios.router, prefix=prefix)
    app.include_router(datasets.router, prefix=prefix)
    app.include_router(pipelines.router, prefix=prefix)
    app.include_router(comparisons.router, prefix=prefix)
    app.include_router(verifications.router, prefix=prefix)
    app.include_router(reports.router, prefix=prefix)
    app.include_router(workspaces.router, prefix=prefix)

    return app


app = create_app()
