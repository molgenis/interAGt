import createPlotlyComponent from 'react-plotly.js/factory'
import Plotly from 'plotly.js-dist-min'

export const Plot = createPlotlyComponent(Plotly)

export const PLOTLY_CONFIG = {
  displaylogo: false,
  responsive: true,
} as const

export interface PlotTheme {
  /** Text, variant markers, transcript bodies. */
  fg: string
  /** De-emphasised strokes: REF traces, sashimi reference arcs. */
  muted: string
  grid: string
  /** Opaque backing for annotation labels that sit on top of traces. */
  surface: string
}

const LIGHT: PlotTheme = {
  fg: '#0f172a',
  muted: '#64748b',
  grid: 'rgba(100,116,139,0.2)',
  surface: '#ffffff',
}

const DARK: PlotTheme = {
  fg: '#e2e8f0',
  muted: '#94a3b8',
  grid: 'rgba(148,163,184,0.2)',
  surface: '#0b1220',
}

export function plotTheme(isDark: boolean): PlotTheme {
  return isDark ? DARK : LIGHT
}

/** Transparent backgrounds let the panel's Tailwind surface show through. */
export function themedLayout(
  theme: PlotTheme,
  layout: Record<string, unknown>,
): Record<string, unknown> {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: theme.fg },
    ...layout,
  }
}

export function themedAxis(theme: PlotTheme): Record<string, unknown> {
  return {
    gridcolor: theme.grid,
    linecolor: theme.grid,
    zerolinecolor: theme.grid,
  }
}
