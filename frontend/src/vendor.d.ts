// Type shims for libraries without bundled TypeScript definitions.

declare module 'react-plotly.js/factory' {
  import type { ComponentType, CSSProperties } from 'react'

  export interface PlotParams {
    data?: unknown[]
    layout?: Record<string, unknown>
    config?: Record<string, unknown>
    frames?: unknown[]
    style?: CSSProperties
    className?: string
    useResizeHandler?: boolean
    revision?: number
    onInitialized?: (...args: unknown[]) => void
    onUpdate?: (...args: unknown[]) => void
  }

  const createPlotlyComponent: (plotly: unknown) => ComponentType<PlotParams>
  export default createPlotlyComponent
}

declare module 'plotly.js-dist-min' {
  const Plotly: unknown
  export default Plotly
}
