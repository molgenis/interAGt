import { useMemo } from 'react'
import { Plot, PLOTLY_CONFIG, plotTheme, themedAxis, themedLayout, themedHoverLabel } from '@/plotly'
import type { ScoreRow } from '@/api'
import { COLUMN_EXPLANATIONS, type TrackExplanations } from '@/trackExplanations'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

// ── ScoresTable ──────────────────────────────────────────────────────────────

const PREFERRED_COLUMNS = [
  'output_type',
  'gene_name',
  'gene_id',
  'biosample_name',
  'transcription_factor',
  'histone_mark',
  'track_strand',
  'raw_score',
  'quantile_score',
  'hpo_gene_relevance',
]

function formatValue(value: ScoreRow[string]): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : value.toFixed(4)
  return String(value)
}

export function ScoresTable({ rows }: { rows: ScoreRow[] }) {
  const columns = useMemo(() => {
    const present = new Set<string>()
    for (const row of rows) for (const key of Object.keys(row)) present.add(key)
    return PREFERRED_COLUMNS.filter((c) => present.has(c))
  }, [rows])

  if (rows.length === 0) return null

  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
      <table className="w-full caption-bottom text-sm">
        <thead className="[&_tr]:border-b sticky top-0 bg-background">
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col}
                className="h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {COLUMN_EXPLANATIONS[col] ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="cursor-help border-0 border-b border-dotted border-muted-foreground/60 bg-transparent p-0 text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {col}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="w-64 rounded border bg-popover p-2 text-xs normal-case tracking-normal text-popover-foreground">
                      {COLUMN_EXPLANATIONS[col]}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  col
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border hover:bg-muted/40">
              {columns.map((col) => (
                <td key={col} className="whitespace-nowrap px-3 py-2 align-middle">
                  {formatValue(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── ScoresSummaryCharts ──────────────────────────────────────────────────────

const NEGATIVE_COLOR = '#FF0C57'
const POSITIVE_COLOR = '#017FFD'

function toNumber(value: ScoreRow[string]): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function dedupe(rows: ScoreRow[]): ScoreRow[] {
  const byKey = new Map<string, ScoreRow>()
  for (const row of rows) {
    const key = `${row.biosample_name}||${row.gene_name}||${row.gene_id}||${row.histone_mark}||${row.track_strand}`
    byKey.set(key, row)
  }
  return [...byKey.values()]
}

function BarPanel({
  title,
  rows,
  isDark,
}: {
  title: string
  rows: ScoreRow[]
  isDark: boolean
}) {
  const theme = plotTheme(isDark)
  const sorted = [...rows].sort(
    (a, b) => toNumber(b.raw_score) - toNumber(a.raw_score),
  )
  const x = sorted.map((r) => String(r.biosample_name ?? ''))
  const y = sorted.map((r) => toNumber(r.raw_score))
  const colors = y.map((v) => (v < 0 ? NEGATIVE_COLOR : POSITIVE_COLOR))
  const validY = y.filter((v): v is number => v !== null && v !== undefined && !isNaN(v));
  const minY = validY.length > 0 ? Math.min(...validY) : 0;
  const maxY = validY.length > 0 ? Math.max(...validY) : 0;

  return (
    <Plot
      data={[
        {
          type: 'bar',
          x,
          y,
          marker: { color: colors },
          hovertemplate: '%{x}<br>raw_score=%{y:.4f}<extra></extra>',
        },
      ]}
      layout={themedLayout(theme, {
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
          range: [-1, x.length] // Padding: 1 unit on each side
        },
        yaxis: {
          ...themedAxis(theme),
          title: { text: 'raw_score' },
          range: [Math.min(minY, -0.2), Math.max(maxY, 0.2)],
        },
        hoverlabel: themedHoverLabel(theme),
        showlegend: false,
      })}
      config={PLOTLY_CONFIG}
      style={{ width: '100%' }}
      useResizeHandler
    />
    )
  }

function FacetGrid({
  rows,
  field,
  isDark,
}: {
  rows: ScoreRow[]
  field: string
  isDark: boolean
}) {
  const groups = new Map<string, ScoreRow[]>();
  for (const row of rows) {
    const key = String(row[field] ?? '—');
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  return (
    <div
      className="gap-4 w-full"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(max(250px, calc(100% / 4)), 1fr))'
      }}
    >
      {[...groups.entries()].map(([name, groupRows]) => (
          <BarPanel key={name} title={field === 'track_strand' ? `strand ${name}` : name } rows={groupRows} isDark={isDark} />
      ))}
    </div>
  );
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
  return (
    <div className="space-y-8">
      {outputTypes.map((outputType) => {
        const filtered = dedupe(
          rows.filter((r) => String(r.output_type) === outputType),
        )
        if (filtered.length === 0) return null

        let chart
        if (outputType === 'RNA_SEQ' || outputType === 'Polyadenylation')
          chart = <FacetGrid rows={filtered} field="gene_name" isDark={isDark} />
        else if (outputType === 'CHIP_TF')
          chart = (
            <FacetGrid
              rows={filtered}
              field="transcription_factor"
              isDark={isDark}
            />
          )
        else if (outputType === "CAGE") {
          chart = (
            <FacetGrid
              rows={filtered}
              field="track_strand"
              isDark={isDark}
            />
          );
        }
        else if (outputType === "PROCAP") {
          chart = (
            <FacetGrid
              rows={filtered}
              field="track_strand"
              isDark={isDark}
            />
          );
        } else if (outputType === "CHIP_HISTONE") {
          chart = (
            <FacetGrid
              rows={filtered}
              field="histone_mark"
              isDark={isDark}
            />
          );
        } 
        else
          chart = (
            <BarPanel
              title={`Variant Effect: ${outputType}`}
              rows={filtered}
              isDark={isDark}
            />
          )

        return (
          <details key={outputType} className="rounded-lg border p-4" open>
            <summary className="cursor-pointer text-sm">
              {outputType}
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
              {chart}
            </div>
          </details>
        )
      })}
    </div>
    
  )
}
