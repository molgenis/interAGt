import re
import requests
from dataclasses import dataclass, field
from typing import Optional, Tuple
from urllib.parse import quote


CHROMOSOME_MAP = {
    **{str(i): f"chr{i}" for i in range(1, 23)},  # 1-22 → chr1-chr22
    'X': 'chrX', 'Y': 'chrY',
    'MT': 'chrM', 'M': 'chrM',
    '23': 'chrX', '24': 'chrY'
}

# Reverse map: RefSeq NC_ accession (version-stripped) → UCSC chromosome name.
# e.g. NC_000004 → chr4, NC_000023 → chrX, NC_012920 → chrM.
NC_ACCESSION_MAP = {
    **{f"NC_{i:06d}": f"chr{i}" for i in range(1, 23)},
    'NC_000023': 'chrX',
    'NC_000024': 'chrY',
    'NC_012920': 'chrM',
}

VV_BASE = "https://rest.variantvalidator.org/VariantValidator"

# Warning noise we never surface to users.
_NOISE_PREFIXES = ("Lovd",)

# NC_000004.12:g.102577469C>T  →  (NC_000004, 102577469, C, T)
_GENOMIC_RE = re.compile(r'(NC_\d+)\.\d+:g\.(\d+)([ACGTN]+)>([ACGTN]+)')
# "... does not agree with reference sequence (G)"  →  G
_ACTUAL_REF_RE = re.compile(r'reference sequence \(([ACGTN]+)\)')
# "Position c.375+1 does not correspond with an exon boundary ..."
_EXON_BOUNDARY_RE = re.compile(
    r'Position (c\.-?\d+)([+-]\d+)? does not correspond with an exon boundary'
)


@dataclass
class VariantResolution:
    """Structured outcome of resolving a variant to chr:pos:ref:alt."""
    normalized: Optional[str] = None
    error: Optional[str] = None
    warnings: list[str] = field(default_factory=list)
    needs_confirmation: bool = False
    message: Optional[str] = None
    mapped_position: Optional[str] = None  # e.g. "chr4:102577469"
    given_ref: Optional[str] = None        # ref base as submitted
    actual_ref: Optional[str] = None        # ref base actually in the genome


def resolve_variant(
    variant_str: str, organism_label: str = "Human (hg38)"
) -> VariantResolution:
    """Resolve a variant to chr:pos:ref:alt, returning structured detail."""
    variant_str = variant_str.strip().replace(" ", "")

    # ========== 1. Already correct format ==========
    if re.match(r'^[a-zA-Z0-9]+:\d+:[ACGT]+:[ACGT]+$', variant_str):
        return VariantResolution(
            normalized=_normalize_chromosome_in_variant(variant_str)
        )

    if organism_label == "Human (hg38)":
        # ========== 2. HGVS genomic ==========
        if re.match(r'^(NC_\d+\.\d+):g\.(\d+(?:_\d+)?)(?:([ACGT]+)>|del\s*ins)([ACGT]+)(?:;.*)?$', variant_str):
            return _convert_hgvs(variant_str)

        # ========== 3. HGVS cDNA/nRNA ==========
        if re.match(r'^(?:[A-Za-z0-9]+\()?([A-Z_]+\d+\.\d+)(?:\))?:[cnCN]\.(-?\d+[\+\-]?\d*(?:_-?\d+[\+\-]?\d*)?)(?:([ACGT]+)>|del\s*ins)([ACGT]+)$', variant_str):
            return _convert_hgvs(variant_str)
        
        if re.match(r'^rs\d+$', variant_str):
               return _convert_rsid(variant_str)

    return VariantResolution(error=f"Unsupported format: {variant_str}")


def normalize_variant(
    variant_str: str, organism_label: str = "Human (hg38)"
) -> Tuple[Optional[str], Optional[str]]:
    """Legacy 2-tuple API (normalized, error) used by main.py."""
    result = resolve_variant(variant_str, organism_label)
    if result.error:
        return None, result.error
    return result.normalized, None


def _convert_hgvs(hgvs: str, genome_build: str = "GRCh38") -> VariantResolution:
    """Convert HGVS to chr:pos:ref:alt using VariantValidator."""
    try:
        r = requests.get(
            f"{VV_BASE}/variantvalidator/{genome_build}/{quote(hgvs)}/select",
            timeout=60,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        return VariantResolution(error=f"VariantValidator error: {str(e)}")

    warnings = _collect_warnings(data)

    # Precedence 1: any usable hg38 mapping wins, even alongside warnings.
    vcf = _find_hg38_mapping(data)
    if vcf:
        normalized = _normalize_chromosome_in_variant(
            ':'.join([vcf["chr"], vcf["pos"], vcf["ref"], vcf["alt"]])
        )
        return VariantResolution(
            normalized=normalized,
            warnings=_meaningful_warnings(warnings),
        )

    # Precedence 2: no mapping, but a warning carries a mapped position with a
    # reference-base mismatch → ask the user to confirm.
    confirmation = _extract_confirmation(warnings)
    if confirmation:
        return confirmation

    # Precedence 3: hard error, translated to a readable sentence.
    return VariantResolution(error=_translate_warnings(warnings, hgvs))


def _convert_rsid(rsid: str, species: str = "homo_sapiens" ) -> VariantResolution:
    """Lookup rsID via Ensembl REST API, handling multi-allelic variants."""
    server = "https://rest.ensembl.org"
    try:
        r = requests.get(f"{server}/variation/{species}/{rsid}?",
                         headers={"Content-Type": "application/json"})
        r.raise_for_status()
        data = r.json()

        if not (mappings := data.get('mappings')):
            return VariantResolution(error=f"Could not resolve {rsid}")

        # Process all mappings (for different genome builds)
        results = []
        for m in mappings:
            chr_name = _normalize_chromosome(m['seq_region_name'])
            pos = m['start']
            allelestr = m.get('allele_string', '')

            # Handle multi-allelic: G/A/C → [G, A, C]
            alleles = allelestr.split('/') if '/' in allelestr else [allelestr]

            if not alleles:
                continue

            # Reference is first allele, each subsequent is an alternate
            ref = alleles[0]
            if chr_name.startswith("chr"):
                for alt in alleles[1:]:
                    results.append(f"{chr_name}:{pos}:{ref}:{alt}")

        if not results:
            return VariantResolution(error=f"VariantValidator error: No valid variants found for {rsid}") 

        # Return first result (or could return all as comma-separated)
        return VariantResolution(normalized=','.join(results))

    except Exception as e:
        return VariantResolution(error=f"Ensembl API error: {str(e)}")

def _iter_records(data: dict):
    """Yield the per-variant record values from a VV response."""
    for key, value in data.items():
        if key in ("flag", "metadata"):
            continue
        yield value


def _collect_warnings(data: dict) -> list[str]:
    """Gather all validation-warning strings across VV response shapes."""
    warnings: list[str] = []
    for value in _iter_records(data):
        if isinstance(value, dict):
            nested = value.get("validation_warnings")
            if isinstance(nested, list):
                warnings.extend(str(w) for w in nested)
        elif isinstance(value, list):
            # Some responses put the warnings list directly under the key.
            warnings.extend(str(w) for w in value)
    return warnings


def _meaningful_warnings(warnings: list[str]) -> list[str]:
    return [w for w in warnings if not w.startswith(_NOISE_PREFIXES)]


def _find_hg38_mapping(data: dict) -> Optional[dict]:
    """Return the first populated primary_assembly_loci hg38 vcf, if any."""
    for value in _iter_records(data):
        if not isinstance(value, dict):
            continue
        loci = value.get("primary_assembly_loci") or {}
        vcf = (loci.get("hg38") or {}).get("vcf") or {}
        if all(vcf.get(k) for k in ("chr", "pos", "ref", "alt")):
            return vcf
    return None


def _extract_confirmation(warnings: list[str]) -> Optional[VariantResolution]:
    """Build a needs_confirmation result from a mapped-position ref mismatch."""
    for w in warnings:
        genomic = _GENOMIC_RE.search(w)
        actual = _ACTUAL_REF_RE.search(w)
        if not (genomic and actual):
            continue
        nc, pos, given_ref, alt = genomic.groups()
        actual_ref = actual.group(1)
        chrom = NC_ACCESSION_MAP.get(nc, nc)
        mapped_position = f"{chrom}:{pos}"
        message = (
            f"{mapped_position} has reference base {actual_ref} in the genome, "
            f"but your variant specifies {given_ref}. Proceeding will use your "
            f"input ({given_ref}>{alt})."
        )
        return VariantResolution(
            normalized=f"{chrom}:{pos}:{given_ref}:{alt}",
            needs_confirmation=True,
            message=message,
            mapped_position=mapped_position,
            given_ref=given_ref,
            actual_ref=actual_ref,
        )
    return None


def _translate_warnings(warnings: list[str], hgvs: str) -> str:
    """Turn VV/LOVD warnings into a single readable error sentence."""
    for w in _meaningful_warnings(warnings):
        translated = _translate_one_warning(w)
        if translated:
            return translated
    meaningful = _meaningful_warnings(warnings)
    if meaningful:
        return meaningful[0]
    return f"Could not validate variant: {hgvs}"


def _translate_one_warning(warning: str) -> Optional[str]:
    boundary = _EXON_BOUNDARY_RE.search(warning)
    if boundary:
        base, offset = boundary.group(1), boundary.group(2)
        if offset:
            return (
                f"{base} is not an exon boundary in this transcript, so the "
                f"{offset} intronic offset is invalid."
            )
        return f"{base} is not an exon boundary in this transcript."

    # Otherwise strip a leading "SomethingError:/Warning:" label for readability.
    labelled = re.match(r'^[A-Za-z]+(?:Error|Warning):\s*(.*)$', warning)
    if labelled:
        return labelled.group(1).strip()
    return warning


def _normalize_chromosome(chr_name: str) -> str:
    """Convert '1' → 'chr1', 'MT' → 'chrM', etc."""
    return CHROMOSOME_MAP.get(chr_name, chr_name)

def _normalize_chromosome_in_variant(variant: str) -> str:
    """Normalize chromosome in a variant string (chr:pos:ref:alt)."""
    if m := re.match(r'^([a-zA-Z0-9]+):(\d+):([ACGT]+):([ACGT]+)$', variant):
        chr_name, pos, ref, alt = m.groups()
        return f"{_normalize_chromosome(chr_name)}:{pos}:{ref}:{alt}"
    return variant