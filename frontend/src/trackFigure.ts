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

const REF_COLOR = '#999'
const ALT_COLOR = '#FF0C57'
const SASHIMI_REF_COLOR = '#333'

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
      font: { color: '#333', size: 12 },
      bgcolor: 'white',
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
): { shapes: unknown[]; annotations: unknown[] } {
  const xa = xRef(row)
  const ya = yRef(row)

  const ref = buildJunctionShapes(spec.ref_junctions, SASHIMI_REF_COLOR, xa, ya, 0)
  const altOffset = -(ref.maxHeight + 10)
  const alt = buildJunctionShapes(spec.alt_junctions, ALT_COLOR, xa, ya, altOffset)

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
    colorscale: 'RdBu',
    zmid: 0,
    zmin: -maxAbs,
    zmax: maxAbs,
    showscale: false,
    xaxis: xRef(row),
    yaxis: yRef(row),
  }
}

// --- Axis configuration helpers ---

function makeXAxis(
  row: number,
  range: [number, number],
  showTicks: boolean,
  spec?: TrackSpec,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
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

function makeYAxis(row: number, spec?: TrackSpec): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
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

export function buildTrackFigure(payload: TrackPlotResponse): PlotlyFigure {
  const { tracks, transcripts, interval, variant } = payload

  const nSubplots = tracks.length + 1
  const transcriptRow = nSubplots

  const rowHeights = tracks.map((t) =>
    t.type === 'contact_map' ? 8 : t.type === 'sashimi' ? 2 : 1,
  )
  rowHeights.push(2)

  const totalHeight = rowHeights.reduce((a, b) => a + b, 0)
  const xRange: [number, number] = [interval.start, interval.end]

  const data: unknown[] = []
  const shapes: unknown[] = []
  const annotations: unknown[] = []

  // Build track objects
  for (let idx = 0; idx < tracks.length; idx++) {
    const spec = tracks[idx]
    const row = idx + 1

    if (spec.type === 'continuous') {
      data.push(...buildContinuousTraces(spec, row, idx === 0))
    } else if (spec.type === 'sashimi') {
      const result = buildSashimiObjects(spec, row)
      shapes.push(...result.shapes)
      annotations.push(...result.annotations)
    } else if (spec.type === 'contact_map') {
      data.push(buildContactMapTrace(spec, row))
    }
  }

  // Transcript track
  let nLanes = 1
  if (transcripts?.length) {
    const tx = buildTranscriptObjects(transcripts, xRef(transcriptRow), yRef(transcriptRow))
    data.push(...tx.traces)
    shapes.push(...tx.shapes)
    annotations.push(...tx.annotations)
    nLanes = tx.nLanes
  }

  // Configure axes
  const layout: Record<string, unknown> = {
    height: 500 + 120 * totalHeight,
    hovermode: 'x unified',
    legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'right', x: 1 },
    shapes,
    annotations,
    margin: { l: 60, r: 30, t: 40, b: 60 },
    grid: {
      rows: nSubplots,
      columns: 1,
      pattern: 'independent',
      roworder: 'top to bottom',
    },
    row_heights: rowHeights,
    vertical_spacing: 5 / ( 500 + 120 * totalHeight),
  }

  for (let row = 1; row <= nSubplots; row++) {
    layout[xKey(row)] = makeXAxis(
  row,
  xRange,
  row === nSubplots,
  row <= tracks.length ? tracks[row - 1] : undefined,
)

    if (row <= tracks.length) {
      layout[yKey(row)] = makeYAxis(row, tracks[row - 1])
    } else if (row === transcriptRow && transcripts?.length) {
      layout[yKey(row)] = {
        anchor: xRef(row),
        fixedrange: true,
        showticklabels: false,
        title: { text: '' },
        range: [-nLanes * TRACK_SPACING, CDS_HEIGHT + 0.8],
      }
    } else {
      layout[yKey(row)] = makeYAxis(row)
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
      line: { dash: 'dash', color: 'black', width: 1 },
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
    font: { size: 10 },
  })

  return { data, layout }
}
