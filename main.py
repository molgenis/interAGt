"""
Streamlit AlphaGenome API app
Accessing AG models without programming

Author: T.Niemeijer
Date: 18-05-2026
"""

import requests

import plotly.express as px

import streamlit as st
import pandas as pd

from alphagenome.data import genome, gene_annotation, transcript
from alphagenome.models import dna_client, variant_scorers

from plot_functions import generate_plotly_figure

### FUNCTIONS

### LOAD ONTOLOGY METADATA
@st.cache_data
def load_ontology_terms(_model, organism):
    metadata = _model.output_metadata(organism=organism).concatenate()

    if hasattr(metadata, "ontology_curie"):
        df = metadata[["ontology_curie", "biosample_name"]].dropna().drop_duplicates()
    else:
        return {}, []

    # Create mapping
    curie_to_label = dict(zip(df["ontology_curie"], df["biosample_name"]))

    # Create display strings
    display_options = [
        f"{label} ({curie})"
        for curie, label in curie_to_label.items()
    ]

    display_options = sorted(display_options)

    return curie_to_label, display_options

def parse_variant_interval(variant, seq_length):
    chrom, pos, ref, alt = variant.strip().split(":")
    pos = int(pos)

    interval = genome.Interval(
        chromosome=chrom,
        start=pos - seq_length // 2,
        end=pos + seq_length // 2,
    )

    variant_obj = genome.Variant(
        chromosome=chrom,
        position=pos,
        reference_bases=ref,
        alternate_bases=alt,
    )

    return interval, variant_obj


@st.cache_data
def load_tracks(_model, organism):
    metadata = _model.output_metadata(organism=organism).concatenate()

    if not hasattr(metadata, "output_type"):
        return {}

    output_types = metadata.output_type.unique().tolist()

    track_map = {}
    for ot in output_types:
        clean_name = str(ot).split(".")[-1]   # RNA_SEQ
        attr_name = clean_name.lower()        # rna_seq

        track_map[clean_name] = (ot, attr_name)

    return track_map



def search_hpo(query):
    url = "https://www.ebi.ac.uk/ols4/api/search"
    params = {
        "q": query,
        "ontology": "hp"
    }

    r = requests.get(url, params=params)
    r.raise_for_status()

    docs = r.json()["response"]["docs"]

    return [
        f"{d['obo_id']} - {d['label']}"
        for d in docs[:20]
        if "obo_id" in d
    ]

import requests
import streamlit as st

@st.cache_data
def get_hpo_mapping(hp_id):
    """
    Retrieve UBERON / CL / EFO mappings from OLS.
    """

    url = (
        "https://www.ebi.ac.uk/ols4/api/search"
    )

    params = {
        "q": hp_id,
        "ontology": "hp",
        "exact": "true"
    }

    r = requests.get(url, params=params)
    r.raise_for_status()

    docs = r.json()["response"]["docs"]

    if not docs:
        return {
            "uberon": [],
            "cl": [],
            "efo": []
        }

    doc = docs[0]

    mappings = {
        "uberon": [],
        "cl": [],
        "efo": []
    }

    # xrefs usually live here
    for xref in doc.get("obo_xref", []):

        if xref.startswith("UBERON:"):
            mappings["uberon"].append(xref)

        elif xref.startswith("CL:"):
            mappings["cl"].append(xref)

        elif xref.startswith("EFO:"):
            mappings["efo"].append(xref)

    return mappings


### CONFIG
st.set_page_config(page_title="AlphaGenome streamlit app", layout="wide")
st.markdown("<p style='text-align: center; color: #333; font-size:40px;'>AlphaGenome variant interpreter</p>", unsafe_allow_html=True)
st.info("""

    This app provides an intuitive interface to **AlphaGenome** (Avsec et al., 2026), Google DeepMind's **unified deep learning model** for interpreting the functional impact of genetic variants on **gene regulation**. AlphaGenome analyzes DNA sequences up to **1 million base pairs** at single-base resolution, predicting **11 types of genomic tracks**—including gene expression (RNA-seq), chromatin accessibility (ATAC, DNase), transcription factor binding (ChIP-TF), histone modifications (ChIP-Histone), and splicing events—across thousands of **tissue- and cell-type-specific** contexts.
    
    *Žiga Avsec, Natasha Latysheva, Jun Cheng, *et al.* **Advancing regulatory variant effect prediction with AlphaGenome.** *Nature*, 649(8099):1206-1218, 2026. [DOI:10.1038/s41586-025-10014-0](https://doi.org/10.1038/s41586-025-10014-0).*
    ##### **Note**
    This app uses the **free, non-commercial AlphaGenome API**. An API key is required and can be obtained [here](https://deepmind.google.com/science/alphagenome/account/terms).
    For more details, see the [AlphaGenome Documentation](https://www.alphagenomedocs.com).
    """)

track_explanations = {
    'table':"Full table showing all selected results, raw scores and quantiles which are standardized, track-specific metric that maps a variant's raw predicted impact score to its percentile rank against a fixed background distribution of approximately 350,000 common human SNPs",
    'RNA_SEQ': "Measures gene expression levels. High scores indicate increased transcription; low scores indicate decreased transcription. Variants here may affect promoter activity, exon inclusion, or mRNA stability.",
    'CAGE': "Cap Analysis Gene Expression: Identifies transcription start sites (TSSs). High scores indicate active promoters. Variants may disrupt promoter motifs or create new TSSs.",
    'PROCAP': "Promoter Capture-C: Maps promoter interactions with other genomic regions (e.g., enhancers). High scores indicate strong promoter contacts. Variants may disrupt long-range regulatory loops.",
    'ATAC': "Assay for Transposase-Accessible Chromatin: Measures chromatin accessibility. High scores indicate open chromatin (active regulatory regions). Variants may close or open chromatin, affecting TF binding.",
    'DNASE': "DNase-seq: Measures chromatin accessibility via DNase I sensitivity. Similar to ATAC, high scores indicate active regulatory regions (promoters, enhancers). Variants may alter accessibility for transcription factors.",
    'CHIP_HISTONE': "Chromatin Immunoprecipitation for histone modifications (e.g., H3K27ac, H3K4me3). High scores indicate active enhancers/promoters (H3K27ac) or active transcription (H3K4me3). Variants may disrupt histone binding or recruitment of chromatin modifiers.",
    'CHIP_TF': "Chromatin Immunoprecipitation for transcription factors. High scores indicate TF binding sites. Variants may abolish or create TF binding motifs, directly affecting gene regulation.",
    'POLYADENYLATION': "Identifies polyadenylation sites (PAS), where mRNA transcription terminates. High scores indicate active PAS. Variants may cause alternative polyadenylation, affecting mRNA stability or localization.",
    'SPLICE_SITES': "Predicts splice donor/acceptor sites. High scores indicate strong splice sites. Variants may disrupt splicing, leading to exon skipping or cryptic splice site usage.",
    'SPLICE_SITE_USAGE': "Quantifies the usage of splice sites. High scores indicate frequent splicing at this site. Variants may reduce usage, causing aberrant splicing or intron retention.",
    'SPLICE_JUNCTIONS': "Measures splicing between exons. High scores indicate strong exon-exon junctions. Variants may disrupt junctions, leading to mis-splicing or novel isoforms."
}

### LOAD HPO

import json

with open("resources/hp.json") as f:
    hp = json.load(f)

### LOAD HPO OPTIONS
hp_options = []

for node in hp["graphs"][0]["nodes"]:

    if node.get("type") != "CLASS":
        continue

    hp_id = node["id"].split("/")[-1].replace("_", ":")

    label = node.get("lbl", hp_id)

    hp_options.append(
        f"{hp_id} - {label}"
    )

hp_options = sorted(hp_options)


### API KEY
api_key = st.text_input("Enter API Key", type="password")

@st.cache_resource
def load_model(api_key):
    return dna_client.create(api_key)

st.markdown("<p style='text-align: left; color: #555; font-size:30px;'>Model parameters</p>", unsafe_allow_html=True)
### ORGANISM SELECTION
organism_map = {
    "Human": dna_client.Organism.HOMO_SAPIENS,
    "Mouse": dna_client.Organism.MUS_MUSCULUS,
}

organism_label = st.selectbox("Select organism", list(organism_map.keys()))
organism = organism_map[organism_label]


tissue_terms = []
if api_key:
    try:
        model = load_model(api_key)
        tissue_terms = load_ontology_terms(model, organism)
    except Exception as e:
        st.warning(f"Could not load ontology terms: {e}")


### LOAD TRANSCRIPTS -- from AlphaGenome Docs 
@st.cache_data
def load_transcripts():
    gtf = pd.read_feather(
        'https://storage.googleapis.com/alphagenome/reference/gencode/'
        'hg38/gencode.v46.annotation.gtf.gz.feather'
    )

    gtf_transcript = gene_annotation.filter_transcript_support_level(
        gene_annotation.filter_protein_coding(gtf), ['1']
    )
    transcript_extractor = transcript.TranscriptExtractor(gtf_transcript)

    return transcript_extractor


transcript_extractor = load_transcripts()

### VARIANT INPUT
variant_str = st.text_input(
    "Variant GRCh38/hg38 (chr:pos:ref:alt)",
    value="chr5:1295113:G:A"
)

seq_length = st.select_slider("Sequence window (bp)", [16384, 131072, 524288, 1048576])

# phenotype selection
selected_hpos = st.multiselect(
    "Patient HPO terms",
    options=hp_options
)

### RUN

if "fig_tracks" not in st.session_state:
    st.session_state.fig_tracks = None


if "var_df" not in st.session_state:
    st.session_state.var_df = None

st.markdown("<p style='text-align: left; color: #555; font-size:30px;'>Variant scores</p>", unsafe_allow_html=True)

scorer_selection = st.multiselect("Select Variant scorers", [
                                'RNA_SEQ',
                                'CAGE',
                                'PROCAP',
                                'ATAC',
                                'DNASE',
                                'CHIP_HISTONE',
                                'CHIP_TF',
                                'Polyadenylation'],
                                default=['RNA_SEQ'])
scorer_selection = [scorer.lower() for scorer in scorer_selection]
all_scorers = variant_scorers.RECOMMENDED_VARIANT_SCORERS
selected_scorers = [ all_scorers[key] for key in all_scorers if key.lower() in scorer_selection]
if st.button("Get Variant scores"):
    if not api_key:
        st.error("Enter API key.")
    else:
        model = load_model(api_key)
        interval, variant = parse_variant_interval(variant_str, seq_length)
        variant_scores = model.score_variant(
                                    interval=interval,
                                    variant=variant,
                                    variant_scorers=selected_scorers,
                                    organism=organism,
                                )
        df_scores = variant_scorers.tidy_scores(variant_scores)

        if df_scores is not None:
            st.session_state.var_df = df_scores.sort_values("raw_score", key=abs, ascending=False)
        else:
            st.session_state.var_df = None
            st.error("No variant results")

if st.session_state.var_df is not None:

    if selected_hpos:
        selected_uberon = set()
        selected_cl = set()

        for item in selected_hpos:

            hp_id = item.split(" - ")[0]

            mappings = get_hpo_mapping(hp_id)

            selected_uberon.update(
                mappings["uberon"]
            )

            selected_cl.update(
                mappings["cl"]
            )

        selected_terms = (
            selected_uberon |
            selected_cl
        )
        print(mappings)

        df = st.session_state.var_df.copy()

        df["hpo_relevance"] = (
            df["ontology_curie"]
            .isin(selected_terms)
            .astype(int)
            )

        df = df.sort_values(
            ["hpo_relevance", "raw_score"],
            ascending=[False, False]
            )
        st.session_state.var_df = df
    
    with st.expander("Results table", expanded=True):
        st.info(f"#### Info: \n{track_explanations.get('table', 'No explanation available.')}")
        st.dataframe(st.session_state.var_df)

    # Get unique output types
    output_types = st.session_state.var_df['output_type'].unique()
    
    for output_type in track_explanations:

        if output_type not in output_types:
            continue
        # Filter data for this output type
        df_filtered = st.session_state.var_df[st.session_state.var_df['output_type'] == output_type]
        df_filtered = df_filtered.drop_duplicates(subset=["biosample_name", "gene_name", "gene_id"], keep='last')

        # Create a color column: red for positive, blue for negative
        df_filtered['color'] = df_filtered['raw_score'].apply(lambda x: 'red' if x < 0 else 'blue')

        # Sort by tissue and raw_score (ascending or descending)
        df_filtered = df_filtered.sort_values(
            by=['raw_score','gene_name', 'biosample_name'],  # Sort by gene, then tissue, then score
            ascending=[False,True,True]
        )
        expand_field = False
        # Plot
        if output_type == "RNA_SEQ":
            fig = px.bar(
                df_filtered,
                x='biosample_name',
                y='raw_score',
                color='color',
                facet_col='gene_name',
                facet_col_wrap=2,
                color_discrete_map={'red': '#FF0C57', 'blue': '#017FFD'},
                facet_col_spacing=max(0.2 - (0.015 * len(df_filtered['gene_name'].unique())), 0.02),
                facet_row_spacing=max(0.2 - (0.015 * len(df_filtered['gene_name'].unique())), 0.01),  # Looser spacing
                title=f"Variant Effect: {output_type}",
                height=600 + 100 * len(df_filtered['gene_name'].unique()),
                width=800
            )
            expand_field = True

        elif output_type == "CHIP_TF":
            fig = px.bar(
                df_filtered,
                x='biosample_name',
                y='raw_score',
                color='color',
                facet_col='transcription_factor',
                facet_col_wrap=4,
                color_discrete_map={'red': '#FF0C57', 'blue': '#017FFD'},
                title=f"Variant Effect: {output_type}",
                height=600 + 100 * len(df_filtered['transcription_factor'].unique()),
                width=800
            )
        else:
            fig = px.bar(
                df_filtered,
                x='biosample_name',
                y='raw_score',
                color='color',
                color_discrete_map={'red': '#FF0C57', 'blue': '#017FFD'},
                title=f"Variant Effect: {output_type}",
                height=600,
                width=800
            )
        # Ensure x-axis categories (tissues) are ordered by raw_score for each gene
        fig.update_layout(
            showlegend=False,
            xaxis_title="Tissue",
            margin=dict(l=50, r=50, b=50, t=50),
            # Force x-axis to respect the sorted order in the DataFrame
            xaxis={'categoryorder': 'array', 'categoryarray': df_filtered['biosample_name'].unique()}
        )
        with st.expander(f"{output_type}", expanded=expand_field):
            st.info(f"#### Info: \n{track_explanations.get(output_type, 'No explanation available.')}")
            st.plotly_chart(fig)

st.markdown("<p style='text-align: left; color: #555; font-size:30px;'>Visualize tracks</p>", unsafe_allow_html=True)

### TRACK SELECTION

#dark_mode = st.toggle("Dark mode plots", value=False)
#plt.style.use("dark_background" if dark_mode else "default")

### SEARCHABLE ONTOLOGY SELECTOR
if api_key:
    curie_to_label, display_options = load_ontology_terms(model, organism)

    selected_display = st.multiselect(
        "Search & select tissues (max. 10)",
        display_options,
        default=[],
        max_selections=10,
    )

    # Extract UBERON IDs from strings like "heart (UBERON:0001157)"
    selected_tissue = [
        item.split("(")[-1].replace(")", "")
        for item in selected_display
    ]

    st.caption(f"{len(tissue_terms)} tissue terms available")

track_map = {}
if api_key:
    try:
        track_map = load_tracks(model, organism)
    except Exception as e:
        st.warning(f"Could not load tracks: {e}")

    selected_tracks = st.multiselect(
        "Search & select tracks",
        list(track_map.keys() - ["SPLICE_SITES", "SPLICE_SITE_USAGE", "CONTACT_MAPS"]),
        default=["RNA_SEQ","CHIP_TF","ATAC"]  # pick a few defaults
    )


if st.button("Visualize"):
    if not api_key:
        st.error("Enter API key.")
    elif not selected_tissue:
        st.error("Select at least one ontology term.")
    else:
        try:
            model = load_model(api_key)
            interval, variant = parse_variant_interval(variant_str, seq_length)

            with st.spinner("Running model..."):
                outputs = model.predict_variant(
                    interval=interval,
                    variant=variant,
                    organism=organism,
                    ontology_terms=selected_tissue,
                    requested_outputs=[track_map[t][0] for t in selected_tracks],
                )

            fig = generate_plotly_figure(outputs, variant, selected_tracks, track_map, seq_length, interval, transcript_extractor)
            st.session_state.fig_tracks = fig

        except Exception as e:
            st.error(f"Error: {e}")

# Display the Plotly figure
if st.session_state.fig_tracks is not None:
    st.plotly_chart(st.session_state.fig_tracks, width="stretch", height="stretch")

    # Download as HTML
    html_str = st.session_state.fig_tracks.to_html(include_plotlyjs='cdn', full_html=True)
    st.download_button(
        label="Download Plot (HTML)",
        data=html_str,
        file_name=f"{variant_str.replace(':', '_')}_tracks.html",
        mime="text/html"
    )