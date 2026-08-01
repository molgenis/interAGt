"""Pydantic request/response schemas for the backend API."""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


ALLOWED_SEQUENCE_LENGTHS = [16384, 131072, 524288, 1048576]


def validate_sequence_length(value: int) -> int:
    if value not in ALLOWED_SEQUENCE_LENGTHS:
        raise ValueError(
            f"sequence_length must be one of {ALLOWED_SEQUENCE_LENGTHS}"
        )
    return value


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------


class OrganismItem(BaseModel):
    label: str
    value: str
    example_variant: str


class OrganismsResponse(BaseModel):
    organisms: list[OrganismItem]


class HpoTermItem(BaseModel):
    term: str
    definition: str = ""


class HpoTermsResponse(BaseModel):
    terms: list[HpoTermItem]


class OntologyTermsRequest(BaseModel):
    api_key: str
    organism: str


class OntologyTermsResponse(BaseModel):
    curie_to_label: dict[str, str]
    display_options: list[str]


class TracksRequest(BaseModel):
    api_key: str
    organism: str


class TracksResponse(BaseModel):
    tracks: list[str]
    default_selection: list[str]
    excluded_from_visualization: list[str]
    available_scorers: list[str]


# ---------------------------------------------------------------------------
# Variants
# ---------------------------------------------------------------------------


class NormalizeRequest(BaseModel):
    variant: str
    organism: str = "Human (hg38)"


class VariantConfirmation(BaseModel):
    mapped_position: str
    given_ref: str
    actual_ref: str
    message: str


class NormalizeResponse(BaseModel):
    input: str
    normalized: str
    alternatives: list[str]
    message: Optional[str] = None
    warnings: list[str] = Field(default_factory=list)
    needs_confirmation: bool = False
    confirmation: Optional[VariantConfirmation] = None


class ScoreRequest(BaseModel):
    api_key: str
    organism: str
    variant: str
    sequence_length: int
    scorers: list[str]
    hpo_terms: list[str] = Field(default_factory=list)

    @field_validator("sequence_length")
    @classmethod
    def _check_sequence_length(cls, value: int) -> int:
        return validate_sequence_length(value)


class ScoreResponse(BaseModel):
    rows: list[dict[str, Any]]
    output_types: list[str]
    sort_applied: list[str]


# ---------------------------------------------------------------------------
# Plots
# ---------------------------------------------------------------------------


class TracksPlotRequest(BaseModel):
    api_key: str
    organism: str
    variant: str
    sequence_length: int
    ontology_terms: list[str] = Field(default_factory=list)
    tracks: list[str] = Field(default_factory=list)

    @field_validator("sequence_length")
    @classmethod
    def _check_sequence_length(cls, value: int) -> int:
        return validate_sequence_length(value)


class TracksPlotResponse(BaseModel):
    interval: dict[str, Any]
    variant: dict[str, Any]
    tracks: list[dict[str, Any]]
    transcripts: list[dict[str, Any]]
