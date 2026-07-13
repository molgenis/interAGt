import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import numpy as np

def assign_transcript_tracks(transcripts):
    transcript_ranges = []

    for tx in transcripts:
        start = min(e.start for e in tx.exons)
        end = max(e.end for e in tx.exons)
        transcript_ranges.append((start, end, tx))

    transcript_ranges.sort(key=lambda x: x[0])

    track_ends = []
    result = {}

    for start, end, tx in transcript_ranges:
        assigned = False

        for track_idx, last_end in enumerate(track_ends):
            if start > last_end:
                result[id(tx)] = track_idx
                track_ends[track_idx] = end
                assigned = True
                break

        if not assigned:
            track_idx = len(track_ends)
            track_ends.append(end)
            result[id(tx)] = track_idx

    return result

def generate_plotly_figure(outputs, variant, selected_tracks, track_map, interval_length, interval, transcript_extractor):
    """
    Generate a Plotly figure for AlphaGenome tracks with:
    - One subplot per (track, tissue, strand) for continuous tracks.
    - ONE subplot per SPLICE_JUNCTIONS track (all junctions on the SAME plot).
    - Variant position marked in all subplots.
    - Sashimi plots with Bezier curves.
    - Full track metadata in subplot titles.
    """
    subplot_specs = []

    transcripts = transcript_extractor.extract(interval)

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
        if track_name not in ["SPLICE_JUNCTIONS", "SPLICE_SITES", "SPLICE_SITE_USAGE", "CONTACT_MAPS"]:
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
        elif track_name == "CONTACT_MAPS":
            for i in range(ref_data.values.shape[2]):
                metadata = ref_data.metadata.iloc[i]
                subplot_specs.append({
                    "track_name": track_name,
                    "ref_data": ref_data,
                    "alt_data": alt_data,
                    "track_idx": i,
                    "metadata": metadata,
                    "type": "contact_map"
                })
        else:
            continue
                
    if not subplot_specs:
        raise ValueError("No valid tracks to plot.")
    
    # Create subplots
    n_subplots = len(subplot_specs) + 1
    transcript_row = n_subplots

    
    # Give contact maps more vertical space
    row_heights = []

    for spec in subplot_specs:
        if spec["type"] == "contact_map":
            row_heights.append(10)      # bigger
        elif spec["type"] == "sashimi":
            row_heights.append(2)      # medium
        else:  # continuous
            row_heights.append(1)      # default

    # transcript track
    row_heights.append(2)

    # normalize so Plotly is happy
    row_heights = np.array(row_heights, dtype=float)
    norm_row_heights = row_heights / row_heights.sum()

    fig = make_subplots(
        rows=n_subplots,
        cols=1,
        shared_xaxes=True,
        row_heights=norm_row_heights.tolist(),
        vertical_spacing=max(0.2 - (0.015 * row_heights.sum()), 0.05),
        subplot_titles=[
            f"{spec['track_name']} | {spec['metadata']['name'] if spec['metadata'] is not None else ''} | "
            f"{spec['metadata']['biosample_name'] if spec['metadata'] is not None and 'biosample_name' in spec['metadata'] else ''} |"
            f"{' strand: ' + spec['metadata']['strand'] if spec['metadata'] is not None and 'strand' in spec['metadata'] else ''}"
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
            for jc_interval, count in zip(ref_junctions, ref_counts):
                if not hasattr(jc_interval, 'start') or not hasattr(jc_interval, 'end'):
                    continue
                donor = jc_interval.start
                acceptor = jc_interval.end
                strand = getattr(jc_interval, 'strand', '+')
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
            for jc_interval, count in zip(alt_junctions, alt_counts):
                if not hasattr(jc_interval, 'start') or not hasattr(jc_interval, 'end'):
                    continue
                donor = jc_interval.start
                acceptor = jc_interval.end
                strand = getattr(jc_interval, 'strand', '+')
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
            fig.update_yaxes(
                row=idx + 1,
                col=1,
                showticklabels=False,
                title_text="")
        elif spec["type"] == "contact_map":

            ref_contact_map = spec["ref_data"].values[:, :, spec["track_idx"]].copy()
            alt_contact_map = spec["alt_data"].values[:, :,  spec["track_idx"]].copy()
            contact_diff = alt_contact_map - ref_contact_map

            bins = contact_diff.shape[0]

            coords = np.linspace(
                interval.start,
                interval.end,
                bins
            )
            #y_center = row_heights[:idx].sum() + row_heights[idx]/2

            fig.add_trace(
                go.Heatmap(
                    z=contact_diff,
                    x=coords,
                    y=coords,
                    colorscale="RdBu",
                    zmid=0,
                    showscale=False,
                    #colorbar=dict( title="Δ Contact", y=y_center, len= 2 / row_heights.sum()),
                    zmin=-np.max([np.max(np.abs(contact_diff)), .5]),
                    zmax=np.max([np.max(np.abs(contact_diff)), .5]),
                ),
            
                row=idx + 1,
                col=1)


    if transcripts:

        tx_tracks = assign_transcript_tracks(transcripts)

        exon_height = 0.15
        cds_height = 0.35
        track_spacing = 1.0

        for tx in transcripts:

            y = -tx_tracks[id(tx)] * track_spacing

            strand = tx.exons[0].strand

            tx_start = min(e.start for e in tx.exons)
            tx_end = max(e.end for e in tx.exons)

            # ---------------------------
            # transcript label
            # ---------------------------
            fig.add_annotation(
                x=tx_start,
                y=y + cds_height + 0.15,
                text=tx.transcript_id,
                showarrow=False,
                xanchor="left",
                font=dict(size=11),
                row=transcript_row,
                col=1,
            )

            exons = sorted(tx.exons, key=lambda e: e.start)

            cds_intervals = [
                (c.start, c.end)
                for c in getattr(tx, "cds", [])
            ]

            # ---------------------------
            # introns
            # ---------------------------
            for e1, e2 in zip(exons[:-1], exons[1:]):

                intron_start = e1.end
                intron_end = e2.start

                fig.add_trace(
                    go.Scatter(
                        x=[intron_start, intron_end],
                        y=[y, y],
                        mode="lines",
                        line=dict(color="#555555", width=1),
                        showlegend=False,
                        hoverinfo='skip',
                    ),
                    row=transcript_row,
                    col=1,
                )

                arrow_symbol = "triangle-right" if strand == "+" else "triangle-left"

                n_arrows = max(
                    1,
                    int((intron_end - intron_start) / 10000)
                )

                arrow_x = [
                    intron_start +
                    (i + 1) * (intron_end - intron_start) / (n_arrows + 1)
                    for i in range(n_arrows)
                ]

                fig.add_trace(
                    go.Scatter(
                        x=arrow_x,
                        y=[y] * len(arrow_x),
                        mode="markers",
                        marker=dict(
                            symbol=arrow_symbol,
                            size=8,
                            color="#555555",
                        ),
                        text='',
                        hoverinfo='skip',
                        showlegend=False
                    ),
                    row=transcript_row,
                    col=1,
                )

            # ---------------------------
            # exons
            # ---------------------------
            for exon in exons:

                exon_segments = []
                cursor = exon.start

                overlapping_cds = []

                for cds_start, cds_end in cds_intervals:

                    if cds_end < exon.start:
                        continue

                    if cds_start > exon.end:
                        continue

                    overlapping_cds.append(
                        (
                            max(cds_start, exon.start),
                            min(cds_end, exon.end),
                        )
                    )

                overlapping_cds.sort()

                for cds_start, cds_end in overlapping_cds:

                    if cursor < cds_start:
                        exon_segments.append(
                            (cursor, cds_start, False)
                        )

                    exon_segments.append(
                        (cds_start, cds_end, True)
                    )

                    cursor = cds_end

                if cursor < exon.end:
                    exon_segments.append(
                        (cursor, exon.end, False)
                    )

                for start, end, coding in exon_segments:

                    height = cds_height if coding else exon_height

                    fig.add_shape(
                        type="rect",
                        x0=start,
                        x1=end,
                        y0=y - height / 2,
                        y1=y + height / 2,
                        fillcolor="#555555",
                        line=dict(color="#555555", width=0),
                        row=transcript_row,
                        col=1,
                    )

        n_tracks = max(tx_tracks.values()) + 1

        fig.update_yaxes(
            row=transcript_row,
            col=1,
            showticklabels=False,
            title_text="",
            range=[
                -n_tracks * track_spacing,
                cds_height + 0.8
            ],
        )
            
    
    # Update layout
    fig.update_layout(
        height=500 + (120 * row_heights.sum()),
        width=1000,
        hovermode='x unified',
        #plot_bgcolor='white',
        #paper_bgcolor='white',
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

    fig.update_xaxes(range=[interval.start,interval.end],autorange=False, constrain="domain")
    fig.update_xaxes(
                row=n_subplots,
                col=1,
                title_text="Genomic position")
    fig.update_yaxes(fixedrange=True)

    return fig