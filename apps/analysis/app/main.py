from __future__ import annotations

import secrets

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from app.config import Settings
from app.models import AnalysisRequest, AnalysisResponse
from app.provider import (
    AnalysisProvider,
    ProviderError,
    ProviderInput,
    ProviderTimeout,
    build_provider,
)


def create_app(
    settings: Settings | None = None,
    provider: AnalysisProvider | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    resolved_provider = provider or build_provider(resolved_settings)

    application = FastAPI(
        title="CodeArchive Analysis API",
        version="0.1.0",
    )
    application.state.settings = resolved_settings
    application.state.provider = resolved_provider

    @application.middleware("http")
    async def protect_internal_api(request: Request, call_next):
        if request.url.path.startswith("/internal/"):
            authorization = request.headers.get("authorization", "")
            prefix = "Bearer "
            configured = resolved_settings.internal_token
            supplied = (
                authorization[len(prefix):]
                if authorization.startswith(prefix)
                else ""
            )
            if (
                not configured
                or not supplied
                or not secrets.compare_digest(supplied, configured)
            ):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "internal authentication required"},
                )
        return await call_next(request)

    @application.get("/health")
    def health_check() -> dict[str, str]:
        return {
            "status": "UP",
            "service": "codearchive-analysis",
        }

    @application.post(
        "/internal/v1/analysis",
        response_model=AnalysisResponse,
    )
    def analyze(request: AnalysisRequest) -> AnalysisResponse:
        provider_input = ProviderInput(
            task=request.task,
            code=request.code,
            platform=request.platform,
            problem_number=request.problem_number,
            title=request.title,
            language=request.language,
        )
        try:
            result = resolved_provider.analyze(provider_input)
        except (ProviderTimeout, ProviderError) as exception:
            raise HTTPException(
                status_code=502,
                detail="analysis provider unavailable",
            ) from exception

        if (
            not result.content.strip()
            or not result.provider.strip()
            or not result.model.strip()
        ):
            raise HTTPException(
                status_code=502,
                detail="analysis provider unavailable",
            )

        return AnalysisResponse(
            content=result.content,
            provider=result.provider,
            model=result.model,
        )

    return application


app = create_app()
