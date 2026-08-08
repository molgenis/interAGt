import createPlotlyComponent from 'react-plotly.js/factory'
import Plotly from 'plotly.js-dist-min'

export const Plot = createPlotlyComponent(Plotly)

export const PLOTLY_CONFIG = {
  displaylogo: false,
  responsive: true,
  displayModeBar: false 
} as const

export interface PlotTheme {
  /** Text, variant markers, transcript bodies. */
  fg: string
  /** De-emphasised strokes: REF traces, sashimi reference arcs. */
  muted: string
  grid: string
  /** Opaque backing for annotation labels that sit on top of traces. */
  surface: string
  /** Fixed-order categorical hues for identity encoding (e.g. per-lane legend colors). Never cycle/reorder. */
  categorical: string[]
}

const LIGHT: PlotTheme = {
  fg: '#0f172a',
  muted: '#64748b',
  grid: 'rgba(100,116,139,0.2)',
  surface: '#ffffff',
  categorical: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
}

const DARK: PlotTheme = {
  fg: '#e2e8f0',
  muted: '#94a3b8',
  grid: 'rgba(148,163,184,0.2)',
  surface: '#0b1220',
  categorical: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
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

export function themedHoverLabel(theme: PlotTheme): Record<string, unknown> {
  return {
    bgcolor: theme.surface,
    font: { color: theme.fg }
  }
}