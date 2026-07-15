import re
import requests
from typing import Tuple, Optional
from urllib.parse import quote


CHROMOSOME_MAP = {
    **{str(i): f"chr{i}" for i in range(1, 23)},  # 1-22 → chr1-chr22
    'X': 'chrX', 'Y': 'chrY',
    'MT': 'chrM', 'M': 'chrM',
    '23': 'chrX', '24': 'chrY' 
}

VV_BASE = "https://rest.variantvalidator.org/VariantValidator"

def normalize_variant(variant_str: str, organism_label: str = "Human (hg38)") -> Tuple[Optional[str], Optional[str]]:
    """Normalize variant to chr:position:ref:alt format."""
    variant_str = variant_str.strip().replace(" ", "")

    # ========== 1. Already correct format ==========
    if re.match(r'^[a-zA-Z0-9]+:\d+:[ACGT]+:[ACGT]+$', variant_str):
        return _normalize_chromosome_in_variant(variant_str), None

    if organism_label == "Human (hg38)":
        # ========== 2. HGVS genomic ==========
        if m := re.match(r'^(NC_\d+\.\d+):g\.(\d+(?:_\d+)?)(?:([ACGT]+)>|del\s*ins)([ACGT]+)(?:;.*)?$', variant_str):
            return _convert_hgvs(variant_str)

        # ========== 3. HGVS cDNA/nRNA ==========
        if m := re.match(r'^(?:[A-Za-z0-9]+\()?([A-Z_]+\d+\.\d+)(?:\))?:[cnCN]\.(-?\d+[\+\-]?\d*(?:_-?\d+[\+\-]?\d*)?)(?:([ACGT]+)>|del\s*ins)([ACGT]+)$', variant_str):
            return _convert_hgvs(variant_str)

    return None, f"Unsupported format: {variant_str}"

def _convert_hgvs(hgvs: str, genome_build: str = "GRCh38") -> Tuple[Optional[str], Optional[str]]:
    """Convert HGVS to chr:pos:ref:alt using VariantValidator."""
    try:
        r = requests.get(f"{VV_BASE}/variantvalidator/{genome_build}/{quote(hgvs)}/select")
        r.raise_for_status()
        data = r.json()

        if "flag" in data:
            if data["flag"] == "warning":
                if "validation_warning_1" in data:
                    return None, data["validation_warning_1"]["validation_warnings"]

        if "primary_assembly_loci" in data[hgvs]:
            chrom = data[hgvs]["primary_assembly_loci"]["hg38"]["vcf"]["chr"]
            pos = data[hgvs]["primary_assembly_loci"]["hg38"]["vcf"]["pos"]
            ref = data[hgvs]["primary_assembly_loci"]["hg38"]["vcf"]["ref"]
            alt = data[hgvs]["primary_assembly_loci"]["hg38"]["vcf"]["alt"]
            return _normalize_chromosome_in_variant(':'.join([chrom,pos,ref,alt])), None
        
        return None, f"Unexpected response format for {hgvs}"
    
    except Exception as e:
        return None, f"VariantValidator error: {str(e)}"

def _normalize_chromosome(chr_name: str) -> str:
    """Convert '1' → 'chr1', 'MT' → 'chrM', etc."""
    return CHROMOSOME_MAP.get(chr_name, chr_name)

def _normalize_chromosome_in_variant(variant: str) -> str:
    """Normalize chromosome in a variant string (chr:pos:ref:alt)."""
    if m := re.match(r'^([a-zA-Z0-9]+):(\d+):([ACGT]+):([ACGT]+)$', variant):
        chr_name, pos, ref, alt = m.groups()
        return f"{_normalize_chromosome(chr_name)}:{pos}:{ref}:{alt}"
    return variant