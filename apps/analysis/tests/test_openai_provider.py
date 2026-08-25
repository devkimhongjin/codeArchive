from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.models import AnalysisTask
from app.provider import OpenAIResponsesProvider, ProviderError, ProviderInput


class FakeResponses:
    def __init__(self, output_text: str | None = "generated artifact") -> None:
        self.output_text = output_text
        self.calls: list[dict[str, object]] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(output_text=self.output_text)


class FakeOpenAIClient:
    def __init__(self, responses: FakeResponses) -> None:
        self.responses = responses


def provider_input() -> ProviderInput:
    return ProviderInput(
        task=AnalysisTask.CODE_REVIEW,
        code="SOURCE_MARKER",
        platform="SWEA",
        problem_number="1234",
        title="Example",
        language="Java",
    )


def test_openai_adapter_uses_runtime_model_and_responses_api_without_network() -> None:
    responses = FakeResponses()
    client = FakeOpenAIClient(responses)
    provider = OpenAIResponsesProvider(
        api_key="test-only-not-live",
        model="runtime-model",
        timeout_seconds=5,
        client=client,
    )

    result = provider.analyze(provider_input())

    assert result.content == "generated artifact"
    assert result.provider == "openai"
    assert result.model == "runtime-model"
    assert len(responses.calls) == 1
    call = responses.calls[0]
    assert call["model"] == "runtime-model"
    assert "SOURCE_MARKER" in str(call["input"])
    assert "SWEA" in str(call["input"])
    assert "1234" in str(call["input"])
    assert "problemBody" not in str(call)
    assert "sampleInput" not in str(call)
    assert "userId" not in str(call)
    assert "Authorization" not in str(call)


@pytest.mark.parametrize("output", [None, "", "   "])
def test_openai_adapter_rejects_missing_output_text(output: str | None) -> None:
    responses = FakeResponses(output)
    provider = OpenAIResponsesProvider(
        api_key="test-only-not-live",
        model="runtime-model",
        timeout_seconds=5,
        client=FakeOpenAIClient(responses),
    )

    with pytest.raises(ProviderError):
        provider.analyze(provider_input())


def test_openai_adapter_requires_runtime_model() -> None:
    with pytest.raises(RuntimeError, match="OPENAI_MODEL"):
        OpenAIResponsesProvider(
            api_key="test-only-not-live",
            model="",
            timeout_seconds=5,
            client=FakeOpenAIClient(FakeResponses()),
        )
