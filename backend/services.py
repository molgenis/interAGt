"""Service layer: metadata, model client, transcripts, variants, scoring, plotting."""
from __future__ import annotations

import json
from dataclasses import dataclass, field, replace as dc_replace
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
from alphagenome.data import gene_annotation, genome, transcript
from alphagenome.models import dna_client, variant_scorers

from backend.core import (
    MODEL_CACHE_SIZE,
    RESOURCES_DIR,
    InvalidRequestError,
    InvalidVariantError,
    MissingApiKeyError,
    NoTrackDataError,
    NoVariantResultsError,
    UpstreamServiceError,
)
from helper_functions import resolve_variant


# ---------------------------------------------------------------------------
# Metadata constants
# ---------------------------------------------------------------------------

ORGANISM_MAP = {
    "Human (hg38)": dna_client.Organism.HOMO_SAPIENS,
    "Mouse (mm10)": dna_client.Organism.MUS_MUSCULUS,
}

ORGANISM_EXAMPLE_VARIANTS = {
    "Human (hg38)": "chr5:1295113:G:A",
    "Mouse (mm10)": "chr13:73626861:C:G",
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


def normalize_variant_str(variant_str: str, organism_label: str) -> NormalizedVariantResult:
    resolution = resolve_variant(variant_str, organism_label)
    # Hard errors still raise; a reference mismatch is flagged for confirmation.
    if resolution.error:
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

    dropped_columns = [
        column
        for column in ["variant_id", "scored_interval"]
        if column in df_scores.columns
    ]

    result_df = df_scores.sort_values("raw_score", key=abs, ascending=False)
    if dropped_columns:
        result_df = result_df.drop(columns=dropped_columns)

    return result_df


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

    return ranked_scores.sort_values(
        ["hpo_gene_relevance", "raw_score"],
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

    # Contact maps use cell-line-scoped ontology (EFO) that does not overlap
    # the user-selected tissue ontology terms; filtering by ontology_terms
    # returns zero contact-map tracks. Request contact maps unfiltered.
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
                ontology_terms=ontology_terms, #changed from None, user needs to know what terms have contact maps.
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
