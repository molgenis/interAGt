import { useState, useMemo } from 'react'
import { Download } from 'lucide-react'
import { Plot, PLOTLY_CONFIG } from '@/plotly'
import { buildTrackFigure } from '@/trackFigure'
import type { TrackPlotResponse } from '@/api'

export function TrackPlot({ payload }: { payload: TrackPlotResponse }) {
  const figure = useMemo(() => buildTrackFigure(payload), [payload])
  return (
    <div className="w-full">
      <Plot
        data={figure.data}
        layout={{ ...figure.layout, autosize: true }}
        config={PLOTLY_CONFIG}
        useResizeHandler
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}

function renderHtml(payload: TrackPlotResponse): string {
  const figure = buildTrackFigure(payload)
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
    <button
      onClick={handleDownload}
      disabled={busy || !payload}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Download className="size-4" />
      {busy ? 'Preparing…' : 'Download Plot (HTML)'}
    </button>
  )
}
