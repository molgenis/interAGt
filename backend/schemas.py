"""Pydantic request/response schemas for the backend API."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


ALLOWED_SEQUENCE_LENGTHS = [16384, 131072, 524288, 1048576]

# "ag2" = AlphaGenome 2 (default), "ag1" = AlphaGenome 1.
# Keep in sync with MODEL_SPECS in backend/services.py.
ModelVersion = Literal["ag1", "ag2"]
DEFAULT_MODEL_VERSION: ModelVersion = "ag2"

# AG2 only. auto = observed tracks where measured, otherwise supported
# imputations (per condition and output type). Keep in sync with
# IMPUTATION_POLICIES in backend/services.py.
ImputationPolicy = Literal["auto", "observed", "supported", "all"]


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


class ModelVersionItem(BaseModel):
    value: ModelVersion
    label: str
    default: bool = False


class ModelVersionsResponse(BaseModel):
    models: list[ModelVersionItem]


class HpoTermItem(BaseModel):
    term: str
    definition: str = ""


class HpoTermsResponse(BaseModel):
    terms: list[HpoTermItem]


class OntologyTermsRequest(BaseModel):
    api_key: str
    organism: str
    model_version: ModelVersion = DEFAULT_MODEL_VERSION


class OntologyTermsResponse(BaseModel):
    curie_to_label: dict[str, str]
    display_options: list[str]
    # AG2: display option -> which outputs are observed/imputed there.
    descriptions: dict[str, str] = Field(default_factory=dict)


class TracksRequest(BaseModel):
    api_key: str
    organism: str
    model_version: ModelVersion = DEFAULT_MODEL_VERSION


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
    model_version: ModelVersion = DEFAULT_MODEL_VERSION
    # AG2 only: reference conditions to score in (one API call each).
    conditions: list[str] = Field(default_factory=list)
    # AG2 only: which imputed tracks to keep in the results.
    imputation: ImputationPolicy = "auto"

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
    # AG1: ontology CURIEs; AG2: reference conditions (one API call each).
    ontology_terms: list[str] = Field(default_factory=list)
    tracks: list[str] = Field(default_factory=list)
    model_version: ModelVersion = DEFAULT_MODEL_VERSION
    # AG2 only: which imputed tracks to plot.
    imputation: ImputationPolicy = "auto"

    @field_validator("sequence_length")
    @classmethod
    def _check_sequence_length(cls, value: int) -> int:
        return validate_sequence_length(value)


class TracksPlotResponse(BaseModel):
    interval: dict[str, Any]
    variant: dict[str, Any]
    tracks: list[dict[str, Any]]
    transcripts: list[dict[str, Any]]
    warnings: list[dict[str, Any]] = Field(default_factory=list)
    # Tracks shown with a caveat (imputed fallback, capped track count).
    notes: list[dict[str, Any]] = Field(default_factory=list)
    transcript_warning: str | None = None
