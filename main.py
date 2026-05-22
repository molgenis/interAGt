"""
Streamlit AlphaGenome API app
Accessing AG models without programming

Author: T.Niemeijer
Date: 18-05-2026
"""

import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import numpy as np

import streamlit as st

from alphagenome.data import genome
from alphagenome.models import dna_client, variant_scorers


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
    chrom, pos, ref, alt = variant.split(":")
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


def generate_plotly_figure(outputs, variant, selected_tracks, track_map, interval_length):
    """
    Generate a Plotly figure for AlphaGenome tracks with:
    - One subplot per (track, tissue, strand) for continuous tracks.
    - ONE subplot per SPLICE_JUNCTIONS track (all junctions on the SAME plot).
    - Variant position marked in all subplots.
    - Sashimi plots with Bezier curves.
    - Full track metadata in subplot titles.
    """
    subplot_specs = []

    for track_name in selected_tracks:
        track_info = track_map.get(track_name)
        if not track_info:
            continue
        attr = track_info[1]
        ref_data = getattr(outputs.reference, attr, None)
        alt_data = getattr(outputs.alternate, attr, None)
        if ref_data is None or alt_data is None:
            continue

        # For continuous tracks (RNA_SEQ, ATAC, etc.)
        if track_name not in ["SPLICE_JUNCTIONS", "SPLICE_SITES", "SPLICE_SITE_USAGE"]:
            for i in range(ref_data.values.shape[1]):
                metadata = ref_data.metadata.iloc[i]
                subplot_specs.append({
                    "track_name": track_name,
                    "ref_data": ref_data,
                    "alt_data": alt_data,
                    "track_idx": i,
                    "metadata": metadata,
                    "type": "continuous"
                })
        # For splice junctions: ONE subplot for all junctions in this track
        elif track_name == "SPLICE_JUNCTIONS":
            #check if there are junctions.
            ref_junctions = getattr(ref_data, 'junctions', [])
            alt_junctions = getattr(alt_data, 'junctions', [])
            if ref_junctions.shape[0] < 1 and alt_junctions.shape[0] < 1:
                continue
            for i in range(ref_data.values.shape[1]):
                metadata = ref_data.metadata.iloc[i]
                subplot_specs.append({
                    "track_name": track_name,
                    "ref_data": ref_data,
                    "alt_data": alt_data,
                    "metadata": metadata,
                    "type": "sashimi"
                })
        else:
            continue
                
    if not subplot_specs:
        raise ValueError("No valid tracks to plot.")
    
    # Create subplots
    n_subplots = len(subplot_specs)
    fig = make_subplots(
        rows=n_subplots,
        cols=1,
        shared_xaxes=True,
        vertical_spacing=max(0.2 - (0.015 * n_subplots), 0.01),  # Looser spacing
        subplot_titles=[
            f"{spec['track_name']} | {spec['metadata']['name'] if spec['metadata'] is not None else ''} | "
            f"{spec['metadata']['biosample_name'] if spec['metadata'] is not None and "biosample_name" in spec['metadata'] else ''} |"
            f"{' strand: ' + spec['metadata']['strand'] if spec['metadata'] is not None and "strand" in spec['metadata'] else ''}"
            for spec in subplot_specs
        ]
        
    )
    
    # Plot each track
    for idx, spec in enumerate(subplot_specs):
        if spec["type"] == "continuous":
            # Continuous tracks (RNA_SEQ, ATAC, etc.)
            x = np.arange(interval_length) + spec["ref_data"].interval.start
            y_ref = spec["ref_data"].values[:, spec["track_idx"]].copy()
            y_alt = spec["alt_data"].values[:, spec["track_idx"]].copy()

            if y_ref.shape[0] < interval_length:

                y_ref = np.interp(
                        np.linspace(0, y_ref.shape[0]-1, interval_length),
                        np.arange(y_ref.shape[0]),
                        y_ref )
                
                y_alt = np.interp(
                        np.linspace(0, y_alt.shape[0]-1, interval_length),
                        np.arange(y_alt.shape[0]),
                        y_alt )

            # Add REF and ALT traces
            fig.add_trace(
                go.Scatter(
                    x=x, y=y_ref,
                    mode='lines',
                    name='REF',
                    line=dict(color='#999', width=1.5),
                    showlegend=(idx == 0),
                    hovertemplate='Position: %{x}<br>Value: %{y:.2f}<extra></extra>'
                ),
                row=idx+1, col=1
            )
            fig.add_trace(
                go.Scatter(
                    x=x, y=y_alt,
                    mode='lines',
                    name='ALT',
                    line=dict(color='#FF0C57', width=1.5),
                    showlegend=(idx == 0),
                    hovertemplate='Position: %{x}<br>Value: %{y:.2f}<extra></extra>'
                ),
                row=idx+1, col=1
            )


        elif spec["type"] == "sashimi":
            # Sashimi plot for splice junctions (ALL junctions on the SAME subplot)
            # Extract junctions from ref_data and alt_data
            ref_junctions = getattr(spec["ref_data"], 'junctions', [])
            alt_junctions = getattr(spec["alt_data"], 'junctions', [])
            ref_counts = list(getattr(spec["ref_data"], 'values', []))
            alt_counts = list(getattr(spec["alt_data"], 'values', []))
                
            max_junction_height = 0

            # Plot REF junctions (strand "+" above x-axis, "-" below)
            for interval, count in zip(ref_junctions, ref_counts):
                if not hasattr(interval, 'start') or not hasattr(interval, 'end'):
                    continue
                donor = interval.start
                acceptor = interval.end
                strand = getattr(interval, 'strand', '+')
                count = count[0]  # Use the float value directly
                if count < 0.005:
                    continue
                sign = 1 if strand == "+" else -1
                height = np.log(count + 1) * 40  # Works with floats
                mid = (acceptor + donor) / 2
                text_height = height + 2

                # Bezier curve (your style)
                bezier_x = np.linspace(donor, acceptor, 99)
                bezier_y = (height * 4 * (bezier_x - donor) * (acceptor - bezier_x) / ((acceptor - donor) ** 2))
                steeper = 1 - ((bezier_x - mid) * (mid - bezier_x) / (acceptor - donor) ** 2) * 4
                bezier_y = bezier_y * steeper

                # Use float for line width (Plotly accepts floats)
                fig.add_trace(
                    go.Scatter(
                        x=bezier_x,
                        y=sign * bezier_y,
                        mode='lines',
                        line=dict(color='#333', width=max(1, float(np.log(count + 1)))),  # Float width
                        showlegend=False,
                        hovertemplate=f'pos: {donor}-{acceptor}, count: {count:.2f}<extra></extra>',  # Show 2 decimal places
                        name=""
                    ),
                    row=idx+1, col=1
                )
                # Show float count in annotation (e.g., "12.5")
                fig.add_annotation(
                    x=mid, y=sign * text_height,
                    showarrow=False,
                    text=f"{count:.1f}",  # 1 decimal place
                    font=dict(color='#333', size=12),
                    bgcolor="white",
                    row=idx+1, col=1
                )
                max_junction_height = max(max_junction_height, height)

            # Plot ALT junctions (offset below REF)
            for interval, count in zip(alt_junctions, alt_counts):
                if not hasattr(interval, 'start') or not hasattr(interval, 'end'):
                    continue
                donor = interval.start
                acceptor = interval.end
                strand = getattr(interval, 'strand', '+')
                count = count[0]  # Use the float value directly
                if count < 0.005:
                    continue
                sign = 1 if strand == "+" else -1
                height = np.log(count + 1) * 40
                mid = (acceptor + donor) / 2
                text_height = height + 2

                # Bezier curve
                bezier_x = np.linspace(donor, acceptor, 99)
                bezier_y = (height * 4 * (bezier_x - donor) * (acceptor - bezier_x) / ((acceptor - donor) ** 2))
                steeper = 1 - ((bezier_x - mid) * (mid - bezier_x) / (acceptor - donor) ** 2) * 4
                bezier_y = bezier_y * steeper

                fig.add_trace(
                    go.Scatter(
                        x=bezier_x,
                        y=sign * bezier_y - (max_junction_height + 10),
                        mode='lines',
                        line=dict(color='#FF0C57', width=max(1, float(np.log(count + 1)))),  # Float width
                        showlegend=False,
                        hovertemplate=f'pos: {donor}-{acceptor}, count: {count:.2f}<extra></extra>',  # Show 2 decimal places
                        name=""
                    ),
                    row=idx+1, col=1
                )
                fig.add_annotation(
                    x=mid, y=sign * text_height - (max_junction_height + 10),
                    showarrow=False,
                    text=f"{count:.1f}",  # 1 decimal place
                    font=dict(color='#333', size=12),
                    bgcolor="white",
                    row=idx+1, col=1
                )
    # Update layout
    fig.update_layout(
        height=500 + (120 * n_subplots),
        width=1000,
        hovermode='x unified',
        plot_bgcolor='white',
        paper_bgcolor='white',
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.02,
            xanchor="right",
            x=1
        )
    )
    

    # Add variant position line to all subplots
    variant_pos = variant.position

    for i in range(n_subplots):
        fig.add_vline(
            x=variant_pos,
            line_dash="dash",
            line_color="black",
            line_width=1,
            annotation_text=f"Variant: {variant}",
            row=i+1,
            col=1
        )

    fig.update_xaxes(title_text="Genomic Position")
    fig.update_yaxes(title_text="Signal")
    fig.update_yaxes(fixedrange=True)

    return fig

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

### CONFIG
st.set_page_config(page_title="AlphaGenome streamlit app", layout="wide")
st.markdown("<p style='text-align: center; color: #555; font-size:40px;'>AlphaGenome variant interpreter</p>", unsafe_allow_html=True)
st.info("""

    This app provides an intuitive interface to **AlphaGenome** (Avsec et al., 2026), Google DeepMind's **unified deep learning model** for interpreting the functional impact of genetic variants on **gene regulation**. AlphaGenome analyzes DNA sequences up to **1 million base pairs** at single-base resolution, predicting **11 types of genomic tracks**—including gene expression (RNA-seq), chromatin accessibility (ATAC, DNase), transcription factor binding (ChIP-TF), histone modifications (ChIP-Histone), and splicing events—across thousands of **tissue- and cell-type-specific** contexts.
    
    *Žiga Avsec, Natasha Latysheva, Jun Cheng, *et al.* **Advancing regulatory variant effect prediction with AlphaGenome.** *Nature*, 649(8099):1206-1218, 2026. [DOI:10.1038/s41586-025-10014-0](https://doi.org/10.1038/s41586-025-10014-0).*
    ##### **Note**
    This app uses the **free, non-commercial AlphaGenome API**. An API key is required and can be obtained [here](https://deepmind.google.com/science/alphagenome/account/terms).
    For more details, see the [AlphaGenome Documentation](https://www.alphagenomedocs.com).
    """)

track_explanations = {
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

### VARIANT INPUT

variant_str = st.text_input(
    "Variant GRCh38/hg38 (chr:pos:ref:alt)",
    value="chr5:1295228:G:A"
)

seq_length = st.select_slider("Sequence window (bp)", [16384, 131072, 524288, 1048576])


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
    
    #st.dataframe(st.session_state.var_df) <- shows dataframe

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

            fig = generate_plotly_figure(outputs, variant, selected_tracks, track_map, seq_length)
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