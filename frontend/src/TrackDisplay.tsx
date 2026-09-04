import { useMemo, useState, useEffect } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/ui/button'
import { Plot, PLOTLY_CONFIG } from '@/plotly'
import { buildTrackFigure } from '@/trackFigure'
import type { TrackPlotResponse } from '@/api'

export function TrackPlot({
  payload,
  isDark,
}: {
  payload: TrackPlotResponse
  isDark: boolean
}) {
  const [graphDiv, setGraphDiv] = useState<any>(null)
  const [trackOrder, setTrackOrder] = useState<number[]>([])
  const [collapsedTracks, setCollapsedTracks] = useState<Set<number>>(new Set())
  const [transcriptPosition, setTranscriptPosition] = useState<'top' | 'bottom'>('bottom')

  useEffect(() => {
    setTrackOrder(payload.tracks.map((_, i) => i))
    setCollapsedTracks(new Set())
  }, [payload])

  const orderedPayload = useMemo<TrackPlotResponse>(
    () => ({
      ...payload,
      tracks:
        trackOrder.length > 0
          ? trackOrder.map(id => payload.tracks[id])
          : payload.tracks,
    }),
    [payload, trackOrder],
  )

  function moveTrackUp(rowIndex: number) {
    setTrackOrder(prev => {
      if (rowIndex <= 0) return prev
      const next = [...prev]
      ;[next[rowIndex - 1], next[rowIndex]] = [next[rowIndex], next[rowIndex - 1]]
      return next
    })
  }

  function moveTrackDown(rowIndex: number) {
    setTrackOrder(prev => {
      if (rowIndex >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[rowIndex], next[rowIndex + 1]] = [next[rowIndex + 1], next[rowIndex]]
      return next
    })
  }

  function moveTranscriptToTop() {
    setTranscriptPosition('top')
  }

  function moveTranscriptToBottom() {
    setTranscriptPosition('bottom')
  }

  const figure = useMemo(
    () =>
      buildTrackFigure(
        orderedPayload,
        isDark,
        collapsedTracks,
        trackOrder,
        transcriptPosition,
      ),
    [orderedPayload, isDark, collapsedTracks, trackOrder, transcriptPosition],
  )

  useEffect(() => {
    if (!graphDiv?.on) return

    const handler = (event: any) => {
      const name = event.annotation?.name ?? event.annotation?.text
      if (!name) return

      if (name.startsWith('move-up-')) {
        const row = Number(name.replace('move-up-', '')) - 1
        moveTrackUp(row)
        return
      }

      if (name.startsWith('move-down-')) {
        const row = Number(name.replace('move-down-', '')) - 1
        moveTrackDown(row)
        return
      }

      if (name === 'transcript-to-top') {
        moveTranscriptToTop()
        return
      }

      if (name === 'transcript-to-bottom') {
        moveTranscriptToBottom()
        return
      }
    }

    graphDiv.on('plotly_clickannotation', handler)

    return () => {
      graphDiv.removeListener?.('plotly_clickannotation', handler)
    }
  }, [graphDiv, trackOrder, transcriptPosition])

  return (
    <div className="w-full">
      <Plot
        data={figure.data}
        layout={{
          ...figure.layout,
          autosize: true,
        }}
        config={PLOTLY_CONFIG}
        useResizeHandler
        style={{
          width: '100%',
          height: '100%',
        }}
        onInitialized={(_, gd) => setGraphDiv(gd)}
        onUpdate={(_, gd) => setGraphDiv(gd)}
      />
    </div>
  )
}

/** Exports always render light — the standalone file has a white page. */
function renderHtml(payload: TrackPlotResponse): string {
  const figure = buildTrackFigure(payload, false)
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>InterAGt tracks</title>
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  <style>body{margin:0;font-family:sans-serif;} #plot{width:100vw;height:100vh;}</style>
</head>
<body>
  <div id="plot"></div>
  <script>
    Plotly.newPlot('plot', ${JSON.stringify(figure.data)}, ${JSON.stringify(figure.layout)}, {displaylogo:false, responsive:true});
  </script>
</body>
</html>`
}

export function DownloadHtmlButton({
  fileName,
  payload,
}: {
  fileName: string
  payload: TrackPlotResponse | null
}) {
  const [busy, setBusy] = useState(false)

  function handleDownload() {
    if (!payload) return
    setBusy(true)
    try {
      const blob = new Blob([renderHtml(payload)], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={busy || !payload}
    >
      <Download className="size-4" />
      {busy ? 'Preparing…' : 'Download Plot (HTML)'}
    </Button>
  )
}
