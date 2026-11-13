"""Service layer: metadata, model client, transcripts, variants, scoring, plotting."""
from __future__ import annotations

import enum
import json
import re
from dataclasses import dataclass, field, replace as dc_replace
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
from alphagenome.data import gene_annotation, genome, transcript
from alphagenome.models.v1 import dna_client as dna_client_v1
from alphagenome.models.v1 import variant_scorers as variant_scorers_v1
from alphagenome.models.v2 import dna_client as dna_client_v2
from alphagenome.models.v2 import variant_scorers as variant_scorers_v2

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
# Model versions
# ---------------------------------------------------------------------------

AG1 = "ag1"
AG2 = "ag2"
DEFAULT_MODEL_VERSION = AG2


@dataclass(frozen=True)
class ModelSpec:
    """Per-version AlphaGenome modules and the app's choices for that version."""

    key: str
    label: str
    dna_client: Any
    variant_scorers: Any
    scorer_choices: tuple[str, ...]
    default_tracks: tuple[str, ...]
    # Output types the app offers for scoring but cannot plot as a positional
    # track (AG2 single-cell expression is gene-level GeneExpressionData).
    excluded_visualization_tracks: tuple[str, ...] = ()
    # Output types that only exist under expression conditioning on the user's
    # own scRNA-seq counts, which interAGt does not offer (yet).
    hidden_output_types: tuple[str, ...] = ()
    uses_conditions: bool = False


MODEL_SPECS: dict[str, ModelSpec] = {
    AG1: ModelSpec(
        key=AG1,
        label="AlphaGenome 1",
        dna_client=dna_client_v1,
        variant_scorers=variant_scorers_v1,
        scorer_choices=(
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
        ),
        default_tracks=("RNA_SEQ", "CHIP_TF", "ATAC"),
    ),
    AG2: ModelSpec(
        key=AG2,
        label="AlphaGenome 2",
        dna_client=dna_client_v2,
        variant_scorers=variant_scorers_v2,
        scorer_choices=(
            "RNA_SEQ",
            "CAGE",
            "ATAC",
            "DNASE",
            "CHIP_HISTONE",
            "CHIP_TF",
            "METHYLATION",
            "SC_GENE_EXPRESSION",
            "SC_ATAC",
            "CONTACT_MAPS",
            "SPLICE_SITES",
            "SPLICE_SITE_USAGE",
            "SPLICE_JUNCTIONS",
            "Polyadenylation",
        ),
        default_tracks=("RNA_SEQ", "CHIP_TF", "ATAC"),
        excluded_visualization_tracks=("SC_GENE_EXPRESSION",),
        hidden_output_types=("SC_GENE_EXPRESSION_DENOISED", "CELL_EMBEDDINGS"),
        uses_conditions=True,
    ),
}

# AG2 labels every track observed / imputed_supported / imputed_exploratory.
IMPUTATION_MODES = ("observed", "imputed_supported", "imputed_exploratory")

# What to show of those, per condition and output type:
# - auto: observed tracks if there are any, otherwise imputed_supported ones.
#   Many conditions (e.g. single-cell-only cell types) have no observed bulk
#   RNA_SEQ/ATAC/CHIP_TF, so a strict "observed" default often returns nothing.
# - observed / supported / all: fixed sets of imputation modes.
IMPUTATION_POLICIES: dict[str, tuple[str, ...]] = {
    "observed": ("observed",),
    "supported": ("observed", "imputed_supported"),
    "all": IMPUTATION_MODES,
}
AUTO_IMPUTATION = "auto"
DEFAULT_IMPUTATION_POLICY = AUTO_IMPUTATION

# Caps on plotted AG2 tracks. Imputation can return hundreds of channels
# (e.g. ~780 transcription factors for CHIP_TF), and every condition multiplies
# that; each track is a full-length curve and its own plot row, so beyond a few
# dozen rows the payload and the figure become unusable.
MAX_TRACKS_PER_OUTPUT = 10  # per output type and condition
MAX_PLOTTED_TRACKS = 40  # in total, shared fairly across conditions/types

# AG2 predicts one condition per call, so each selected condition is a separate
# (more compute-heavy) API request. Mirrors the UI cap.
MAX_CONDITIONS = 10


def get_model_spec(model_version: str | None) -> ModelSpec:
    key = (model_version or DEFAULT_MODEL_VERSION).strip().lower()
    spec = MODEL_SPECS.get(key)
    if spec is None:
        raise InvalidRequestError(
            f"Unsupported model version: {model_version}. "
            f"Choose one of {sorted(MODEL_SPECS)}."
        )
    return spec


def get_model_versions() -> list[dict[str, Any]]:
    return [
        {"value": spec.key, "label": spec.label, "default": spec.key == DEFAULT_MODEL_VERSION}
        for spec in MODEL_SPECS.values()
    ]


# Backwards-compatible module-level names (AG1 values, as before).
SCORER_SELECTION_CHOICES = list(MODEL_SPECS[AG1].scorer_choices)
DEFAULT_TRACK_SELECTION = list(MODEL_SPECS[AG1].default_tracks)
EXCLUDED_VISUALIZATION_TRACKS: list[str] = []


# ---------------------------------------------------------------------------
# Metadata constants
# ---------------------------------------------------------------------------

# UI label -> Organism enum member name. Each model version has its own
# Organism enum, so members are resolved per version (see resolve_organism).
ORGANISM_LABELS = {
    "Human (hg38)": "HOMO_SAPIENS",
    "Mouse (mm10)": "MUS_MUSCULUS",
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


# ---------------------------------------------------------------------------
# AlphaGenome client
# ---------------------------------------------------------------------------


@lru_cache(maxsize=MODEL_CACHE_SIZE)
def get_model(api_key: str, model_version: str = DEFAULT_MODEL_VERSION):
    """Create and cache the AlphaGenome client by API key and model version."""
    if not api_key or not api_key.strip():
        raise MissingApiKeyError("Enter API key.")
    spec = get_model_spec(model_version)

    try:
        return spec.dna_client.create(api_key)
    except Exception as exc:
        raise UpstreamServiceError(
            f"Could not create {spec.label} client."
        ) from exc


# ---------------------------------------------------------------------------
# Metadata / ontology / tracks
# ---------------------------------------------------------------------------


def _organism_name(organism: Any) -> str:
    """Normalise a UI label, enum name or Organism enum member to its name."""
    if isinstance(organism, enum.Enum):
        return organism.name
    if not isinstance(organism, str):
        raise InvalidRequestError("Unsupported organism value.")
    if organism in ORGANISM_LABELS:
        return ORGANISM_LABELS[organism]
    name = organism.strip().upper()
    if name in ORGANISM_LABELS.values():
        return name
    raise InvalidRequestError(f"Unsupported organism value: {organism}")


def resolve_organism(organism: Any, model_version: str = DEFAULT_MODEL_VERSION):
    spec = get_model_spec(model_version)
    name = _organism_name(organism)
    try:
        return spec.dna_client.Organism[name]
    except KeyError as exc:
        raise InvalidRequestError(
            f"Organism {name} is not supported by {spec.label}."
        ) from exc


def get_organism_label(organism: Any) -> str:
    name = _organism_name(organism)
    for label, enum_name in ORGANISM_LABELS.items():
        if enum_name == name:
            return label
    raise InvalidRequestError(f"Unsupported organism value: {organism}")


def get_organisms() -> list[dict[str, str]]:
    return [
        {
            "label": label,
            "value": enum_name,
            "example_variant": ORGANISM_EXAMPLE_VARIANTS[label],
        }
        for label, enum_name in ORGANISM_LABELS.items()
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


def _output_type_name(output_type: Any) -> str:
    return getattr(output_type, "name", str(output_type).split(".")[-1])


def get_available_scorers(
    organism: Any,
    available_tracks: Iterable[str],
    model_version: str = DEFAULT_MODEL_VERSION,
) -> list[str]:
    spec = get_model_spec(model_version)
    resolved = resolve_organism(organism, spec.key)
    track_names = set(available_tracks)
    scorers_lib = spec.variant_scorers

    available: list[str] = []
    for name in spec.scorer_choices:
        scorer = scorers_lib.RECOMMENDED_VARIANT_SCORERS.get(name.upper())
        if scorer is None:
            continue

        supported = scorers_lib.SUPPORTED_ORGANISMS.get(scorer.base_variant_scorer, ())
        if resolved.value not in supported:
            continue

        requested_output = getattr(scorer, "requested_output", None)
        if requested_output is not None:
            if _output_type_name(requested_output) not in track_names:
                continue

        available.append(name)

    return available


def _organism_cache_key(organism: Any) -> str:
    return _organism_name(organism)


@lru_cache(maxsize=128)
def _get_output_metadata(api_key: str, organism_key: str, model_version: str = DEFAULT_MODEL_VERSION):
    spec = get_model_spec(model_version)
    model = get_model(api_key, spec.key)
    organism = resolve_organism(organism_key, spec.key)
    try:
        if spec.uses_conditions:
            # AG2: metadata for tracks measured in training; imputed tracks
            # share these output types.
            return model.observed_metadata(organism=organism).concatenate()
        return model.output_metadata(organism=organism).concatenate()
    except Exception as exc:
        raise UpstreamServiceError("Could not load output metadata.") from exc


@lru_cache(maxsize=16)
def _get_supported_conditions(api_key: str, organism_key: str) -> pd.DataFrame:
    model = get_model(api_key, AG2)
    organism = resolve_organism(organism_key, AG2)
    try:
        return model.supported_conditions(organism=organism)
    except Exception as exc:
        raise UpstreamServiceError("Could not load supported conditions.") from exc


def load_condition_descriptions(api_key: str, organism: Any) -> dict[str, str]:
    """AG2: {"label (condition)": coverage text}, keyed like the display options."""
    df = _get_supported_conditions(api_key, _organism_cache_key(organism))
    if df is None or "condition" not in df.columns:
        return {}
    meta_columns = {"condition", "biosample_type", "biosample_name"}
    output_columns = [c for c in df.columns if c not in meta_columns]
    descriptions: dict[str, str] = {}
    for _, row in df.drop_duplicates(subset="condition").iterrows():
        label = row.get("biosample_name") or row["condition"]
        descriptions[f"{label} ({row['condition']})"] = _condition_coverage_text(row, output_columns)
    return descriptions


def load_ontology_terms(
    api_key: str, organism: Any, model_version: str = DEFAULT_MODEL_VERSION
) -> tuple[dict[str, str], list[str]]:
    """Return {curie_or_condition: label} plus "label (curie)" display strings.

    AG1 lists the ontology CURIEs present in the track metadata. AG2 lists its
    reference conditions (a single CURIE or several joined by "_").
    """
    spec = get_model_spec(model_version)
    if spec.uses_conditions:
        df = _get_supported_conditions(api_key, _organism_cache_key(organism))
        if df is None or "condition" not in df.columns:
            return {}, []
        names = df["biosample_name"] if "biosample_name" in df.columns else df["condition"]
        pairs = pd.DataFrame({"curie": df["condition"], "label": names.fillna(df["condition"])})
    else:
        metadata = _get_output_metadata(api_key, _organism_cache_key(organism), spec.key)
        if not hasattr(metadata, "ontology_curie"):
            return {}, []
        pairs = metadata[["ontology_curie", "biosample_name"]].rename(
            columns={"ontology_curie": "curie", "biosample_name": "label"}
        )

    pairs = pairs.dropna().drop_duplicates(subset="curie")
    curie_to_label = dict(zip(pairs["curie"], pairs["label"]))
    display_options = sorted(f"{label} ({curie})" for curie, label in curie_to_label.items())
    return curie_to_label, display_options


def load_tracks(
    api_key: str, organism: Any, model_version: str = DEFAULT_MODEL_VERSION
) -> dict[str, tuple[Any, str]]:
    spec = get_model_spec(model_version)
    metadata = _get_output_metadata(api_key, _organism_cache_key(organism), spec.key)

    if not hasattr(metadata, "output_type"):
        return {}

    track_map: dict[str, tuple[Any, str]] = {}
    for output_type in metadata.output_type.unique().tolist():
        clean_name = _output_type_name(output_type)
        if clean_name in spec.hidden_output_types:
            continue
        track_map[clean_name] = (output_type, clean_name.lower())

    order = {name: index for index, name in enumerate(spec.scorer_choices)}
    return dict(
        sorted(track_map.items(), key=lambda item: order.get(item[0], len(order)))
    )


def get_default_track_selection(
    track_map: dict[str, Any], model_version: str = DEFAULT_MODEL_VERSION
) -> list[str]:
    spec = get_model_spec(model_version)
    return [track for track in spec.default_tracks if track in track_map]


def get_excluded_visualization_tracks(model_version: str = DEFAULT_MODEL_VERSION) -> list[str]:
    return list(get_model_spec(model_version).excluded_visualization_tracks)


def validate_conditions(conditions: Iterable[str] | None) -> list[str]:
    cleaned = list(dict.fromkeys(c.strip() for c in (conditions or []) if c and c.strip()))
    if not cleaned:
        raise InvalidRequestError(
            "AlphaGenome 2 needs at least one condition (tissue, cell type or cell line)."
        )
    if len(cleaned) > MAX_CONDITIONS:
        raise InvalidRequestError(f"Select at most {MAX_CONDITIONS} conditions.")
    return cleaned


def validate_imputation_policy(policy: str | None) -> str:
    cleaned = (policy or DEFAULT_IMPUTATION_POLICY).strip().lower()
    if cleaned != AUTO_IMPUTATION and cleaned not in IMPUTATION_POLICIES:
        raise InvalidRequestError(
            f"Unknown imputation setting: {policy}. Choose from "
            f"{[AUTO_IMPUTATION, *IMPUTATION_POLICIES]}."
        )
    return cleaned


def _modes_for_group(available_modes: Iterable[str], policy: str) -> tuple[str, ...]:
    """Imputation modes to keep for one condition x output type."""
    if policy != AUTO_IMPUTATION:
        return IMPUTATION_POLICIES[policy]
    present = set(available_modes)
    if "observed" in present:
        return ("observed",)
    if "imputed_supported" in present:
        return ("imputed_supported",)
    return ()


def _mode_counts_text(counts: dict[str, int]) -> str:
    parts = [f"{counts[m]} {m.replace('_', ' ')}" for m in IMPUTATION_MODES if counts.get(m)]
    return ", ".join(parts) if parts else "none"


def _condition_coverage_text(row: pd.Series, output_columns: list[str]) -> str:
    """Hover text for the condition picker: which outputs are measured or imputed."""
    groups: dict[str, list[str]] = {m: [] for m in IMPUTATION_MODES}
    for column in output_columns:
        mode = row.get(column)
        if isinstance(mode, str) and mode in groups:
            groups[mode].append(column.upper())
    titles = {
        "observed": "Observed",
        "imputed_supported": "Imputed (supported)",
        "imputed_exploratory": "Imputed (exploratory)",
    }
    lines = [f"{titles[m]}: {', '.join(cols)}" for m, cols in groups.items() if cols]
    return "\n".join(lines) if lines else "No coverage information."


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


def resolve_variant_scorers(
    selected_scorer_names: Iterable[str],
    model_version: str = DEFAULT_MODEL_VERSION,
) -> list[Any]:
    selected = {name.lower() for name in selected_scorer_names}
    all_scorers = get_model_spec(model_version).variant_scorers.RECOMMENDED_VARIANT_SCORERS
    resolved = [
        scorer
        for scorer_name, scorer in all_scorers.items()
        if scorer_name.lower() in selected
    ]

    if not resolved:
        raise InvalidRequestError("No valid variant scorers selected.")

    return resolved


def _filter_imputation(df: pd.DataFrame, policy: str) -> pd.DataFrame:
    """Keep rows per the imputation policy, decided per output type (one
    condition's results are passed in at a time)."""
    if "imputation_mode" not in df.columns or df.empty:
        return df
    group_key = "output_type" if "output_type" in df.columns else None
    if group_key is None:
        keep = _modes_for_group(df["imputation_mode"].unique(), policy)
        return df[df["imputation_mode"].isin(keep)]
    parts = []
    for _, group in df.groupby(group_key, sort=False):
        keep = _modes_for_group(group["imputation_mode"].unique(), policy)
        parts.append(group[group["imputation_mode"].isin(keep)])
    return pd.concat(parts) if parts else df.iloc[0:0]


def score_variant(
    model: Any,
    organism: Any,
    variant_str: str,
    sequence_length: int,
    scorer_names: Iterable[str],
    model_version: str = DEFAULT_MODEL_VERSION,
    conditions: Iterable[str] | None = None,
    imputation_policy: str | None = None,
) -> pd.DataFrame:
    """Score a variant.

    AG1 scores every tissue/cell type in one call. AG2 scores one reference
    condition per call, so this loops over `conditions` and concatenates.
    """
    spec = get_model_spec(model_version)
    interval, variant_obj = parse_variant_interval(variant_str, sequence_length)
    selected_scorers = resolve_variant_scorers(scorer_names, spec.key)
    scorers_lib = spec.variant_scorers

    try:
        if spec.uses_conditions:
            selected_conditions = validate_conditions(conditions)
            policy = validate_imputation_policy(imputation_policy)
            frames: list[pd.DataFrame] = []
            for condition in selected_conditions:
                variant_scores = model.score_variant(
                    interval=interval,
                    variant=variant_obj,
                    condition=condition,
                    variant_scorers=selected_scorers,
                    organism=organism,
                )
                df_condition = scorers_lib.tidy_scores(variant_scores)
                if df_condition is None or df_condition.empty:
                    continue
                df_condition = _filter_imputation(df_condition, policy)
                df_condition.insert(0, "condition", condition)
                frames.append(df_condition)
            df_scores = pd.concat(frames, ignore_index=True) if frames else None
        else:
            variant_scores = model.score_variant(
                interval=interval,
                variant=variant_obj,
                variant_scorers=selected_scorers,
                organism=organism,
            )
            df_scores = scorers_lib.tidy_scores(variant_scores)
    except InvalidRequestError:
        raise
    except Exception as exc:
        raise UpstreamServiceError("Could not score variant.") from exc

    if df_scores is None or df_scores.empty:
        raise NoVariantResultsError(
            "No variant results"
            + (
                " for the selected imputation setting; try including imputed tracks."
                if spec.uses_conditions
                else ""
            )
        )

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
    # per scorer. Only fall back to raw_score if no scorer produced quantiles
    # (AG1 mouse, and every AG2 result: AG2 returns raw_score only).
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
    for key in (
        "name",
        "biosample_name",
        "strand",
        "transcription_factor",
        "imputation_mode",
        "biosample_curie",
    ):
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


def _channel_indices(metadata: Any, n_channels: int) -> list[int]:
    """Indices of non-padding channels."""
    if metadata is None or not hasattr(metadata, "columns"):
        return list(range(n_channels))
    keep = np.ones(n_channels, dtype=bool)
    if "padding" in metadata.columns:
        keep &= ~metadata["padding"].fillna(False).astype(bool).to_numpy()[:n_channels]
    return [int(i) for i in np.flatnonzero(keep)]


def _collect_track_entries(
    outputs: Any,
    selected_tracks: list[str],
    track_map: dict[str, tuple[Any, str]],
    interval_length: int,
    interval: Any,
    skipped: list[dict[str, str]],
    *,
    condition: str | None = None,
    condition_label: str | None = None,
    imputation_policy: str | None = None,
    notes: list[dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
    """Turn one VariantOutput into plot entries; appends diagnostics to `skipped`
    (tracks with nothing to show) and `notes` (tracks shown with caveats).

    `condition` (AG2) is attached to each entry's metadata and to messages,
    since AG2 returns one VariantOutput per condition. `imputation_policy`
    (AG2) selects channels by imputation mode; None (AG1) keeps all.
    """
    tracks_payload: list[dict[str, Any]] = []
    notes = notes if notes is not None else []
    shown_condition = condition_label or condition
    where = f" in {shown_condition}" if condition else ""
    label = (lambda name: f"{name} ({shown_condition})") if condition else (lambda name: name)

    def entry_metadata(metadata: Any) -> dict[str, Any]:
        out = _metadata_to_dict(metadata)
        if condition:
            out["condition"] = condition
            if condition_label:
                out["condition_label"] = condition_label
        return out

    def select(track_name: str, metadata: Any, n_channels: int) -> list[int]:
        """Channels to plot for one output type; records why if none/some."""
        indices = _channel_indices(metadata, n_channels)
        if imputation_policy is None or not indices:
            if not indices:
                skipped.append(
                    _skip(
                        label(track_name),
                        "track_tissue_mismatch",
                        f"No {track_name} data is available for the selected tissue(s){where}.",
                    )
                )
            return indices
        if metadata is None or "imputation_mode" not in getattr(metadata, "columns", ()):
            return indices[:MAX_TRACKS_PER_OUTPUT]

        modes = metadata["imputation_mode"].to_numpy()
        counts = {m: int(sum(modes[i] == m for i in indices)) for m in IMPUTATION_MODES}
        keep_modes = _modes_for_group([modes[i] for i in indices], imputation_policy)
        # Most reliable first, so a cap below drops exploratory tracks first.
        rank = {m: r for r, m in enumerate(IMPUTATION_MODES)}
        kept = sorted(
            (i for i in indices if modes[i] in keep_modes),
            key=lambda i: (rank.get(modes[i], len(rank)), i),
        )

        if not kept:
            if imputation_policy == AUTO_IMPUTATION:
                hint = (
                    "only exploratory imputations are available; choose "
                    "'All, incl. exploratory' under Imputed tracks to see them."
                )
            else:
                hint = (
                    "no tracks match the Imputed tracks setting; choose a "
                    "wider setting (or 'Best available') to see them."
                )
            skipped.append(
                _skip(
                    label(track_name),
                    "only_imputed_tracks",
                    f"{track_name}{where}: {hint} Available: {_mode_counts_text(counts)}.",
                )
            )
            return []

        if imputation_policy == AUTO_IMPUTATION and "observed" not in keep_modes:
            notes.append(
                _skip(
                    label(track_name),
                    "imputed_fallback",
                    f"{track_name} was not measured{where}; showing the model's "
                    "supported imputations instead.",
                )
            )
        if len(kept) > MAX_TRACKS_PER_OUTPUT:
            notes.append(
                _skip(
                    label(track_name),
                    "tracks_capped",
                    f"Showing the first {MAX_TRACKS_PER_OUTPUT} of {len(kept)} "
                    f"{track_name} tracks{where}; use Scores mode to rank all of them.",
                )
            )
            kept = kept[:MAX_TRACKS_PER_OUTPUT]
        return kept

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
            if track_name == "CONTACT_MAPS" and not condition:
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
                        label(track_name),
                        "no_output_data",
                        f"AlphaGenome returned no {track_name} data{where} for this interval and sequence length.",
                    )
                )
            continue

        if track_name not in _CONTINUOUS_EXCLUDED:
            ref_values = ref_data.values
            alt_values = alt_data.values
            indices = select(track_name, ref_data.metadata, ref_values.shape[1])
            if not indices:
                continue
            ref_interval_start = int(ref_data.interval.start)
            for i in indices:
                metadata = ref_data.metadata.iloc[i]
                tracks_payload.append(
                    {
                        "type": "continuous",
                        "track_name": track_name,
                        "metadata": entry_metadata(metadata),
                        "interval_start": ref_interval_start,
                        "ref_values": _resample_to(ref_values[:, i], interval_length),
                        "alt_values": _resample_to(alt_values[:, i], interval_length),
                    }
                )
        elif track_name == "SPLICE_JUNCTIONS":
            n_channels = ref_data.values.shape[1]
            indices = select(track_name, ref_data.metadata, n_channels)
            if not indices:
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
                        label(track_name),
                        "empty_splice_junctions",
                        f"No splice junctions were predicted in this variant's window{where}.",
                    )
                )
                continue

            ref_counts = list(getattr(ref_data, "values", []))
            alt_counts = list(getattr(alt_data, "values", []))

            for i in indices:
                metadata = ref_data.metadata.iloc[i]
                tracks_payload.append(
                    {
                        "type": "sashimi",
                        "track_name": track_name,
                        "metadata": entry_metadata(metadata),
                        "ref_junctions": _serialize_junctions(ref_junctions, ref_counts, i),
                        "alt_junctions": _serialize_junctions(alt_junctions, alt_counts, i),
                    }
                )
        elif track_name == "CONTACT_MAPS":
            ref_values = ref_data.values
            alt_values = alt_data.values
            if condition:
                indices = select(track_name, ref_data.metadata, ref_values.shape[2])
            else:
                indices = _channel_indices(ref_data.metadata, ref_values.shape[2])
            if not indices:
                if not condition:
                    skipped.append(
                        _skip(
                            track_name,
                            "contact_map_ontology_mismatch",
                            "No contact map data was returned for the selected ontology term(s); "
                            "contact maps use a separate cell-line ontology that may not overlap your tissue selection.",
                        )
                    )
                continue
            for i in indices:
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
                        "metadata": entry_metadata(metadata),
                        "z": contact_diff.tolist(),
                        "coords": coords,
                    }
                )

    return tracks_payload


def _cap_total_tracks(
    tracks_payload: list[dict[str, Any]],
    notes: list[dict[str, str]],
    limit: int = MAX_PLOTTED_TRACKS,
) -> list[dict[str, Any]]:
    """Keep at most `limit` entries, taken round-robin over (track type,
    condition) groups so every selected combination stays represented.
    Within a group the existing order (most reliable first) is kept."""
    if len(tracks_payload) <= limit:
        return tracks_payload
    groups: dict[tuple[str, str], list[int]] = {}
    for idx, entry in enumerate(tracks_payload):
        key = (entry["track_name"], entry["metadata"].get("condition", ""))
        groups.setdefault(key, []).append(idx)
    chosen: set[int] = set()
    depth = 0
    while len(chosen) < limit:
        added = False
        for indices in groups.values():
            if depth < len(indices) and len(chosen) < limit:
                chosen.add(indices[depth])
                added = True
        if not added:
            break
        depth += 1
    notes.append(
        _skip(
            "All tracks",
            "tracks_capped_total",
            f"Showing {limit} of {len(tracks_payload)} tracks to keep the plot "
            "readable; select fewer conditions or track types to see more, or "
            "use Scores mode to rank all of them.",
        )
    )
    # Keep the original order (grouped by condition, then track type).
    return [entry for idx, entry in enumerate(tracks_payload) if idx in chosen]


def _finalize_track_payload(
    tracks_payload: list[dict[str, Any]],
    skipped: list[dict[str, str]],
    variant: Any,
    interval: Any,
    transcript_extractor: Any,
    notes: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
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
        "notes": notes or [],
    }


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
    """Extract JSON-serializable data for frontend plotting (one VariantOutput).

    `skipped` seeds the diagnostics list with skips already known to the
    caller (e.g. tracks unavailable for the organism); this function appends
    to it for every requested track that ends up with no plottable data.
    """
    skipped = list(skipped) if skipped else []
    tracks_payload = _collect_track_entries(
        outputs, selected_tracks, track_map, interval_length, interval, skipped
    )
    return _finalize_track_payload(
        tracks_payload, skipped, variant, interval, transcript_extractor
    )


def predict_and_build_track_payload(
    model: Any,
    organism: Any,
    variant_str: str,
    sequence_length: int,
    ontology_terms: list[str],
    selected_tracks: list[str],
    track_map: dict[str, tuple[Any, str]],
    transcript_extractor: Any,
    model_version: str = DEFAULT_MODEL_VERSION,
    imputation_policy: str | None = None,
    condition_labels: dict[str, str] | None = None,
) -> dict[str, Any]:
    spec = get_model_spec(model_version)
    if not ontology_terms:
        raise InvalidRequestError(
            "Select at least one condition." if spec.uses_conditions
            else "Select at least one ontology term."
        )
    if not selected_tracks:
        raise InvalidRequestError("Select at least one track.")

    # A track selected under a different organism/model (e.g. stale frontend
    # state after switching) won't exist in this track_map. Drop those upfront
    # rather than letting the KeyError below surface as an opaque failure once
    # every requested track is invalid.
    excluded = set(spec.excluded_visualization_tracks)
    skipped: list[dict[str, str]] = []
    available_tracks: list[str] = []
    for track_name in selected_tracks:
        if track_name in track_map and track_name not in excluded:
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
    requested_outputs = [track_map[track][0] for track in available_tracks]

    if spec.uses_conditions:
        # AG2: one reference condition per call; contact maps are condition-
        # specific too, so no separate cell-line request is needed.
        conditions = validate_conditions(ontology_terms)
        policy = validate_imputation_policy(imputation_policy)
        labels = condition_labels or {}
        notes: list[dict[str, str]] = []
        tracks_payload: list[dict[str, Any]] = []
        for condition in conditions:
            try:
                outputs = model.predict_variant(
                    interval=interval,
                    variant=variant_obj,
                    organism=organism,
                    requested_outputs=requested_outputs,
                    condition=condition,
                )
            except Exception as exc:
                raise UpstreamServiceError(
                    f"Could not generate track predictions for {condition}."
                ) from exc
            tracks_payload.extend(
                _collect_track_entries(
                    outputs,
                    available_tracks,
                    track_map,
                    sequence_length,
                    interval,
                    skipped,
                    condition=condition,
                    condition_label=labels.get(condition),
                    imputation_policy=policy,
                    notes=notes,
                )
            )
        tracks_payload = _cap_total_tracks(tracks_payload, notes)
        return _finalize_track_payload(
            tracks_payload, skipped, variant_obj, interval, transcript_extractor, notes
        )

    # AG1: contact maps are requested separately so the correct cell-line-scoped
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
