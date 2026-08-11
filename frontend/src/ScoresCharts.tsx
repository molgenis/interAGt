import { useMemo, useState } from 'react'
import { Plot, PLOTLY_CONFIG, plotTheme, themedAxis, themedLayout, themedHoverLabel } from '@/plotly'
import type { ScoreRow } from '@/api'
import type { TrackExplanations } from '@/trackExplanations'
import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs'

const NEGATIVE_COLOR = '#FF0C57'
const POSITIVE_COLOR = '#017FFD'

function toNumber(value: ScoreRow[string]): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

type ChartSpec = { facet?: string; identity: string[] }

const CHART_SPEC: Record<string, ChartSpec> = {
  ATAC: { identity: ['track_name'] },
  DNASE: { identity: ['track_name'] },
  RNA_SEQ: { facet: 'gene_name', identity: ['Assay title', 'data_source', 'endedness'] },
  Polyadenylation: { facet: 'gene_name', identity: ['Assay title', 'data_source', 'endedness'] },
  SPLICE_SITE_USAGE: { facet: 'gene_name', identity: ['Assay title', 'data_source'] },
  CHIP_HISTONE: { facet: 'histone_mark', identity: ['track_name'] },
  CAGE: { facet: 'track_strand', identity: ['track_name'] },
  PROCAP: { facet: 'track_strand', identity: ['track_name'] },
  SPLICE_SITES: { facet: 'track_name', identity: [] },
  CHIP_TF: { identity: ['transcription_factor', 'genetically_modified'] },
  SPLICE_JUNCTIONS: { identity: ['junction_Start', 'junction_End', 'Assay title'] },
  CONTACT_MAPS: { identity: ['track_name', 'Assay title'] },
}

const DEFAULT_CHART_SPEC: ChartSpec = { identity: ['track_name'] }

type AggBar = {
  category: string
  value: number
  min: number
  max: number
  mean: number
  n: number
  identity: string
  values: number[]
}

function groupBy<T>(rows: T[], keyFn: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyFn(row)
    const existing = groups.get(key)
    if (existing) existing.push(row)
    else groups.set(key, [row])
  }
  return groups
}

/** One bar per biosample: value is the raw_score of the row with the largest |raw_score|, ties keep the first seen (rows arrive sorted by abs(quantile_score) desc). */
function aggregateByCategory(rows: ScoreRow[], identity: string[]): AggBar[] {
  const groups = groupBy(rows, (row) => String(row.biosample_name ?? ''))

  const bars: AggBar[] = []
  for (const [category, groupRows] of groups) {
    let best = groupRows[0]
    let bestAbs = Math.abs(toNumber(best.raw_score))
    let min = toNumber(best.raw_score)
    let max = min
    let sum = 0
    const values: number[] = []
    for (const row of groupRows) {
      const v = toNumber(row.raw_score)
      values.push(v)
      if (v < min) min = v
      if (v > max) max = v
      sum += v
      const absV = Math.abs(v)
      if (absV > bestAbs) {
        bestAbs = absV
        best = row
      }
    }
    const identityStr = identity
      .map((field) => best[field])
      .filter((v) => v !== null && v !== undefined && v !== '')
      .join(' / ')
    bars.push({
      category,
      value: toNumber(best.raw_score),
      min,
      max,
      mean: sum / groupRows.length,
      n: groupRows.length,
      identity: identityStr,
      values,
    })
  }
  return bars
}

type Panel = { title: string; bars: AggBar[] }

function buildPanels(rows: ScoreRow[], spec: ChartSpec, outputType: string): Panel[] {
  if (!spec.facet) {
    return [{ title: `Variant Effect: ${outputType}`, bars: aggregateByCategory(rows, spec.identity) }]
  }
  const groups = groupBy(rows, (row) => String(row[spec.facet!] ?? '—'))
  return [...groups.entries()].map(([name, groupRows]) => ({
    title: spec.facet === 'track_strand' ? `strand ${name}` : name,
    bars: aggregateByCategory(groupRows, spec.identity),
  }))
}

function sharedRange(panels: Panel[]): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const panel of panels) {
    for (const bar of panel.bars) {
      if (bar.min < min) min = bar.min
      if (bar.max > max) max = bar.max
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [-0.2, 0.2]
  return [Math.min(min, -0.2), Math.max(max, 0.2)]
}

type DisplayMode = 'allBox' | 'allScatter' | 'maxAbs' | 'max' | 'mean'

const MODE_LABEL: Record<Exclude<DisplayMode, 'allBox' | 'allScatter'>, string> = {
  maxAbs: 'strongest (max abs)',
  max: 'maximum',
  mean: 'mean',
}

/** Value used for both bar height and category ordering. The 'all*' modes have no single scalar,
 * so they fall back to the max-abs value purely to keep category order stable/comparable across modes. */
function modeValue(bar: AggBar, mode: DisplayMode): number {
  switch (mode) {
    case 'max':
      return bar.max
    case 'mean':
      return bar.mean
    case 'allBox':
    case 'allScatter':
    case 'maxAbs':
    default:
      return bar.value
  }
}

type BarPanelProps = {
  title: string
  bars: AggBar[]
  yRange: [number, number]
  isDark: boolean
  displayMode?: DisplayMode
}

function sortedBarData(bars: AggBar[], mode: DisplayMode = 'maxAbs') {
  const sorted = [...bars].sort((a, b) => modeValue(b, mode) - modeValue(a, mode))
  const x = sorted.map((b) => b.category)
  const y = sorted.map((b) => modeValue(b, mode))
  const colors = y.map((v) => (v < 0 ? NEGATIVE_COLOR : POSITIVE_COLOR))
  return { sorted, x, y, colors }
}

function barPanelLayout(theme: ReturnType<typeof plotTheme>, title: string, x: string[], yRange: [number, number]) {
  return themedLayout(theme, {
    title: { text: title },
    height: 360,
    automargin: true,
    margin: { l: 100, r: 20, t: 50, b: 185 },
    xaxis: {
      ...themedAxis(theme),
      title: { text: '' },
      tickangle: -65,
      tickfont: { size: 9 },
      categoryorder: 'array',
      categoryarray: x,
      range: [-1, x.length], // Padding: 1 unit on each side
    },
    yaxis: {
      ...themedAxis(theme),
      title: { text: 'raw_score' },
      range: yRange,
    },
    hoverlabel: themedHoverLabel(theme),
    showlegend: false,
  })
}

/** Plain per-biosample bar chart: one row per category, no aggregation. */
function SimpleBarPanel({ title, bars, yRange, isDark, displayMode }: BarPanelProps) {
  const theme = plotTheme(isDark)
  const { x, y, colors } = sortedBarData(bars, displayMode)

  const trace = {
    type: 'bar',
    x,
    y,
    marker: { color: colors },
    hovertemplate: '%{x}<br>raw_score=%{y:.4f}<extra></extra>',
  }

  return (
    <Plot
      data={[trace]}
      layout={barPanelLayout(theme, title, x, yRange)}
      config={PLOTLY_CONFIG}
      style={{ width: '100%' }}
      useResizeHandler
    />
  )
}

/** Bar chart where a category aggregates multiple rows: bar height is the selected mode's
 * value (max-abs / max / mean) among the group, sorted by that same value. No whiskers — a
 * single scalar per category doesn't warrant one. */
function ModeBarPanel({ title, bars, yRange, isDark, displayMode }: BarPanelProps) {
  const theme = plotTheme(isDark)
  const mode = (displayMode ?? 'maxAbs') as Exclude<DisplayMode, 'allBox' | 'allScatter'>
  const { sorted, x, y, colors } = sortedBarData(bars, mode)
  const customdata = sorted.map((b) => b.n)

  const trace = {
    type: 'bar',
    x,
    y,
    marker: { color: colors },
    customdata,
    hovertemplate: `%{x}<br>${MODE_LABEL[mode]} raw_score=%{y:.4f}<br>n=%{customdata}<extra></extra>`,
  }

  return (
    <Plot
      data={[trace]}
      layout={barPanelLayout(theme, title, x, yRange)}
      config={PLOTLY_CONFIG}
      style={{ width: '100%' }}
      useResizeHandler
    />
  )
}

/** Distribution per category: shows every row's raw_score aggregated into that biosample, as
 * either a boxplot (quartile-based whiskers, not min/max) or a scatter strip. */
function DistributionPanel({ title, bars, yRange, isDark, displayMode }: BarPanelProps) {
  const theme = plotTheme(isDark)
  const { sorted, x: categories, colors } = sortedBarData(bars, displayMode ?? 'allBox')
  const asScatter = displayMode === 'allScatter'

  const traces = sorted.map((bar, i) =>
    asScatter
      ? {
          type: 'scatter',
          mode: 'markers',
          x: bar.values.map(() => bar.category),
          y: bar.values,
          marker: { color: colors[i] },
          showlegend: false,
        }
      : {
          type: 'box',
          x: bar.values.map(() => bar.category),
          y: bar.values,
          marker: { color: colors[i] },
          line: { color: colors[i] },
          fillcolor: colors[i],
          showlegend: false,
        },
  )

  return (
    <Plot
      data={traces}
      layout={barPanelLayout(theme, title, categories, yRange)}
      config={PLOTLY_CONFIG}
      style={{ width: '100%' }}
      useResizeHandler
    />
  )
}

function BarPanel(props: BarPanelProps) {
  const hasSpread = props.bars.some((b) => b.n > 1)
  if (!hasSpread) return <SimpleBarPanel {...props} />
  const mode = props.displayMode ?? 'maxAbs'
  return mode === 'allBox' || mode === 'allScatter' ? <DistributionPanel {...props} /> : <ModeBarPanel {...props} />
}

export function ScoresSummaryCharts({
  rows,
  outputTypes,
  explanations,
  isDark,
}: {
  rows: ScoreRow[]
  outputTypes: string[]
  explanations?: TrackExplanations
  isDark: boolean
}) {
  const [displayModes, setDisplayModes] = useState<Record<string, DisplayMode>>({})

  const sections = useMemo(() => {
    return outputTypes
      .map((outputType) => {
        const filtered = rows.filter((r) => String(r.output_type) === outputType)
        if (filtered.length === 0) return null
        const spec = CHART_SPEC[outputType] ?? DEFAULT_CHART_SPEC
        const panels = buildPanels(filtered, spec, outputType)
        const yRange = sharedRange(panels)
        const hasAggregation = panels.some((p) => p.bars.some((b) => b.n > 1))
        const identityLength = (CHART_SPEC[outputType] ?? DEFAULT_CHART_SPEC).identity.length
        const showModeControl = hasAggregation && identityLength >= 2
        return { outputType, spec, panels, yRange, hasAggregation, showModeControl }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
  }, [rows, outputTypes])

  return (
    <div className="space-y-8">
      {sections.map(({ outputType, spec, panels, yRange, hasAggregation, showModeControl }) => {
        const displayMode = displayModes[outputType] ?? 'maxAbs'
        return (
          <details key={outputType} className="rounded-lg border p-4" open>
            <summary className="cursor-pointer text-sm flex items-center justify-between gap-4">
              <span>{outputType}</span>
              {showModeControl && (
                <Tabs
                  value={displayMode}
                  onValueChange={(v) => setDisplayModes((prev) => ({ ...prev, [outputType]: v as DisplayMode }))}
                  onClick={(e) => e.stopPropagation()}
                >
                  <TabsList>
                    <TabsTrigger value="allBox">All (box)</TabsTrigger>
                    <TabsTrigger value="allScatter">All (scatter)</TabsTrigger>
                    <TabsTrigger value="maxAbs">Max (abs)</TabsTrigger>
                    <TabsTrigger value="max">Max</TabsTrigger>
                    <TabsTrigger value="mean">Mean</TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
            </summary>
            <div key={outputType} className="mt-4 space-y-3">
              {explanations?.[outputType] && (
                <div
                  role="alert"
                  className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
                >
                  {explanations[outputType]}
                </div>
              )}
              {hasAggregation && (
                <p className="text-xs text-muted-foreground">
                  {displayMode === 'allBox' || displayMode === 'allScatter'
                    ? `Some biosamples produce multiple tracks for this output type. Each category shows a ${displayMode === 'allBox' ? 'boxplot' : 'scatter'} of every track's raw_score for that biosample, and every individual row is in the table and CSV export above.`
                    : `Some biosamples produce multiple tracks for this output type. Each bar shows the ${MODE_LABEL[displayMode]} raw_score among them, and every individual row is in the table and CSV export above.`}
                </p>
              )}
              {spec.facet ? (
                <div
                  className="gap-4 w-full"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(max(250px, calc(100% / 4)), 1fr))',
                  }}
                >
                  {panels.map((panel) => (
                    <BarPanel
                      key={panel.title}
                      title={panel.title}
                      bars={panel.bars}
                      yRange={yRange}
                      isDark={isDark}
                      displayMode={displayMode}
                    />
                  ))}
                </div>
              ) : (
                <BarPanel
                  title={panels[0].title}
                  bars={panels[0].bars}
                  yRange={yRange}
                  isDark={isDark}
                  displayMode={displayMode}
                />
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}
