import type {
  ContactMapTrack,
  ContinuousTrack,
  PlotlyFigure,
  SashimiJunction,
  SashimiTrack,
  TrackPlotResponse,
  TrackSpec,
} from '@/api'
import { buildTranscriptObjects, CDS_HEIGHT, TRACK_SPACING } from '@/transcriptFigure'
import { plotTheme, themedAxis, themedLayout, themedHoverLabel, type PlotTheme } from '@/plotly'

const REF_COLOR = '#999'
const ALT_COLOR = '#FF0C57'

// --- Subplot axis helpers ---

function xRef(row: number): string {
  return row === 1 ? 'x' : `x${row}`
}
function yRef(row: number): string {
  return row === 1 ? 'y' : `y${row}`
}
function xKey(row: number): string {
  return row === 1 ? 'xaxis' : `xaxis${row}`
}
function yKey(row: number): string {
  return row === 1 ? 'yaxis' : `yaxis${row}`
}

function subplotTitle(spec: TrackSpec): string {
  const { metadata, track_name } = spec
  return [
    track_name,
    metadata.name ?? '',
    metadata.biosample_name ?? '',
    metadata.strand ? `strand: ${metadata.strand}` : '',
  ].join(' | ')
}

// --- Trace factories ---

function lineTrace(
  x: number[],
  y: number[],
  color: string,
  name: string,
  xaxis: string,
  yaxis: string,
  showlegend: boolean,
): unknown {
  return {
    type: 'scatter',
    mode: 'lines',
    x,
    y,
    name,
    legendgroup: name,
    line: { color, width: 1.5 },
    showlegend,
    hovertemplate: 'Position: %{x}<br>Value: %{y:.2f}<extra></extra>',
    xaxis,
    yaxis,
  }
}

function buildContinuousTraces(
  spec: ContinuousTrack,
  row: number,
  showLegend: boolean,
): unknown[] {
  const length = spec.ref_values.length
  const x = Array.from({ length }, (_, i) => spec.interval_start + i)
  const xa = xRef(row)
  const ya = yRef(row)
  return [
    lineTrace(x, spec.ref_values, REF_COLOR, 'REF', xa, ya, showLegend),
    lineTrace(x, spec.alt_values, ALT_COLOR, 'ALT', xa, ya, showLegend),
  ]
}

// --- Sashimi rendering (SVG path shapes) ---

function arcPath(donor: number, acceptor: number, peak: number, yOff: number): string {
  const span = acceptor - donor
  // Control points at 20% inset, overshoot peak by 20% to approximate the steeper arch shape
  const cp = peak * 1.2 + yOff
  const cpx1 = donor + span * 0.2
  const cpx2 = acceptor - span * 0.2
  return `M ${donor},${yOff} C ${cpx1},${cp} ${cpx2},${cp} ${acceptor},${yOff}`
}

interface SashimiResult {
  shapes: unknown[]
  annotations: unknown[]
  maxHeight: number
}

function buildJunctionShapes(
  junctions: SashimiJunction[],
  color: string,
  xaxis: string,
  yaxis: string,
  yOffset: number,
  theme: PlotTheme,
): SashimiResult {
  const shapes: unknown[] = []
  const annotations: unknown[] = []
  let maxHeight = 0

  for (const jc of junctions) {
    if (jc.count < 0.005 || jc.end <= jc.start) continue
    const sign = jc.strand === '+' ? 1 : -1
    const height = Math.log(jc.count + 1) * 40
    const peak = sign * height

    shapes.push({
      type: 'path',
      path: arcPath(jc.start, jc.end, peak, yOffset),
      line: { color, width: Math.max(1, Math.log(jc.count + 1)) },
      fillcolor: 'rgba(0,0,0,0)',
      xref: xaxis,
      yref: yaxis,
    })

    const mid = (jc.start + jc.end) / 2
    annotations.push({
      x: mid,
      y: sign * (height + 2) + yOffset,
      showarrow: false,
      text: jc.count.toFixed(1),
      font: { color: theme.fg, size: 12 },
      bgcolor: theme.surface,
      xref: xaxis,
      yref: yaxis,
    })

    if (height > maxHeight) maxHeight = height
  }

  return { shapes, annotations, maxHeight }
}

function buildSashimiObjects(
  spec: SashimiTrack,
  row: number,
  theme: PlotTheme,
): { shapes: unknown[]; annotations: unknown[] } {
  const xa = xRef(row)
  const ya = yRef(row)

  const ref = buildJunctionShapes(spec.ref_junctions, theme.muted, xa, ya, 0, theme)
  const altOffset = -(ref.maxHeight + 10)
  const alt = buildJunctionShapes(spec.alt_junctions, ALT_COLOR, xa, ya, altOffset, theme)

  return {
    shapes: [...ref.shapes, ...alt.shapes],
    annotations: [...ref.annotations, ...alt.annotations],
  }
}

// --- Contact map ---

function buildContactMapTrace(spec: ContactMapTrack, row: number): unknown {
  let maxAbs = 0.5
  for (const rowVals of spec.z) {
    for (const v of rowVals) {
      const a = Math.abs(v)
      if (a > maxAbs) maxAbs = a
    }
  }
  return {
    type: 'heatmap',
    z: spec.z,
    x: spec.coords,
    y: spec.coords,
    colorscale:  [
      [0, 'rgba(255, 12, 87, 1)'],
      [0.4, 'rgba(255, 12, 87, 0.46)'],  
      [0.499, 'rgba(255, 12, 87, 0.01)'], 
      [0.5, 'rgba(0, 0, 0, 0)'],    
      [0.501, 'rgba(1, 127, 253, 0.01)'],
      [0.6, 'rgba(1, 127, 253, 0.46)'],
      [1, 'rgba(1, 127, 253, 1)'],
      ],
    zmid: 0,
    zmin: -maxAbs,
    zmax: maxAbs,
    showscale: false,
    xaxis: xRef(row),
    yaxis: yRef(row),
  }
}

// --- Domains for controlling subplot height 
function makeDomains(weights: number[]) {
  const total = weights.reduce((a, b) => a + b, 0)
  const gap = 0.02

  let top = 1

  return weights.map((w) => {
    const h = (w / total) * (1 - gap * (weights.length - 1))
    const domain: [number, number] = [top - h, top]

    top = top - h - gap

    return domain
  })
}

// --- Axis configuration helpers ---

function makeXAxis(
  row: number,
  range: [number, number],
  showTicks: boolean,
  theme: PlotTheme,
  spec?: TrackSpec,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    ...themedAxis(theme),
    anchor: yRef(row),
    showticklabels: showTicks,
    title: spec ? { text: subplotTitle(spec), standoff: 10 } : undefined,
  }
  if (row === 1) {
    config.range = range
    config.autorange = false
    config.constrain = 'domain'
  } else {
    config.matches = 'x'  // Secondary axes inherit from primary
  }
  return config
}

function makeYAxis(
  row: number,
  theme: PlotTheme,
  spec?: TrackSpec,
): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    ...themedAxis(theme),
    anchor: xRef(row),
    fixedrange: true,
  }
  if (!spec) return cfg
  if (spec.type === 'sashimi') {
    cfg.showticklabels = false
  }
  return cfg
}



// --- Main entry point ---

export function buildTrackFigure(
  payload: TrackPlotResponse,
  isDark = false,
): PlotlyFigure {
  const { tracks, transcripts, interval, variant } = payload
  const theme = plotTheme(isDark)

  const nSubplots = tracks.length + 1
  const transcriptRow = nSubplots

  const rowHeights = tracks.map((t) =>
    t.type === 'contact_map' ? 6 : t.type === 'sashimi' ? 2 : 1,
  )
  rowHeights.push(2)

  const totalHeight = rowHeights.reduce((a, b) => a + b, 0)
  const xRange: [number, number] = [interval.start, interval.end]

  const data: unknown[] = []
  const shapes: unknown[] = []
  const annotations: unknown[] = []

  // Build track objects
  let shownContinuousLegend = false
  for (let idx = 0; idx < tracks.length; idx++) {
    const spec = tracks[idx]
    const row = idx + 1

    if (spec.type === 'continuous') {
      data.push(...buildContinuousTraces(spec, row, !shownContinuousLegend))
      shownContinuousLegend = true
    } else if (spec.type === 'sashimi') {
      const result = buildSashimiObjects(spec, row, theme)
      shapes.push(...result.shapes)
      annotations.push(...result.annotations)
    } else if (spec.type === 'contact_map') {
      data.push(buildContactMapTrace(spec, row))
    }
  }

  // Transcript track
  let nLanes = 1
  if (transcripts?.length) {
    const tx = buildTranscriptObjects(
      transcripts,
      xRef(transcriptRow),
      yRef(transcriptRow),
      theme,
    )
    data.push(...tx.traces)
    shapes.push(...tx.shapes)
    annotations.push(...tx.annotations)
    nLanes = tx.nLanes
  }

  // Configure axes
  const layout: Record<string, unknown> = themedLayout(theme, {
    height: 500 + 120 * totalHeight,
    hovermode: 'x unified',
    legend: {
      orientation: 'h',
      yanchor: 'bottom',
      y: 1.02,
      xanchor: 'right',
      x: 1,
      title: { text: 'Click to toggle:', side: 'left', font: { size: 11, color: theme.muted } },
    },
    shapes,
    annotations,
    hoverlabel: themedHoverLabel(theme),
    margin: { l: 60, r: 30, t: 40, b: 60 },
  
  })

  const domains = makeDomains(rowHeights)

  for (let row = 1; row <= nSubplots; row++) {
    layout[xKey(row)] = makeXAxis(
      row,
      xRange,
      row === nSubplots,
      theme,
      row <= tracks.length ? tracks[row - 1] : undefined,
    )

    if (row <= tracks.length) {
      layout[yKey(row)] = {
        ...makeYAxis(row, theme, tracks[row - 1]),
        domain: domains[row - 1],
      }
    } else if (row === transcriptRow && transcripts?.length) {
      layout[yKey(row)] = {
        ...themedAxis(theme),
        anchor: xRef(row),
        fixedrange: true,
        showticklabels: false,
        title: { text: '' },
        range: [-nLanes * TRACK_SPACING, CDS_HEIGHT + 0.8],
        domain: domains[row - 1],
      }
    } else {
      layout[yKey(row)] = {
        ...makeYAxis(row, theme),
        domain: domains[row - 1],
      }
    }
  }

  // Variant marker line on every subplot
  const variantPos = variant.position
  for (let row = 1; row <= nSubplots; row++) {
    shapes.push({
      type: 'line',
      xref: xRef(row),
      yref: `${yRef(row)} domain`,
      x0: variantPos,
      x1: variantPos,
      y0: 0,
      y1: 1,
      line: { dash: 'dash', color: theme.fg, width: 1 },
    })
  }

  // Variant label at top
  annotations.push({
    x: variantPos,
    y: 1,
    xref: xRef(1),
    yref: `${yRef(1)} domain`,
    text: `Variant: ${variant.label}`,
    showarrow: false,
    xanchor: 'left',
    yanchor: 'top',
    xshift: 4,
    yshift: -4,
    font: { size: 10, color: theme.fg },
  })

  return { data, layout }
}
