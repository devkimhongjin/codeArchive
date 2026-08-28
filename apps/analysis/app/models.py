from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class AnalysisTask(str, Enum):
    APPROACH_DESIGN = "APPROACH_DESIGN"
    COMMENTED_CODE = "COMMENTED_CODE"
    CODE_REVIEW = "CODE_REVIEW"


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    task: AnalysisTask
    code: str = Field(min_length=1, max_length=200_000)
    platform: str = Field(min_length=1, max_length=32)
    problem_number: str = Field(
        alias="problemNumber",
        min_length=1,
        max_length=64,
    )
    title: str = Field(min_length=1, max_length=255)
    language: str = Field(min_length=1, max_length=64)


class AnalysisResponse(BaseModel):
    content: str
    provider: str
    model: str
