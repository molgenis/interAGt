import { useMemo, useState } from 'react'
import { Plot, PLOTLY_CONFIG, plotTheme, themedAxis, themedLayout, themedHoverLabel } from '@/plotly'
import type { ScoreRow } from '@/api'
import type { TrackExplanations } from '@/trackExplanations'
import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs'
import { Button } from './ui/button'
import { Input } from '@/ui/input'

const NEGATIVE_COLOR = '#FF0C57'
const POSITIVE_COLOR = '#017FFD'
const MAX_PANELS = 6

function toNumber(value: ScoreRow[string]): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Linear-interpolation percentile, matching Plotly's default box-plot quartile method. */
function quantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 1) return sortedValues[0]
  const pos = (sortedValues.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const next = sortedValues[base + 1]
  return next === undefined ? sortedValues[base] : sortedValues[base] + rest * (next - sortedValues[base])
}

function boxStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    min: sorted[0],
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: sorted[sorted.length - 1],
  }
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
  CHIP_TF: { facet:'transcription_factor', identity:['genetically_modified'] },
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
  valueIdentities: string[]
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
function rowIdentity(row: ScoreRow, identity: string[]): string {
  return identity
    .map((field) => row[field])
    .filter((v) => v !== null && v !== undefined && v !== '')
    .join(' / ')
}

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
    const valueIdentities: string[] = []
    for (const row of groupRows) {
      const v = toNumber(row.raw_score)
      values.push(v)
      valueIdentities.push(rowIdentity(row, identity))
      if (v < min) min = v
      if (v > max) max = v
      sum += v
      const absV = Math.abs(v)
      if (absV > bestAbs) {
        bestAbs = absV
        best = row
      }
    }
    bars.push({
      category,
      value: toNumber(best.raw_score),
      min,
      max,
      mean: sum / groupRows.length,
      n: groupRows.length,
      identity: rowIdentity(best, identity),
      values,
      valueIdentities,
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

  const traces = sorted.flatMap((bar, i): unknown[] =>
    asScatter
      ? [
          {
            type: 'scatter',
            mode: 'markers',
            x: bar.values.map(() => bar.category),
            y: bar.values,
            customdata: bar.valueIdentities,
            marker: { color: colors[i], opacity: 0.5 },
            showlegend: false,
            hovertemplate: bar.valueIdentities.some((v) => v)
              ? '%{x}<br>raw_score=%{y:.4f}<br>%{customdata}<extra></extra>'
              : '%{x}<br>raw_score=%{y:.4f}<extra></extra>',
          },
        ]
      : [
          {
            // Plotly's aggregated box hover (hoveron: 'boxes') never supports
            // hovertext/hovertemplate — it always labels each stat separately
            // (see plotly.js src/traces/box/hover.js, hoverOnBoxes: "no hovertemplate
            // support yet"). Disable it and use an invisible overlay trace below instead.
            type: 'box',
            x: bar.values.map(() => bar.category),
            y: bar.values,
            marker: { color: colors[i] },
            line: { color: colors[i] },
            fillcolor: colors[i],
            showlegend: false,
            hoverinfo: 'skip',
          },
          {
            type: 'scatter',
            mode: 'markers',
            x: bar.values.map(() => bar.category),
            y: bar.values,
            marker: { color: colors[i], opacity: 0 },
            showlegend: false,
            hovertemplate: (() => {
              const s = boxStats(bar.values)
              const fmt = (v: number) => v.toFixed(4)
              return `${bar.category}<br>min=${fmt(s.min)}<br>q1=${fmt(s.q1)}<br>median=${fmt(s.median)}<br>q3=${fmt(s.q3)}<br>max=${fmt(s.max)}<extra></extra>`
            })(),
          },
        ],
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
  const [visiblePanelCounts, setVisiblePanelCounts] = useState<Record<string, number>>({})
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({})

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
        const searchQuery = searchQueries[outputType] || ''
        const visibleCount = visiblePanelCounts[outputType] || MAX_PANELS

        // Filter panels by search query (case-insensitive)
        const filteredPanels = spec.facet
          ? panels.filter(panel =>
              panel.title.toLowerCase().includes(searchQuery.toLowerCase()))
          : panels

        const hasMore = spec.facet && filteredPanels.length > visibleCount

        return (
          <details key={outputType} className="rounded-lg border p-4" open>
          <summary className="cursor-pointer text-sm flex items-center justify-between gap-4">
            <span>{outputType}</span>
            {showModeControl && (
              <div className="details-tabs">
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
              </div>
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


              {['RNA_SEQ', 'CHIP_HISTONE', 'CHIP_TF'].includes(outputType) && (
                <div className="flex justify-center">
                  <div className="flex gap-2 w-1/3">
                  <Input
                    type="search"
                    placeholder="Filter"
                    value={searchQuery}
                    onChange={(e) => setSearchQueries(prev => ({
                      ...prev,
                      [outputType]: e.target.value
                    }))}
                    className="flex-1 h-8"
                  />
                </div>
              </div>
              )}

              {spec.facet ? (
                <>
                  {filteredPanels.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No match</p>
                  ) : (
                    <>
                      <div
                        className="gap-4 w-full"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(max(250px, calc(100% / 4)), 1fr))',
                        }}
                      >
                        {filteredPanels.slice(0, visibleCount).map((panel) => (
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
                      {hasMore && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setVisiblePanelCounts(prev => ({
                              ...prev,
                              [outputType]: Math.min(visibleCount + MAX_PANELS, filteredPanels.length)
                            }))
                          }}
                        >
                          + Show {Math.min(MAX_PANELS, filteredPanels.length - visibleCount)} more
                        </Button>
                      )}
                    </>
                  )}
                </>
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