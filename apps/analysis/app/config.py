from __future__ import annotations

from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    internal_token: str
    provider: str
    openai_api_key: str
    openai_model: str
    openai_timeout_seconds: float

    @classmethod
    def from_env(cls) -> "Settings":
        timeout_raw = os.getenv("OPENAI_TIMEOUT_SECONDS", "30")
        try:
            timeout = float(timeout_raw)
        except ValueError as exception:
            raise RuntimeError("OPENAI_TIMEOUT_SECONDS must be numeric") from exception
        if timeout <= 0:
            raise RuntimeError("OPENAI_TIMEOUT_SECONDS must be positive")

        return cls(
            internal_token=os.getenv("ANALYSIS_INTERNAL_TOKEN", ""),
            provider=os.getenv("ANALYSIS_PROVIDER", "fake").strip().lower(),
            openai_api_key=os.getenv("OPENAI_API_KEY", ""),
            openai_model=os.getenv("OPENAI_MODEL", ""),
            openai_timeout_seconds=timeout,
        )
