"""Service layer: metadata, model client, transcripts, variants, scoring, plotting."""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field, replace as dc_replace
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import openai
import pandas as pd
from alphagenome.data import gene_annotation, genome, transcript
from alphagenome.models import dna_client, variant_scorers
from openai import OpenAI

from backend.core import (
    DEFAULT_LLM_BASE_URL,
    DEFAULT_LLM_MODEL,
    LLM_CACHE_SIZE,
    LLM_TIMEOUT_SECONDS,
    MODEL_CACHE_SIZE,
    RESOURCES_DIR,
    InvalidLlmCredentialsError,
    InvalidRequestError,
    InvalidVariantError,
    LlmServiceError,
    MissingApiKeyError,
    MissingLlmKeyError,
    NoTrackDataError,
    NoVariantResultsError,
    UpstreamServiceError,
)
from helper_functions import resolve_variant


LOGGER = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Metadata constants
# ---------------------------------------------------------------------------

ORGANISM_MAP = {
    "Human (hg38)": dna_client.Organism.HOMO_SAPIENS,
    "Mouse (mm10)": dna_client.Organism.MUS_MUSCULUS,
}

ORGANISM_EXAMPLE_VARIANTS = {
    # Chosen to produce nonzero rows for every scorer in SCORER_SELECTION_CHOICES
    # (incl. splice/polyadenylation, which need a variant inside an actively
    # spliced, well-expressed gene) and nonzero tracks for common ontology
    # terms. Human: intronic APOL4 (chr22), used as the known-issues.md
    # scorer-coverage repro. Mouse: Actb (chr5), a housekeeping gene with no
    # human-only-scorer gaps to worry about. Verified against the live
    # AlphaGenome API — see backend/services.py git history for the check.
    "Human (hg38)": "chr22:36201698:A:C",
    "Mouse (mm10)": "chr5:142889961:G:A",
}

SCORER_SELECTION_CHOICES = [
    "RNA_SEQ",
    "CAGE",
    "PROCAP",
    "ATAC",
    "DNASE",
    "CHIP_HISTONE",
    "CHIP_TF",
    "CONTACT_MAPS",
    "SPLICE_SITES",
    "SPLICE_SITE_USAGE",
    "SPLICE_JUNCTIONS",
    "Polyadenylation",
]

DEFAULT_TRACK_SELECTION = ["RNA_SEQ", "CHIP_TF", "ATAC"]
EXCLUDED_VISUALIZATION_TRACKS: list[str] = []


# ---------------------------------------------------------------------------
# AlphaGenome client
# ---------------------------------------------------------------------------


@lru_cache(maxsize=MODEL_CACHE_SIZE)
def get_model(api_key: str):
    """Create and cache the AlphaGenome client by API key."""
    if not api_key or not api_key.strip():
        raise MissingApiKeyError("Enter API key.")

    try:
        return dna_client.create(api_key)
    except Exception as exc:
        raise UpstreamServiceError("Could not create AlphaGenome client.") from exc


# ---------------------------------------------------------------------------
# Metadata / ontology / tracks
# ---------------------------------------------------------------------------


def resolve_organism(organism: Any):
    if organism in ORGANISM_MAP.values():
        return organism

    if not isinstance(organism, str):
        raise InvalidRequestError("Unsupported organism value.")

    if organism in ORGANISM_MAP:
        return ORGANISM_MAP[organism]

    enum_name = organism.strip().upper()
    if hasattr(dna_client.Organism, enum_name):
        return getattr(dna_client.Organism, enum_name)

    raise InvalidRequestError(f"Unsupported organism value: {organism}")


def get_organism_label(organism: Any) -> str:
    resolved = resolve_organism(organism)
    for label, enum_value in ORGANISM_MAP.items():
        if enum_value == resolved:
            return label
    raise InvalidRequestError(f"Unsupported organism value: {organism}")


def get_organisms() -> list[dict[str, str]]:
    return [
        {
            "label": label,
            "value": getattr(organism, "name", str(organism).split(".")[-1]),
            "example_variant": ORGANISM_EXAMPLE_VARIANTS[label],
        }
        for label, organism in ORGANISM_MAP.items()
    ]


@lru_cache(maxsize=1)
def get_hpo_lookup() -> dict[str, Any]:
    with open(RESOURCES_DIR / "hp_info_gene.json", "r", encoding="utf-8") as handle:
        return json.load(handle)


def get_hpo_terms() -> list[dict[str, str]]:
    lookup = get_hpo_lookup()
    return [
        {"term": term, "definition": lookup.get(term, {}).get("definition") or ""}
        for term in sorted(lookup.keys())
    ]


def get_available_scorers(organism: Any, available_tracks: Iterable[str]) -> list[str]:
    resolved = resolve_organism(organism)
    track_names = set(available_tracks)

    available: list[str] = []
    for name in SCORER_SELECTION_CHOICES:
        scorer = variant_scorers.RECOMMENDED_VARIANT_SCORERS.get(name.upper())
        if scorer is None:
            continue

        supported = variant_scorers.SUPPORTED_ORGANISMS.get(scorer.base_variant_scorer, ())
        if resolved.value not in supported:
            continue

        requested_output = getattr(scorer, "requested_output", None)
        if requested_output is not None:
            output_type_name = str(requested_output).split(".")[-1]
            if output_type_name not in track_names:
                continue

        available.append(name)

    return available


def _organism_cache_key(organism: Any) -> str:
    resolved = resolve_organism(organism)
    return getattr(resolved, "name", str(resolved).split(".")[-1])


@lru_cache(maxsize=128)
def _get_output_metadata(api_key: str, organism_key: str):
    model = get_model(api_key)
    organism = resolve_organism(organism_key)
    try:
        return model.output_metadata(organism=organism).concatenate()
    except Exception as exc:
        raise UpstreamServiceError("Could not load output metadata.") from exc


def load_ontology_terms(api_key: str, organism: Any) -> tuple[dict[str, str], list[str]]:
    metadata = _get_output_metadata(api_key, _organism_cache_key(organism))

    if not hasattr(metadata, "ontology_curie"):
        return {}, []

    df = metadata[["ontology_curie", "biosample_name"]].dropna().drop_duplicates()
    curie_to_label = dict(zip(df["ontology_curie"], df["biosample_name"]))
    display_options = sorted(f"{label} ({curie})" for curie, label in curie_to_label.items())
    return curie_to_label, display_options


def load_tracks(api_key: str, organism: Any) -> dict[str, tuple[Any, str]]:
    metadata = _get_output_metadata(api_key, _organism_cache_key(organism))

    if not hasattr(metadata, "output_type"):
        return {}

    track_map: dict[str, tuple[Any, str]] = {}
    for output_type in metadata.output_type.unique().tolist():
        clean_name = str(output_type).split(".")[-1]
        attr_name = clean_name.lower()
        track_map[clean_name] = (output_type, attr_name)

    order = {name: index for index, name in enumerate(SCORER_SELECTION_CHOICES)}
    return dict(
        sorted(track_map.items(), key=lambda item: order.get(item[0], len(order)))
    )


# ---------------------------------------------------------------------------
# Transcript loading
# ---------------------------------------------------------------------------


@lru_cache(maxsize=2)
def load_transcripts(organism_label: str = "Human (hg38)"):
    """Load transcript extractor using local feather files with cloud fallback."""
    if organism_label == "Human (hg38)":
        local_path = RESOURCES_DIR / "gencode.v46.annotation.gtf.gz.feather"
        fallback_path = (
            "https://storage.googleapis.com/alphagenome/reference/gencode/"
            "hg38/gencode.v46.annotation.gtf.gz.feather"
        )
    else:
        local_path = RESOURCES_DIR / "gencode.vM23.annotation.gtf.gz.v2.feather"
        fallback_path = (
            "https://storage.googleapis.com/alphagenome/reference/gencode/"
            "mm10/gencode.vM23.annotation.gtf.gz.feather"
        )
        # TODO: Existing behavior keeps the mm10 path; migration plan tracks mouse reference concerns.

    source: str | Path = local_path if local_path.exists() else fallback_path

    try:
        gtf = pd.read_feather(source)
        gtf_transcript = gene_annotation.filter_transcript_support_level(
            gene_annotation.filter_protein_coding(gtf), ["1"]
        )
        return transcript.TranscriptExtractor(gtf_transcript)
    except Exception as exc:
        raise UpstreamServiceError("Could not load transcript resources.") from exc


# ---------------------------------------------------------------------------
# Variant normalization
# ---------------------------------------------------------------------------


@dataclass
class NormalizedVariantResult:
    input: str
    normalized: str
    alternatives: list[str]
    message: str | None = None
    warnings: list[str] = field(default_factory=list)
    needs_confirmation: bool = False
    mapped_position: str | None = None
    given_ref: str | None = None
    actual_ref: str | None = None


_UPSTREAM_TRANSPORT_ERROR_RE = re.compile(
    r"Server Error|Client Error|Connection|Timeout|Max retries exceeded",
    re.IGNORECASE,
)


def _is_upstream_transport_error(message: str) -> bool:
    """True if a resolve_variant error came from Ensembl/VariantValidator being
    unreachable (5xx, timeout, connection failure) rather than a bad variant."""
    return bool(_UPSTREAM_TRANSPORT_ERROR_RE.search(message))


def normalize_variant_str(variant_str: str, organism_label: str) -> NormalizedVariantResult:
    resolution = resolve_variant(variant_str, organism_label)
    # Hard errors still raise; a reference mismatch is flagged for confirmation.
    if resolution.error:
        if _is_upstream_transport_error(resolution.error):
            raise UpstreamServiceError(resolution.error)
        raise InvalidVariantError(resolution.error)
    if not resolution.normalized:
        raise InvalidVariantError("Variant normalization returned no result.")

    alternatives = [item.strip() for item in resolution.normalized.split(",") if item.strip()]
    if not alternatives:
        raise InvalidVariantError("Variant normalization returned no valid alternatives.")

    selected_variant = alternatives[0]
    normalized_input = variant_str.strip().replace(" ", "")

    message = resolution.message
    warnings: list[str] = list(resolution.warnings)
    if not resolution.needs_confirmation and message is None and selected_variant != normalized_input:
        message = f"Normalized from {normalized_input}"
    if len(alternatives) > 1:
        warnings.append("Multiple normalized alternatives were returned.")

    return NormalizedVariantResult(
        input=variant_str,
        normalized=selected_variant,
        alternatives=alternatives,
        message=message,
        warnings=warnings,
        needs_confirmation=resolution.needs_confirmation,
        mapped_position=resolution.mapped_position,
        given_ref=resolution.given_ref,
        actual_ref=resolution.actual_ref,
    )


# ---------------------------------------------------------------------------
# Variant scoring
# ---------------------------------------------------------------------------


def parse_variant_interval(variant: str, seq_length: int) -> tuple[genome.Interval, genome.Variant]:
    try:
        chrom, pos, ref, alt = variant.strip().split(":")
        pos_value = int(pos)
    except Exception as exc:
        raise InvalidVariantError(
            "Variant must be in chr:position:reference:alternate format."
        ) from exc

    interval = genome.Interval(
        chromosome=chrom,
        start=pos_value - seq_length // 2,
        end=pos_value + seq_length // 2,
    )

    variant_obj = genome.Variant(
        chromosome=chrom,
        position=pos_value,
        reference_bases=ref,
        alternate_bases=alt,
    )

    return interval, variant_obj


def resolve_variant_scorers(selected_scorer_names: Iterable[str]) -> list[Any]:
    selected = {name.lower() for name in selected_scorer_names}
    all_scorers = variant_scorers.RECOMMENDED_VARIANT_SCORERS
    resolved = [
        scorer
        for scorer_name, scorer in all_scorers.items()
        if scorer_name.lower() in selected
    ]

    if not resolved:
        raise InvalidRequestError("No valid variant scorers selected.")

    return resolved


def score_variant(
    model: Any,
    organism: Any,
    variant_str: str,
    sequence_length: int,
    scorer_names: Iterable[str],
) -> pd.DataFrame:
    interval, variant_obj = parse_variant_interval(variant_str, sequence_length)
    selected_scorers = resolve_variant_scorers(scorer_names)

    try:
        variant_scores = model.score_variant(
            interval=interval,
            variant=variant_obj,
            variant_scorers=selected_scorers,
            organism=organism,
        )
        df_scores = variant_scorers.tidy_scores(variant_scores)
    except Exception as exc:
        raise UpstreamServiceError("Could not score variant.") from exc

    if df_scores is None or df_scores.empty:
        raise NoVariantResultsError("No variant results")

    if "variant_scorer" in df_scores.columns:
        is_polyadenylation = df_scores["variant_scorer"].str.startswith(
            "PolyadenylationScorer"
        )
        df_scores.loc[is_polyadenylation, "output_type"] = "Polyadenylation"

    dropped_columns = [
        column
        for column in ["variant_id", "scored_interval"]
        if column in df_scores.columns
    ]

    sort_column = default_sort_column(df_scores)
    result_df = df_scores.sort_values(sort_column, key=abs, ascending=False)
    if dropped_columns:
        result_df = result_df.drop(columns=dropped_columns)

    return result_df


def default_sort_column(df_scores: pd.DataFrame) -> str:
    # quantile_score is comparable across scorers/track types (percentile rank
    # against a common background); raw_score is not, since its units differ
    # per scorer. Only fall back to raw_score if no scorer produced quantiles.
    return "quantile_score" if "quantile_score" in df_scores.columns else "raw_score"


def apply_hpo_relevance(
    df_scores: pd.DataFrame,
    selected_hpos: Iterable[str] | None,
    hpo_lookup: dict[str, Any],
) -> pd.DataFrame:
    if not selected_hpos:
        return df_scores
    if "gene_name" not in df_scores.columns:
        raise InvalidRequestError("Scores table is missing required gene_name column.")

    relevant_genes = {
        gene
        for hpo_term in selected_hpos
        for gene in hpo_lookup.get(hpo_term, {}).get("genes", [])
    }

    ranked_scores = df_scores.copy()
    ranked_scores["hpo_gene_relevance"] = (
        ranked_scores["gene_name"].isin(relevant_genes).astype(int)
    )

    sort_column = default_sort_column(ranked_scores)
    return ranked_scores.sort_values(
        ["hpo_gene_relevance", sort_column],
        key=abs,
        ascending=[False, False],
    )


def dataframe_to_rows(df_scores: pd.DataFrame) -> list[dict[str, Any]]:
    # Round-trip through pandas JSON so numpy scalar types (int64/float64) and
    # NaN values become plain JSON-serializable Python values.
    return json.loads(df_scores.to_json(orient="records"))


# ---------------------------------------------------------------------------
# Plotting payload construction
# ---------------------------------------------------------------------------

_CONTINUOUS_EXCLUDED = {
    "SPLICE_JUNCTIONS",
    "CONTACT_MAPS",
}


def _skip(track_name: str, reason_code: str, message: str) -> dict[str, str]:
    """Build a structured skip diagnostic for a track that yielded no plottable data."""
    return {"track": track_name, "reason_code": reason_code, "message": message}


def _metadata_to_dict(metadata: Any) -> dict[str, Any]:
    """Convert a pandas Series (or None) of track metadata into a plain dict."""
    if metadata is None:
        return {}
    try:
        raw = metadata.to_dict()
    except AttributeError:
        return {}
    out: dict[str, Any] = {}
    for key in ("name", "biosample_name", "strand", "transcription_factor"):
        if key in raw and raw[key] is not None:
            out[key] = raw[key]
    return out


def _resample_to(values: np.ndarray, length: int) -> list[float]:
    if values.shape[0] < length:
        values = np.interp(
            np.linspace(0, values.shape[0] - 1, length),
            np.arange(values.shape[0]),
            values,
        )
    return values.astype(float).tolist()


def _extract_transcripts(transcripts: list[Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for tx in transcripts or []:
        exons = sorted(tx.exons, key=lambda e: e.start)
        if not exons:
            continue
        strand = getattr(exons[0], "strand", "+")
        cds_intervals = [
            {"start": int(c.start), "end": int(c.end)}
            for c in getattr(tx, "cds", []) or []
        ]
        result.append(
            {
                "transcript_id": getattr(tx, "transcript_id", ""),
                "strand": strand,
                "exons": [
                    {"start": int(e.start), "end": int(e.end)} for e in exons
                ],
                "cds": cds_intervals,
            }
        )
    return result


def _serialize_junctions(
    junctions: Any, counts: list[Any], track_idx: int
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for jc, count in zip(junctions, counts):
        if not hasattr(jc, "start") or not hasattr(jc, "end"):
            continue
        if hasattr(count, "__len__"):
            value = float(count[track_idx]) if len(count) > track_idx else float(count[0])
        else:
            value = float(count)
        items.append(
            {
                "start": int(jc.start),
                "end": int(jc.end),
                "strand": getattr(jc, "strand", "+"),
                "count": value,
            }
        )
    return items


def build_track_payload(
    outputs: Any,
    variant: Any,
    selected_tracks: list[str],
    track_map: dict[str, tuple[Any, str]],
    interval_length: int,
    interval: Any,
    transcript_extractor: Any,
    skipped: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Extract JSON-serializable data for frontend plotting.

    `skipped` seeds the diagnostics list with skips already known to the
    caller (e.g. tracks unavailable for the organism); this function appends
    to it for every requested track that ends up with no plottable data.
    """
    tracks_payload: list[dict[str, Any]] = []
    skipped = list(skipped) if skipped else []

    for track_name in selected_tracks:
        track_info = track_map.get(track_name)
        if not track_info:
            skipped.append(
                _skip(track_name, "track_unavailable", f"{track_name} is not offered by this organism/model.")
            )
            continue
        attr = track_info[1]
        ref_data = getattr(outputs.reference, attr, None)
        alt_data = getattr(outputs.alternate, attr, None)
        if ref_data is None or alt_data is None:
            if track_name == "CONTACT_MAPS":
                skipped.append(
                    _skip(
                        track_name,
                        "contact_map_ontology_mismatch",
                        "No contact map data was returned for the selected ontology term(s); "
                        "contact maps use a separate cell-line ontology that may not overlap your tissue selection.",
                    )
                )
            else:
                skipped.append(
                    _skip(
                        track_name,
                        "no_output_data",
                        f"AlphaGenome returned no {track_name} data for this interval and sequence length.",
                    )
                )
            continue

        if track_name not in _CONTINUOUS_EXCLUDED:
            ref_values = ref_data.values
            alt_values = alt_data.values
            if ref_values.shape[1] == 0:
                skipped.append(
                    _skip(
                        track_name,
                        "track_tissue_mismatch",
                        f"No {track_name} data is available for the selected tissue(s).",
                    )
                )
                continue
            ref_interval_start = int(ref_data.interval.start)
            for i in range(ref_values.shape[1]):
                metadata = ref_data.metadata.iloc[i]
                tracks_payload.append(
                    {
                        "type": "continuous",
                        "track_name": track_name,
                        "metadata": _metadata_to_dict(metadata),
                        "interval_start": ref_interval_start,
                        "ref_values": _resample_to(ref_values[:, i], interval_length),
                        "alt_values": _resample_to(alt_values[:, i], interval_length),
                    }
                )
        elif track_name == "SPLICE_JUNCTIONS":
            if ref_data.values.shape[1] == 0:
                skipped.append(
                    _skip(
                        track_name,
                        "track_tissue_mismatch",
                        f"No {track_name} data is available for the selected tissue(s).",
                    )
                )
                continue

            ref_junctions = getattr(ref_data, "junctions", [])
            alt_junctions = getattr(alt_data, "junctions", [])
            ref_shape = getattr(ref_junctions, "shape", None)
            alt_shape = getattr(alt_junctions, "shape", None)
            has_ref = ref_shape is not None and ref_shape[0] > 0
            has_alt = alt_shape is not None and alt_shape[0] > 0
            if not has_ref and not has_alt:
                skipped.append(
                    _skip(
                        track_name,
                        "empty_splice_junctions",
                        "No splice junctions were predicted in this variant's window.",
                    )
                )
                continue

            ref_counts = list(getattr(ref_data, "values", []))
            alt_counts = list(getattr(alt_data, "values", []))

            for i in range(ref_data.values.shape[1]):
                metadata = ref_data.metadata.iloc[i]
                tracks_payload.append(
                    {
                        "type": "sashimi",
                        "track_name": track_name,
                        "metadata": _metadata_to_dict(metadata),
                        "ref_junctions": _serialize_junctions(ref_junctions, ref_counts, i),
                        "alt_junctions": _serialize_junctions(alt_junctions, alt_counts, i),
                    }
                )
        elif track_name == "CONTACT_MAPS":
            ref_values = ref_data.values
            alt_values = alt_data.values
            if ref_values.shape[2] == 0:
                skipped.append(
                    _skip(
                        track_name,
                        "contact_map_ontology_mismatch",
                        "No contact map data was returned for the selected ontology term(s); "
                        "contact maps use a separate cell-line ontology that may not overlap your tissue selection.",
                    )
                )
                continue
            for i in range(ref_values.shape[2]):
                metadata = ref_data.metadata.iloc[i]
                contact_diff = (alt_values[:, :, i] - ref_values[:, :, i]).astype(float)
                bins = contact_diff.shape[0]
                coords = (
                    np.linspace(int(interval.start), int(interval.end), bins)
                    .astype(float)
                    .tolist()
                )
                tracks_payload.append(
                    {
                        "type": "contact_map",
                        "track_name": track_name,
                        "metadata": _metadata_to_dict(metadata),
                        "z": contact_diff.tolist(),
                        "coords": coords,
                    }
                )

    if not tracks_payload:
        summary = (
            skipped[0]["message"]
            if len(skipped) == 1
            else "No data was returned for any of the selected track(s)."
        )
        raise NoTrackDataError(summary, details=skipped)

    transcripts = (
        transcript_extractor.extract(interval) if transcript_extractor else []
    )

    return {
        "interval": {
            "chromosome": interval.chromosome,
            "start": int(interval.start),
            "end": int(interval.end),
        },
        "variant": {
            "chromosome": variant.chromosome,
            "position": int(variant.position),
            "reference_bases": variant.reference_bases,
            "alternate_bases": variant.alternate_bases,
            "label": f"{variant.chromosome}:{variant.position}:{variant.reference_bases}:{variant.alternate_bases}",
        },
        "tracks": tracks_payload,
        "transcripts": _extract_transcripts(transcripts),
        "warnings": skipped,
    }


def predict_and_build_track_payload(
    model: Any,
    organism: Any,
    variant_str: str,
    sequence_length: int,
    ontology_terms: list[str],
    selected_tracks: list[str],
    track_map: dict[str, tuple[Any, str]],
    transcript_extractor: Any,
) -> dict[str, Any]:
    if not ontology_terms:
        raise InvalidRequestError("Select at least one ontology term.")
    if not selected_tracks:
        raise InvalidRequestError("Select at least one track.")

    # A track selected under a different organism (e.g. stale frontend state
    # after switching organism) won't exist in this organism's track_map.
    # Drop those upfront rather than letting the KeyError below surface as an
    # opaque failure once every requested track is invalid.
    skipped: list[dict[str, str]] = []
    available_tracks: list[str] = []
    for track_name in selected_tracks:
        if track_name in track_map:
            available_tracks.append(track_name)
        else:
            skipped.append(
                _skip(track_name, "track_unavailable", f"{track_name} is not offered by this organism/model.")
            )

    if not available_tracks:
        summary = (
            skipped[0]["message"]
            if len(skipped) == 1
            else "None of the selected tracks are available for this organism."
        )
        raise NoTrackDataError(summary, details=skipped)

    interval, variant_obj = parse_variant_interval(variant_str, sequence_length)

    # Contact maps are requested separately so the correct cell-line-scoped
    # ontology term is applied and shown to the user, rather than falling
    # back to an unfiltered/arbitrary cell line.
    contact_tracks = [t for t in available_tracks if t == "CONTACT_MAPS"]
    other_tracks = [t for t in available_tracks if t != "CONTACT_MAPS"]

    try:
        outputs = None
        if other_tracks:
            outputs = model.predict_variant(
                interval=interval,
                variant=variant_obj,
                organism=organism,
                ontology_terms=ontology_terms,
                requested_outputs=[track_map[track][0] for track in other_tracks],
            )

        if contact_tracks:
            contact_outputs = model.predict_variant(
                interval=interval,
                variant=variant_obj,
                organism=organism,
                ontology_terms=ontology_terms,
                requested_outputs=[track_map[track][0] for track in contact_tracks],
            )
            if outputs is None:
                outputs = contact_outputs
            else:
                outputs = dc_replace(
                    outputs,
                    reference=dc_replace(
                        outputs.reference,
                        contact_maps=contact_outputs.reference.contact_maps,
                    ),
                    alternate=dc_replace(
                        outputs.alternate,
                        contact_maps=contact_outputs.alternate.contact_maps,
                    ),
                )
    except Exception as exc:
        raise UpstreamServiceError("Could not generate track predictions.") from exc

    return build_track_payload(
        outputs=outputs,
        variant=variant_obj,
        selected_tracks=available_tracks,
        track_map=track_map,
        interval_length=sequence_length,
        interval=interval,
        transcript_extractor=transcript_extractor,
        skipped=skipped,
    )


# ---------------------------------------------------------------------------
# LLM-assisted variant summary
# ---------------------------------------------------------------------------

# Which output types describe an effect on a named gene vs. an effect on a
# regulatory element. Mirrors the split the PoC used, extended with the
# splice/polyadenylation scorers this app exposes.
GENE_LINKED_OUTPUT_TYPES = {
    "RNA_SEQ",
    "CAGE",
    "SPLICE_JUNCTIONS",
    "SPLICE_SITES",
    "SPLICE_SITE_USAGE",
    "Polyadenylation",
}
REGULATORY_OUTPUT_TYPES = {
    "ATAC",
    "DNASE",
    "CHIP_TF",
    "CHIP_HISTONE",
    "PROCAP",
    "CONTACT_MAPS",
}

# Rows enter the digest only if |quantile_score| clears a user-set threshold
# (see AiSummaryRequest.quantile_threshold); rows with no quantile_score never
# match and are excluded outright, never silently ranked on raw_score instead.
# Whatever clears the threshold is still hard-capped here, strongest first, so
# a very low threshold can't blow up the prompt.
LLM_DEFAULT_QUANTILE_THRESHOLD = 0.5
LLM_MAX_ROWS = 100

LLM_SYSTEM_PROMPT = """\
You are a genomics assistant helping a researcher interpret AlphaGenome \
variant-effect predictions for a single variant. You are given the variant and \
a ranked digest of that run's scores, split into gene-linked tracks (RNA_SEQ, \
CAGE, splicing, polyadenylation) and regulatory tracks (ATAC, DNASE, CHIP_TF, \
CHIP_HISTONE, PROCAP, contact maps).

How to read the numbers:
- raw_score is the scorer's native output. Its units differ per scorer, so raw \
scores are NOT comparable across track types.
- quantile_score is that raw score's rank against a genome-wide background \
distribution of common human variants, computed per scorer and per track. \
Signed scorers map to [-1, 1] (0 = the median common variant); unsigned, \
magnitude-only scorers map to [0, 1]. A magnitude near 1 means the variant is \
extreme relative to common variation. This is the metric to compare across \
track types, and the digest is ranked by it.
- Rows marked "magnitude only (unsigned scorer)" come from a scorer that \
reports size of change without direction. For those the sign carries no \
meaning: describe them as an altered or disrupted signal, never as increased \
or decreased.
- These are model predictions from reference-genome sequence context. They are \
not measurements, not evidence of causality, and not clinical evidence.

Write your answer as markdown, 150-250 words, no preamble and no restating of \
the question. Use exactly these level-3 headings: "Most affected genes", \
"Regulatory signal", "Caveats".

Rules:
- Ground every claim in the digest. Name the specific genes, biosamples and \
track types it contains. Never introduce a score, track, tissue or gene that \
is not in the digest.
- You have no literature or database access in this mode. Do not cite papers, \
PMIDs, accessions, or database records, and do not imply you looked anything \
up. If general background about a named gene is relevant, mark it explicitly \
as prior background knowledge rather than a finding from this run.
- Do not make diagnostic, pathogenicity or clinical-actionability claims.
- If every quantile magnitude is small, say plainly that this run shows no \
strong predicted effect rather than manufacturing a narrative.
"""


@lru_cache(maxsize=LLM_CACHE_SIZE)
def get_llm_client(api_key: str, base_url: str) -> OpenAI:
    """Create and cache an OpenAI-compatible chat client per key + endpoint."""
    if not api_key or not api_key.strip():
        raise MissingLlmKeyError("Enter an LLM API key.")

    try:
        return OpenAI(
            base_url=base_url.strip() or DEFAULT_LLM_BASE_URL,
            api_key=api_key.strip(),
            timeout=LLM_TIMEOUT_SECONDS,
            max_retries=1,
        )
    except Exception as exc:
        raise LlmServiceError("Could not create the LLM client.") from exc


def _upstream_message(exc: Exception) -> str:
    """Pull the provider's own error message out of an openai exception body."""
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        message = body.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
        error = body.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return str(error["message"]).strip()
    return ""


def _raise_llm_error(exc: Exception) -> None:
    """Translate an openai client exception into an AppError subclass."""
    if isinstance(exc, (openai.AuthenticationError, openai.PermissionDeniedError)):
        raise InvalidLlmCredentialsError(
            "The LLM endpoint rejected this API key."
        ) from exc
    # An unknown model name is a 404 on some providers and a 400 on others
    # (Mistral returns "Invalid model: …"). Both mean the request as configured
    # can't work, so surface the endpoint's own wording.
    if isinstance(exc, (openai.NotFoundError, openai.BadRequestError)):
        detail = _upstream_message(exc)
        raise InvalidRequestError(
            f"The LLM endpoint rejected the request: {detail}"
            if detail
            else "The LLM endpoint rejected the request. Check the model name."
        ) from exc
    if isinstance(exc, openai.APIConnectionError):
        raise LlmServiceError(
            "Could not reach the LLM endpoint. Check the base URL."
        ) from exc
    if isinstance(exc, openai.RateLimitError):
        raise LlmServiceError(
            "The LLM endpoint rate-limited this request. Try again shortly."
        ) from exc
    raise LlmServiceError("The LLM request failed.") from exc


def verify_llm_credentials(api_key: str, base_url: str, model: str) -> str:
    """Check key + endpoint + model with a single throwaway completion.

    The frontend hides the AI-summary button until this passes, so this has to
    exercise the same call path the real summary uses — listing models would
    validate the key but not the model name.
    """
    model_name = model.strip() or DEFAULT_LLM_MODEL
    client = get_llm_client(api_key, base_url)

    try:
        client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=1,
            temperature=0,
        )
    except Exception as exc:
        _raise_llm_error(exc)

    return model_name


def _as_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return None if np.isnan(number) else number


def _effect_size(quantile: float) -> str:
    """Bucket a row's magnitude on the cross-scorer-comparable metric.

    quantile_score is a percentile rank against common variation, so its
    magnitude means the same thing for every track type. Rows without a
    quantile_score never reach here: they can't clear a quantile threshold,
    so `format_scores_for_llm` excludes them before this is called.
    """
    magnitude = abs(quantile)
    if magnitude < 0.5:
        return "within common-variant range"
    if magnitude < 0.8:
        return "low effect"
    if magnitude < 0.95:
        return "moderate effect"
    return "high effect"


def _output_type_is_signed(rows: list[dict[str, Any]]) -> dict[str, bool]:
    """Flag which output types produced signed scores in this run.

    Gene-mask-active scorers return magnitude-only values, so a positive
    raw_score there does not mean "increased". Only claim a direction for an
    output type that produced at least one negative value somewhere in the
    table.
    """
    signed: dict[str, bool] = {}
    for row in rows:
        output_type = str(row.get("output_type") or "unknown")
        raw = _as_float(row.get("raw_score"))
        quantile = _as_float(row.get("quantile_score"))
        is_negative = (raw is not None and raw < 0) or (
            quantile is not None and quantile < 0
        )
        signed[output_type] = signed.get(output_type, False) or is_negative
    return signed


_LABEL_FIELDS = ("biosample_name", "transcription_factor", "histone_mark", "track_strand")


def _row_label(row: dict[str, Any], columns: set[str] | None) -> str:
    """Describe what a row was measured on, beyond gene and output type.

    Only draws on fields present in `columns` (None means "all columns"), so a
    field the user unchecked in the table never leaks into the digest.
    """
    parts: list[str] = []
    for key in ("biosample_name", "transcription_factor", "histone_mark"):
        if columns is not None and key not in columns:
            continue
        value = row.get(key)
        if value is not None and str(value).strip() and str(value) != "nan":
            parts.append(str(value))
    if columns is None or "track_strand" in columns:
        strand = row.get("track_strand")
        if strand is not None and str(strand).strip() in {"+", "-"}:
            parts.append(f"strand {strand}")
    return ", ".join(parts) if parts else "unspecified track"


def _columns_include(columns: set[str] | None, *names: str) -> bool:
    """True if any of `names` should be shown: all columns, or one is selected."""
    return columns is None or any(name in columns for name in names)


def format_scores_for_llm(
    rows: list[dict[str, Any]],
    quantile_threshold: float = LLM_DEFAULT_QUANTILE_THRESHOLD,
    max_rows: int = LLM_MAX_ROWS,
    columns: list[str] | None = None,
) -> tuple[str, int, bool]:
    """Flatten scored rows into the text digest sent to the model.

    Selection: keep rows with |quantile_score| > quantile_threshold, ranked
    strongest first, hard-capped at max_rows. Rows with no quantile_score
    (raw_score only) never clear a quantile threshold, so they are excluded
    outright rather than falling back to raw_score.

    `columns`, if given, restricts which fields a row's line can draw on
    (None means every column is available); a field the user unchecked in the
    table is omitted from the line rather than fabricated.

    Returns the digest, how many rows it covers, and whether rows were dropped.
    """
    if not rows:
        raise InvalidRequestError("No scored rows to summarize.")

    column_set = set(columns) if columns is not None else None

    def quantile_magnitude(row: dict[str, Any]) -> float | None:
        quantile = _as_float(row.get("quantile_score"))
        return abs(quantile) if quantile is not None else None

    above_threshold = [
        row for row in rows if (m := quantile_magnitude(row)) is not None and m > quantile_threshold
    ]
    ranked = sorted(above_threshold, key=lambda row: quantile_magnitude(row) or 0.0, reverse=True)
    kept = ranked[:max_rows]

    truncated = len(kept) < len(rows)
    no_quantile_count = sum(1 for row in rows if _as_float(row.get("quantile_score")) is None)

    signed_by_type = _output_type_is_signed(rows)

    def category(output_type: str) -> str:
        if output_type in GENE_LINKED_OUTPUT_TYPES:
            return "Gene-linked"
        if output_type in REGULATORY_OUTPUT_TYPES:
            return "Regulatory"
        return "Other"

    sections: dict[str, list[str]] = {"Gene-linked": [], "Regulatory": [], "Other": []}
    for row in kept:
        output_type = str(row.get("output_type") or "unknown")
        raw = _as_float(row.get("raw_score"))
        quantile = _as_float(row.get("quantile_score"))

        segments: list[str] = []

        if _columns_include(column_set, "gene_name"):
            gene = row.get("gene_name")
            if gene not in (None, "", "nan") and str(gene) != "nan":
                segments.append(str(gene))

        if _columns_include(column_set, "output_type"):
            segments.append(output_type)

        if _columns_include(column_set, *_LABEL_FIELDS):
            segments.append(_row_label(row, column_set))

        if _columns_include(column_set, "raw_score"):
            if not signed_by_type.get(output_type, False):
                direction = "magnitude only (unsigned scorer)"
            elif raw is not None and raw < 0:
                direction = "decreased"
            elif raw is not None and raw > 0:
                direction = "increased"
            else:
                direction = "no change"
            segments.append(direction)
            segments.append(f"raw_score: {raw:.4g}" if raw is not None else "raw_score: n/a")

        if _columns_include(column_set, "quantile_score"):
            # quantile is never None here: selection already required it.
            assert quantile is not None
            segments.append(f"quantile_score: {quantile:+.3f}")
            segments.append(_effect_size(quantile))

        if _columns_include(column_set, "hpo_gene_relevance") and _as_float(
            row.get("hpo_gene_relevance")
        ) == 1.0:
            segments.append("matches a selected HPO term")

        sections[category(output_type)].append(
            " | ".join(segments) if segments else "(no selected columns)"
        )

    lines: list[str] = []
    for name in ("Gene-linked", "Regulatory", "Other"):
        if sections[name]:
            lines.append(f"--- {name} tracks ---")
            lines.extend(sections[name])
            lines.append("")

    if truncated:
        note = (
            f"(Digest shows the top {len(kept)} of {len(rows)} scored rows: "
            f"rows with |quantile_score| > {quantile_threshold:g} are kept, "
            f"strongest first, capped at {max_rows}."
        )
        if no_quantile_count:
            note += (
                f" {no_quantile_count} row(s) had no quantile_score and were "
                "excluded outright, never ranked by raw_score."
            )
        note += ")"
        lines.append(note)

    return "\n".join(lines).strip(), len(kept), truncated


def build_summary_prompt(
    variant_str: str,
    organism_label: str,
    scores_digest: str,
    hpo_terms: Iterable[str] | None = None,
) -> str:
    parts = variant_str.split(":")
    if len(parts) == 4:
        chromosome, position, reference, alternate = parts
        variant_block = (
            f"chromosome: {chromosome}\n"
            f"position: {position}\n"
            f"reference allele: {reference}\n"
            f"alternate allele: {alternate}"
        )
    else:
        variant_block = f"variant: {variant_str}"

    hpo_list = [term for term in (hpo_terms or []) if term]
    hpo_block = ""
    if hpo_list:
        hpo_block = (
            "\nThe researcher selected these HPO phenotype terms; rows for genes "
            "annotated to them are flagged in the digest. Treat the flag as the "
            "researcher's interest, not as evidence of a link:\n"
            + "\n".join(f"- {term}" for term in hpo_list)
            + "\n"
        )

    return (
        f"Organism: {organism_label}\n"
        f"{variant_block}\n"
        f"{hpo_block}\n"
        "AlphaGenome scores for this variant, ranked by |quantile_score|:\n"
        f"{scores_digest}\n"
    )


def summarize_variant_scores(
    api_key: str,
    base_url: str,
    model: str,
    variant_str: str,
    organism_label: str,
    rows: list[dict[str, Any]],
    hpo_terms: Iterable[str] | None = None,
    quantile_threshold: float = LLM_DEFAULT_QUANTILE_THRESHOLD,
    columns: list[str] | None = None,
) -> dict[str, Any]:
    """Turn a scored variant into an LLM-written interpretation."""
    scores_digest, row_count, truncated = format_scores_for_llm(
        rows, quantile_threshold=quantile_threshold, columns=columns
    )
    model_name = model.strip() or DEFAULT_LLM_MODEL
    client = get_llm_client(api_key, base_url)
    prompt = build_summary_prompt(variant_str, organism_label, scores_digest, hpo_terms)

    LOGGER.info(
        "llm_summary_requested model=%s variant=%s rows=%s truncated=%s",
        model_name,
        variant_str,
        row_count,
        truncated,
    )

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": LLM_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
    except Exception as exc:
        _raise_llm_error(exc)

    summary = (response.choices[0].message.content or "").strip() if response.choices else ""
    if not summary:
        raise LlmServiceError("The LLM returned an empty summary.")

    return {
        "summary": summary,
        "model": response.model or model_name,
        "scores_digest": scores_digest,
        "row_count": row_count,
        "truncated": truncated,
    }
