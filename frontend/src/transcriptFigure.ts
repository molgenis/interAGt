import type { TranscriptSpec } from '@/api'
import type { PlotTheme } from '@/plotly'

const EXON_HEIGHT = 0.15
const CDS_HEIGHT = 0.35
// Lane pitch: with no on-plot labels, only needs to clear a CDS box plus a small gap.
const TRACK_SPACING = 0.7
// Vertical breathing room above the top lane / below the bottom lane.
const TRACK_PAD = CDS_HEIGHT / 2 + 0.15

export { CDS_HEIGHT, TRACK_SPACING, TRACK_PAD }

export interface TranscriptResult {
  traces: unknown[]
  shapes: unknown[]
  annotations: unknown[]
  nLanes: number
}

/** Greedy interval-scheduling lane packer. */
function assignLanes(transcripts: TranscriptSpec[]): Map<TranscriptSpec, number> {
  const ranges = transcripts.map((tx) => {
    let start = Infinity
    let end = -Infinity
    for (const exon of tx.exons) {
      if (exon.start < start) start = exon.start
      if (exon.end > end) end = exon.end
    }
    return { tx, start, end }
  })
  ranges.sort((a, b) => a.start - b.start)

  const laneEnds: number[] = []
  const result = new Map<TranscriptSpec, number>()
  for (const { tx, start, end } of ranges) {
    let placed = false
    for (let i = 0; i < laneEnds.length; i++) {
      if (start > laneEnds[i]) {
        result.set(tx, i)
        laneEnds[i] = end
        placed = true
        break
      }
    }
    if (!placed) {
      laneEnds.push(end)
      result.set(tx, laneEnds.length - 1)
    }
  }
  return result
}

function txStart(tx: TranscriptSpec): number {
  let start = Infinity
  for (const exon of tx.exons) if (exon.start < start) start = exon.start
  return start
}

/**
 * Position of each transcript within its lane (0, 1, 2, ...), ordered by start position.
 * Colors cycle on this index so transcripts sharing a lane — the ones a viewer could actually
 * confuse, since they sit at the same y — always land on different hues.
 */
function laneIndex(transcripts: TranscriptSpec[], laneMap: Map<TranscriptSpec, number>): Map<TranscriptSpec, number> {
  const sorted = [...transcripts].sort((a, b) => {
    const la = laneMap.get(a) ?? 0
    const lb = laneMap.get(b) ?? 0
    return la !== lb ? la - lb : txStart(a) - txStart(b)
  })
  const result = new Map<TranscriptSpec, number>()
  const counters = new Map<number, number>()
  for (const tx of sorted) {
    const lane = laneMap.get(tx) ?? 0
    const idx = counters.get(lane) ?? 0
    result.set(tx, idx)
    counters.set(lane, idx + 1)
  }
  return result
}

export function buildTranscriptObjects(
  transcripts: TranscriptSpec[],
  xRef: string,
  yRef: string,
  theme: PlotTheme,
): TranscriptResult {
  const traces: unknown[] = []
  const shapes: unknown[] = []
  const annotations: unknown[] = []
  const laneMap = assignLanes(transcripts)
  const laneIndexMap = laneIndex(transcripts, laneMap)

  // Ordered by lane then position within the lane, so color assignment is deterministic.
  const orderedTranscripts = [...transcripts].sort((a, b) => {
    const la = laneMap.get(a) ?? 0
    const lb = laneMap.get(b) ?? 0
    return la !== lb ? la - lb : (laneIndexMap.get(a) ?? 0) - (laneIndexMap.get(b) ?? 0)
  })

  for (const tx of orderedTranscripts) {
    const lane = laneMap.get(tx) ?? 0
    const y = -lane * TRACK_SPACING
    const sortedExons = [...tx.exons].sort((a, b) => a.start - b.start)
    if (!sortedExons.length) continue

    const TX_COLOR = theme.categorical[(laneIndexMap.get(tx) ?? 0) % theme.categorical.length]

    // Invisible full-span hover target: shows the transcript_id on hover, no on-plot label.
    const spanStart = sortedExons[0].start
    const spanEnd = sortedExons[sortedExons.length - 1].end
    const step = Math.max(50, Math.floor((spanEnd - spanStart) / 200))
    const hoverX: number[] = []
    for (let x = spanStart; x < spanEnd; x += step) hoverX.push(x)
    hoverX.push(spanEnd)
    traces.push({
      type: 'scatter',
      mode: 'lines',
      x: hoverX,
      y: hoverX.map(() => y),
      // Real color (not transparent) so the unified-hover swatch matches the transcript;
      // it renders on the lane's centerline, hidden under the exon/intron shapes drawn above it.
      line: { color: TX_COLOR, width: 1 },
      hovertemplate: `${tx.transcript_id}<extra></extra>`,
      showlegend: false,
      xaxis: xRef,
      yaxis: yRef,
    })

    // Intron connectors as shapes + strand arrows as trace
    for (let i = 0; i < sortedExons.length - 1; i++) {
      const intronStart = sortedExons[i].end
      const intronEnd = sortedExons[i + 1].start
      if (intronEnd <= intronStart) continue

      shapes.push({
        type: 'line',
        x0: intronStart,
        x1: intronEnd,
        y0: y,
        y1: y,
        line: { color: TX_COLOR, width: 1 },
        xref: xRef,
        yref: yRef,
      })

      // Strand direction arrows
      const span = intronEnd - intronStart
      const nArrows = Math.max(1, Math.floor(span / 10000))
      const arrowX: number[] = []
      for (let a = 0; a < nArrows; a++) {
        arrowX.push(intronStart + ((a + 1) * span) / (nArrows + 1))
      }
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: arrowX,
        y: arrowX.map(() => y),
        marker: {
          symbol: tx.strand === '+' ? 'triangle-right' : 'triangle-left',
          size: 8,
          color: TX_COLOR,
        },
        hoverinfo: 'skip',
        showlegend: false,
        xaxis: xRef,
        yaxis: yRef,
      })
    }

    // Exon/CDS rectangles
    const cdsIntervals = tx.cds ?? []
    for (const exon of sortedExons) {
      const segments = splitExonByCds(exon.start, exon.end, cdsIntervals)
      for (const [start, end, coding] of segments) {
        const h = coding ? CDS_HEIGHT : EXON_HEIGHT
        shapes.push({
          type: 'rect',
          x0: start,
          x1: end,
          y0: y - h / 2,
          y1: y + h / 2,
          fillcolor: TX_COLOR,
          line: { color: TX_COLOR, width: 0 },
          xref: xRef,
          yref: yRef,
        })
      }
    }
  }

  let nLanes = 1
  for (const idx of laneMap.values()) {
    if (idx + 1 > nLanes) nLanes = idx + 1
  }

  return { traces, shapes, annotations, nLanes }
}

/** Split an exon into coding and non-coding segments based on CDS overlap. */
function splitExonByCds(
  exonStart: number,
  exonEnd: number,
  cdsIntervals: { start: number; end: number }[],
): [number, number, boolean][] {
  const overlapping: [number, number][] = []
  for (const cds of cdsIntervals) {
    if (cds.end < exonStart || cds.start > exonEnd) continue
    overlapping.push([Math.max(cds.start, exonStart), Math.min(cds.end, exonEnd)])
  }
  overlapping.sort((a, b) => a[0] - b[0])

  const segments: [number, number, boolean][] = []
  let cursor = exonStart
  for (const [cStart, cEnd] of overlapping) {
    if (cursor < cStart) segments.push([cursor, cStart, false])
    segments.push([cStart, cEnd, true])
    cursor = cEnd
  }
  if (cursor < exonEnd) segments.push([cursor, exonEnd, false])
  return segments
}
