import type { TranscriptSpec } from '@/api'
import type { PlotTheme } from '@/plotly'

const EXON_HEIGHT = 0.15
const CDS_HEIGHT = 0.35
const TRACK_SPACING = 1.0

export { CDS_HEIGHT, TRACK_SPACING }

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
  const TX_COLOR = theme.fg

  for (const tx of transcripts) {
    const lane = laneMap.get(tx) ?? 0
    const y = -lane * TRACK_SPACING
    const sortedExons = [...tx.exons].sort((a, b) => a.start - b.start)
    if (!sortedExons.length) continue

    const txStart = sortedExons[0].start

    // Transcript label
    annotations.push({
      x: txStart,
      y: y + CDS_HEIGHT + 0.15,
      text: tx.transcript_id,
      showarrow: false,
      xanchor: 'left',
      font: { size: 11, color: theme.fg },
      xref: xRef,
      yref: yRef,
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
