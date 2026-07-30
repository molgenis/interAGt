"""HTTP routers for the backend API."""
from __future__ import annotations

from fastapi import APIRouter

from backend import services
from backend.schemas import (
    HpoTermsResponse,
    NormalizeRequest,
    NormalizeResponse,
    OntologyTermsRequest,
    OntologyTermsResponse,
    OrganismsResponse,
    ScoreRequest,
    ScoreResponse,
    TracksPlotRequest,
    TracksPlotResponse,
    TracksRequest,
    TracksResponse,
    VariantConfirmation,
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

health_router = APIRouter()


@health_router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------

metadata_router = APIRouter()


@metadata_router.get("/organisms", response_model=OrganismsResponse)
def organisms() -> dict:
    return {"organisms": services.get_organisms()}


@metadata_router.get("/track-explanations")
def track_explanations() -> dict[str, str]:
    return services.get_track_explanations()


@metadata_router.get("/hpo-terms", response_model=HpoTermsResponse)
def hpo_terms() -> dict:
    return {"terms": services.get_hpo_terms()}


@metadata_router.post("/ontology-terms", response_model=OntologyTermsResponse)
def ontology_terms(payload: OntologyTermsRequest) -> dict:
    curie_to_label, display_options = services.load_ontology_terms(
        payload.api_key, payload.organism
    )
    return {"curie_to_label": curie_to_label, "display_options": display_options}


@metadata_router.post("/tracks", response_model=TracksResponse)
def tracks(payload: TracksRequest) -> dict:
    track_map = services.load_tracks(payload.api_key, payload.organism)
    organism_label = services.get_organism_label(payload.organism)

    default_selection = [
        track for track in services.DEFAULT_TRACK_SELECTION if track in track_map
    ]

    return {
        "tracks": list(track_map.keys()),
        "default_selection": default_selection,
        "excluded_from_visualization": services.EXCLUDED_VISUALIZATION_TRACKS,
        "available_scorers": services.get_available_scorers(organism_label),
    }


# ---------------------------------------------------------------------------
# Variants
# ---------------------------------------------------------------------------

variants_router = APIRouter()


@variants_router.post("/normalize", response_model=NormalizeResponse)
def normalize(payload: NormalizeRequest) -> NormalizeResponse:
    result = services.normalize_variant_str(payload.variant, payload.organism)
    confirmation = None
    if result.needs_confirmation:
        confirmation = VariantConfirmation(
            mapped_position=result.mapped_position or "",
            given_ref=result.given_ref or "",
            actual_ref=result.actual_ref or "",
            message=result.message or "",
        )
    return NormalizeResponse(
        input=result.input,
        normalized=result.normalized,
        alternatives=result.alternatives,
        message=result.message,
        warnings=result.warnings,
        needs_confirmation=result.needs_confirmation,
        confirmation=confirmation,
    )


@variants_router.post("/score", response_model=ScoreResponse)
def score(payload: ScoreRequest) -> dict:
    model = services.get_model(payload.api_key)
    organism = services.resolve_organism(payload.organism)

    df_scores = services.score_variant(
        model=model,
        organism=organism,
        variant_str=payload.variant,
        sequence_length=payload.sequence_length,
        scorer_names=payload.scorers,
    )

    sort_applied = ["raw_score"]
    if payload.hpo_terms:
        hpo_lookup = services.get_hpo_lookup()
        df_scores = services.apply_hpo_relevance(
            df_scores, payload.hpo_terms, hpo_lookup
        )
        sort_applied = ["hpo_gene_relevance", "raw_score"]

    output_types = (
        df_scores["output_type"].unique().tolist()
        if "output_type" in df_scores.columns
        else []
    )

    return {
        "rows": services.dataframe_to_rows(df_scores),
        "output_types": output_types,
        "sort_applied": sort_applied,
    }


# ---------------------------------------------------------------------------
# Plots
# ---------------------------------------------------------------------------

plots_router = APIRouter()


@plots_router.post("/tracks", response_model=TracksPlotResponse)
def tracks_plot(payload: TracksPlotRequest) -> dict:
    model = services.get_model(payload.api_key)
    organism = services.resolve_organism(payload.organism)
    organism_label = services.get_organism_label(payload.organism)

    track_map = services.load_tracks(payload.api_key, payload.organism)
    transcript_extractor = services.load_transcripts(organism_label)

    return services.predict_and_build_track_payload(
        model=model,
        organism=organism,
        variant_str=payload.variant,
        sequence_length=payload.sequence_length,
        ontology_terms=payload.ontology_terms,
        selected_tracks=payload.tracks,
        track_map=track_map,
        transcript_extractor=transcript_extractor,
    )
