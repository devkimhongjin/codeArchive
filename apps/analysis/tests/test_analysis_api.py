from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import AnalysisTask
from app.provider import (
    FakeAnalysisProvider,
    ProviderError,
    ProviderInput,
    ProviderOutput,
    ProviderTimeout,
    build_provider,
)


INTERNAL_TOKEN = "internal-test-token"


def settings(provider: str = "fake") -> Settings:
    return Settings(
        internal_token=INTERNAL_TOKEN,
        provider=provider,
        openai_api_key="",
        openai_model="",
        openai_timeout_seconds=5,
    )


def payload(task: str = "CODE_REVIEW") -> dict[str, str]:
    return {
        "task": task,
        "code": "public class Main {}",
        "platform": "SWEA",
        "problemNumber": "1234",
        "title": "Example",
        "language": "Java",
    }


class RecordingProvider:
    def __init__(self) -> None:
        self.requests: list[ProviderInput] = []

    def analyze(self, request: ProviderInput) -> ProviderOutput:
        self.requests.append(request)
        return ProviderOutput(
            content=f"artifact:{request.task.value}",
            provider="fake",
            model="fake-test",
        )


class FailingProvider:
    def __init__(self, timeout: bool = False) -> None:
        self.called = 0
        self.timeout = timeout

    def analyze(self, request: ProviderInput) -> ProviderOutput:
        self.called += 1
        if self.timeout:
            raise ProviderTimeout("hidden timeout detail")
        raise ProviderError("hidden provider detail")


def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {INTERNAL_TOKEN}"}


def test_missing_and_invalid_internal_bearer_are_rejected_before_provider() -> None:
    provider = RecordingProvider()
    client = TestClient(create_app(settings(), provider))

    assert client.post("/internal/v1/analysis", json=payload()).status_code == 401
    assert client.post(
        "/internal/v1/analysis",
        json=payload(),
        headers={"Authorization": "Bearer wrong"},
    ).status_code == 401
    assert provider.requests == []


@pytest.mark.parametrize("task", [task.value for task in AnalysisTask])
def test_valid_internal_request_maps_each_task_to_provider(task: str) -> None:
    provider = RecordingProvider()
    client = TestClient(create_app(settings(), provider))

    response = client.post(
        "/internal/v1/analysis",
        json=payload(task),
        headers=auth(),
    )

    assert response.status_code == 200
    assert response.json() == {
        "content": f"artifact:{task}",
        "provider": "fake",
        "model": "fake-test",
    }
    assert len(provider.requests) == 1
    request = provider.requests[0]
    assert request.task.value == task
    assert request.code == "public class Main {}"
    assert request.platform == "SWEA"
    assert request.problem_number == "1234"
    assert request.title == "Example"
    assert request.language == "Java"


@pytest.mark.parametrize(
    "extra_field",
    ["problemBody", "sampleInput", "githubToken", "userId", "cookie"],
)
def test_internal_contract_forbids_non_minimal_fields(extra_field: str) -> None:
    provider = RecordingProvider()
    client = TestClient(create_app(settings(), provider))
    body = payload()
    body[extra_field] = "must-not-pass"

    response = client.post(
        "/internal/v1/analysis",
        json=body,
        headers=auth(),
    )

    assert response.status_code == 422
    assert provider.requests == []


@pytest.mark.parametrize("timeout", [False, True])
def test_provider_failure_and_timeout_map_to_safe_502(timeout: bool) -> None:
    provider = FailingProvider(timeout=timeout)
    client = TestClient(create_app(settings(), provider))
    source_marker = "SOURCE_SECRET_123"
    body = payload()
    body["code"] = source_marker

    response = client.post(
        "/internal/v1/analysis",
        json=body,
        headers=auth(),
    )

    assert response.status_code == 502
    assert response.json() == {"detail": "analysis provider unavailable"}
    assert source_marker not in response.text
    assert INTERNAL_TOKEN not in response.text
    assert "hidden" not in response.text
    assert provider.called == 1


def test_api_key_presence_does_not_enable_live_provider(monkeypatch) -> None:
    monkeypatch.setenv("ANALYSIS_PROVIDER", "fake")
    monkeypatch.setenv("OPENAI_API_KEY", "present-but-unused")
    monkeypatch.setenv("OPENAI_MODEL", "present-but-unused")

    resolved = Settings.from_env()
    provider = build_provider(resolved)

    assert resolved.provider == "fake"
    assert isinstance(provider, FakeAnalysisProvider)


def test_blank_internal_token_fails_closed() -> None:
    provider = RecordingProvider()
    blank = Settings(
        internal_token="",
        provider="fake",
        openai_api_key="",
        openai_model="",
        openai_timeout_seconds=5,
    )
    client = TestClient(create_app(blank, provider))

    response = client.post(
        "/internal/v1/analysis",
        json=payload(),
        headers={"Authorization": "Bearer anything"},
    )

    assert response.status_code == 401
    assert provider.requests == []
