import createPlotlyComponent from 'react-plotly.js/factory'
import Plotly from 'plotly.js-dist-min'

export const Plot = createPlotlyComponent(Plotly)

export const PLOTLY_CONFIG = {
  displaylogo: false,
  responsive: true,
} as const
