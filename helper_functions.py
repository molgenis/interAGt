import re
import requests
from typing import Tuple, Optional, Dict

BUILD_ALIASES: Dict[str, str] = {
    'hg19': 'GRCh37', 'grch37': 'GRCh37',
    'hg38': 'GRCh38', 'grch38': 'GRCh38',
    'mm10': 'GRCm38', 'grcm38': 'GRCm38'
}

ORGANISM_DEFAULT: Dict[str, str] = {
    'human': 'GRCh38', 'mouse': 'GRCm38', 'mouse (mm10)': 'GRCm38'
}
SPECIES_MAP: Dict[str, str] = {
    'human': 'homo_sapiens', 'mouse': 'mus_musculus'
}

SPECIES_MAP_MART: Dict[str, str] = {
    'human': 'hsapiens_gene_ensembl',
    'mouse': 'mmusculus_gene_ensembl'
}

REFSEQ_TYPE_MAP: Dict[str, str] = {
    'NM': 'refseq_mrna',
    'NR': 'refseq_ncrna',
    'XM': 'refseq_mrna',
    'XR': 'refseq_ncrna'
}

CHROMOSOME_MAP = {
    **{str(i): f"chr{i}" for i in range(1, 23)},  # 1-22 → chr1-chr22
    'X': 'chrX', 'Y': 'chrY',
    'MT': 'chrM', 'M': 'chrM',
    '23': 'chrX', '24': 'chrY' 
}




def normalize_variant(variant_str: str, organism_label: str = "Human") -> Tuple[Optional[str], Optional[str]]:
    """Normalize variant to chr:position:ref:alt format."""
    variant_str = variant_str.strip().replace(" ", "")

    target_assembly = ORGANISM_DEFAULT.get(organism_label.lower(), "GRCh38")
    species = SPECIES_MAP.get(
        "mouse" if "mouse" in organism_label.lower() else "human",
        "homo_sapiens"
    )

    # ========== 1. Already correct format ==========
    if re.match(r'^[a-zA-Z0-9]+:\d+:[ACGT]+:[ACGT]+$', variant_str):
        return _ensure_assembly(variant_str, target_assembly, species)

    # ========== 2. HGVS genomic ==========
    if m := re.match(r'^(NC_\d+\.\d+):g\.(\d+)([ACGT]+)>([ACGT]+)(?:;.*)?$', variant_str):
        nc_acc, pos, ref, alt = m.groups()
        chr_map = {f'NC_0000{i:02d}': str(i) for i in range(1, 23)} | {
            'NC_000023': 'X', 'NC_000024': 'Y', 'NC_012920': 'MT'
        }
        chr_name = chr_map.get(nc_acc.split('.')[0], nc_acc.split('.')[0])
        return _ensure_assembly(f"{chr_name}:{pos}:{ref.upper()}:{alt.upper()}", target_assembly, species)

    # ========== 3. HGVS cDNA/nRNA ==========
    if m := re.match(r'^(?:[A-Za-z0-9]+\()?([A-Z_]+\d+\.\d+)(?:\))?:[cnCN]\.(-?\d+[\+\-]?\d*)([ACGT]+)>([ACGT]+)$', variant_str):
        transcript, cpos, ref, alt = m.groups()
        result, err = _map_transcript_with_offset(transcript, cpos, ref.upper(), alt.upper(), m.group(0), species)
        if err: return None, err
        return _ensure_assembly(result, target_assembly, species)

    # ========== 4. dbSNP ==========
    if m := re.match(r'^rs\d+$', variant_str):
        result, err = _lookup_rsid(m.group(), species)
        if err: return None, err
        return _ensure_assembly(result, target_assembly, species)

    return None, f"Unsupported format: {variant_str}"

def _get_ensembl_transcript(transcript_id: str, species: str) -> Tuple[Optional[str], Optional[str]]:
    """Convert RefSeq to Ensembl using BioMart."""
    # Already Ensembl - return as-is
    if transcript_id.startswith(('ENST', 'ENSMUST')):
        return transcript_id, None

    # Map species to BioMart dataset
    biomart_dataset = {
        'homo_sapiens': 'hsapiens_gene_ensembl',
        'mus_musculus': 'mmusculus_gene_ensembl'
    }.get(species)

    if not biomart_dataset:
        return None, f"Unsupported species for BioMart: {species}"

    # Determine RefSeq type (NM, NR, XM, XR)
    prefix = transcript_id.split('_')[0]
    refseq_type = REFSEQ_TYPE_MAP.get(prefix)
    if not refseq_type:
        return None, f"Unsupported RefSeq type: {prefix}"

    # Build BioMart XML query
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE Query>
        <Query virtualSchemaName="default" formatter = "TSV" header = "0" uniqueRows = "0" count = "" datasetConfigVersion = "0.6">
        <Dataset name="{biomart_dataset}" interface="default">
            <Filter name="{refseq_type}" value="{transcript_id.split('.')[0]}"/>
            <Attribute name="ensembl_transcript_id"/>
        </Dataset>
        </Query>"""

    try:
        r = requests.get(
            "https://www.ensembl.org/biomart/martservice",
            params={"query": xml},
            timeout=30
        )
        r.raise_for_status()
    
        # Parse response (single column, no header)
        ensembl_id = r.text.strip()

        if ensembl_id and ensembl_id.startswith(('ENST', 'ENSMUST')):
            return ensembl_id, None

        return None, f"No Ensembl transcript found for {transcript_id}"

    except Exception as e:
        return None, f"BioMart error: {str(e)}"

def _parse_cdna_position(cdna_pos: str) -> Tuple[int, int]:
    """Parse cDNA position into (base_position, offset)."""
    if cdna_pos.startswith('-'):
        return 1, int(cdna_pos)
    if '+' in cdna_pos:
        base, offset = cdna_pos.split('+')
        return int(base), int(offset)
    if '-' in cdna_pos:
        base, offset = cdna_pos.split('-')
        return int(base), -int(offset)
    return int(cdna_pos), 0

def _map_transcript_with_offset(transcript: str, cpos: str, ref: str, alt: str,
                               full_match: str, species: str) -> Tuple[Optional[str], Optional[str]]:
    """Map transcript coordinates to genomic, handling RefSeq→Ensembl conversion."""
    server = "https://rest.ensembl.org"

    # Convert RefSeq to Ensembl
    if transcript.startswith(('NM_', 'NR_', 'XM_', 'XR_')):
        ensembl_t, err = _get_ensembl_transcript(transcript, species)
        if err: return None, err
        transcript = ensembl_t

    base_pos, offset = _parse_cdna_position(cpos)

    try:
        # Map base position to genomic
        r = requests.get(f"{server}/map/cdna/{transcript.split('.')[0]}/{base_pos}..{base_pos + 1}?",
                         headers={"Content-Type": "application/json"})
        r.raise_for_status()
        mappings = r.json()
        if not mappings:
            return None, f"No mapping for {transcript}:c.{base_pos}"

        mapping = mappings.get('mappings')[0]
        chr_name = _normalize_chromosome(mapping.get('seq_region_name'))
        base_genomic_pos = mapping.get('start')
        strand = mapping.get('strand')

        # Apply offset
        genomic_pos = base_genomic_pos + offset if strand == 1 else base_genomic_pos - offset

        # Get reference allele
        r = requests.get(f"{server}/sequence/region/{species}/{chr_name}:{genomic_pos}-{genomic_pos}?",
                         headers={"Content-Type": "application/json"})
        r.raise_for_status()
       
        genome_ref = r.json().get('seq', '').upper()

        # Handle strand for alleles
        if strand == -1:
            comp = {'A':'T','T':'A','C':'G','G':'C'}
            ref_rc = ''.join(comp.get(b,b) for b in reversed(ref))
            alt_rc = ''.join(comp.get(b,b) for b in reversed(alt))
            if ref_rc == genome_ref:
                ref, alt = ref_rc, alt_rc
            elif ref != genome_ref:
                return None, f"Reference mismatch at {chr_name}:{genomic_pos}"

        return f"{chr_name}:{genomic_pos}:{ref}:{alt}", None

    except Exception as e:
        return None, f"API error: {str(e)}"

def _lookup_rsid(rsid: str, species: str) -> Tuple[Optional[str], Optional[str]]:
    """Lookup rsID via Ensembl REST API, handling multi-allelic variants."""
    server = "https://rest.ensembl.org"
    try:
        r = requests.get(f"{server}/variation/{species}/{rsid}?",
                         headers={"Content-Type": "application/json"})
        r.raise_for_status()
        data = r.json()

        if not (mappings := data.get('mappings')):
            return None, f"Could not resolve {rsid}"

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
            return None, f"No valid variants found for {rsid}"

        # Return first result (or could return all as comma-separated)
        return ','.join(results), None

    except Exception as e:
        return None, f"API error: {str(e)}"

def _ensure_assembly(variant: str, target: str, species: str) -> Tuple[Optional[str], Optional[str]]:
    """Convert to target assembly if needed."""
    if m := re.match(r'^([a-zA-Z0-9]+):(\d+):([ACGT]+):([ACGT]+)$', variant):
        chr, pos, ref, alt = m.groups()
        if target == "GRCh38" and species == "homo_sapiens":
            converted, err = _convert_coords(chr, int(pos), ref, alt, "GRCh37", "GRCh38", species)
            if err: return variant, None
            return converted, None
        if target == "GRCm38" and species == "mus_musculus":
            return variant, None
    return variant, None

def _convert_coords(chr: str, pos: int, ref: str, alt: str,
                    from_assm: str, to_assm: str, species: str) -> Tuple[Optional[str], Optional[str]]:
    """Convert coordinates between assemblies."""
    server = "https://rest.ensembl.org"
    try:
        r = requests.get(f"{server}/map/{from_assm}/{chr}/{pos}..{pos}?to={to_assm}",
                         headers={"Content-Type": "application/json"})
        r.raise_for_status()
        mappings = r.json()
        if not mappings: return None, f"No mapping {from_assm}→{to_assm} for {chr}:{pos}"
        m = mappings[0]
        new_chr, new_pos = m['seq_region_name'], m['start']
        new_strand = m.get('strand', 1)
        if new_strand == -1:
            comp = {'A':'T','T':'A','C':'G','G':'C'}
            ref = ''.join(comp.get(b,b) for b in reversed(ref))
            alt = ''.join(comp.get(b,b) for b in reversed(alt))
        return f"{new_chr}:{new_pos}:{ref}:{alt}", None
    except Exception as e:
        return None, f"Conversion error: {str(e)}"
    
def _normalize_chromosome(chr_name: str) -> str:
    """Convert '1' → 'chr1', 'MT' → 'chrM', etc."""
    return CHROMOSOME_MAP.get(chr_name, chr_name)