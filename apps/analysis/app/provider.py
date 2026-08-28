from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from openai import APIError, APITimeoutError, OpenAI

from app.config import Settings
from app.models import AnalysisTask


@dataclass(frozen=True)
class ProviderInput:
    task: AnalysisTask
    code: str
    platform: str
    problem_number: str
    title: str
    language: str


@dataclass(frozen=True)
class ProviderOutput:
    content: str
    provider: str
    model: str


class ProviderError(RuntimeError):
    pass


class ProviderTimeout(ProviderError):
    pass


class AnalysisProvider(Protocol):
    def analyze(self, request: ProviderInput) -> ProviderOutput:
        ...


class FakeAnalysisProvider:
    provider_name = "fake"
    model_name = "fake-v1"

    def analyze(self, request: ProviderInput) -> ProviderOutput:
        labels = {
            AnalysisTask.APPROACH_DESIGN: "Approach design artifact",
            AnalysisTask.COMMENTED_CODE: "Commented code artifact",
            AnalysisTask.CODE_REVIEW: "Code review artifact",
        }
        return ProviderOutput(
            content=f"{labels[request.task]} for {request.problem_number}",
            provider=self.provider_name,
            model=self.model_name,
        )


class OpenAIResponsesProvider:
    provider_name = "openai"

    def __init__(
        self,
        api_key: str,
        model: str,
        timeout_seconds: float,
        client: object | None = None,
    ) -> None:
        if not model.strip():
            raise RuntimeError("OPENAI_MODEL is required for OpenAI provider")
        if client is None and not api_key.strip():
            raise RuntimeError("OPENAI_API_KEY is required for OpenAI provider")

        self.model = model
        self.client = client or OpenAI(
            api_key=api_key,
            timeout=timeout_seconds,
        )

    def analyze(self, request: ProviderInput) -> ProviderOutput:
        try:
            response = self.client.responses.create(
                model=self.model,
                instructions=self._instructions(request.task),
                input=self._input_text(request),
            )
        except APITimeoutError as exception:
            raise ProviderTimeout("provider timeout") from exception
        except APIError as exception:
            raise ProviderError("provider request failed") from exception
        except TimeoutError as exception:
            raise ProviderTimeout("provider timeout") from exception

        output_text = getattr(response, "output_text", None)
        if not isinstance(output_text, str) or not output_text.strip():
            raise ProviderError("provider response invalid")

        return ProviderOutput(
            content=output_text,
            provider=self.provider_name,
            model=self.model,
        )

    def _instructions(self, task: AnalysisTask) -> str:
        instructions = {
            AnalysisTask.APPROACH_DESIGN: (
                "Explain a concise algorithmic approach and design for the "
                "provided accepted solution. Do not invent problem statement details."
            ),
            AnalysisTask.COMMENTED_CODE: (
                "Return the provided solution code with concise explanatory comments. "
                "Do not change its intended behavior."
            ),
            AnalysisTask.CODE_REVIEW: (
                "Review the provided accepted solution for readability, correctness "
                "risks, complexity, and maintainability."
            ),
        }
        return instructions[task]

    def _input_text(self, request: ProviderInput) -> str:
        return (
            f"Task: {request.task.value}\n"
            f"Platform: {request.platform}\n"
            f"Problem number: {request.problem_number}\n"
            f"Title: {request.title}\n"
            f"Language: {request.language}\n"
            "Source code:\n"
            f"{request.code}"
        )


def build_provider(settings: Settings) -> AnalysisProvider:
    if settings.provider == "fake":
        return FakeAnalysisProvider()
    if settings.provider == "openai":
        return OpenAIResponsesProvider(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            timeout_seconds=settings.openai_timeout_seconds,
        )
    raise RuntimeError("Unsupported ANALYSIS_PROVIDER")
