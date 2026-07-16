import { useMemo } from 'react'
import { Plot, PLOTLY_CONFIG } from '@/plotly'
import type { ScoreRow, TrackExplanations } from '@/api'

// ── ScoresTable ──────────────────────────────────────────────────────────────

const PREFERRED_COLUMNS = [
  'output_type',
  'gene_name',
  'gene_id',
  'biosample_name',
  'transcription_factor',
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
                {col}
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
    const key = `${row.biosample_name}||${row.gene_name}||${row.gene_id}`
    byKey.set(key, row)
  }
  return [...byKey.values()]
}

function BarPanel({ title, rows }: { title: string; rows: ScoreRow[] }) {
  const sorted = [...rows].sort(
    (a, b) => toNumber(b.raw_score) - toNumber(a.raw_score),
  )
  const x = sorted.map((r) => String(r.biosample_name ?? ''))
  const y = sorted.map((r) => toNumber(r.raw_score))
  const colors = y.map((v) => (v < 0 ? NEGATIVE_COLOR : POSITIVE_COLOR))

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
      layout={{
        title: { text: title },
        height: 360,
        margin: { l: 50, r: 20, t: 50, b: 130 },
        xaxis: {
          title: { text: 'Tissue' },
          tickangle: -45,
          categoryorder: 'array',
          categoryarray: x,
        },
        yaxis: { title: { text: 'raw_score' } },
        showlegend: false,
      }}
      config={PLOTLY_CONFIG}
      style={{ width: '100%' }}
      useResizeHandler
    />
  )
}

function FacetGrid({
  rows,
  field,
}: {
  rows: ScoreRow[]
  field: string
}) {
  const groups = new Map<string, ScoreRow[]>()
  for (const row of rows) {
    const key = String(row[field] ?? '—')
    const existing = groups.get(key)
    if (existing) existing.push(row)
    else groups.set(key, [row])
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {[...groups.entries()].map(([name, groupRows]) => (
        <BarPanel key={name} title={name} rows={groupRows} />
      ))}
    </div>
  )
}

export function ScoresSummaryCharts({
  rows,
  outputTypes,
  explanations,
}: {
  rows: ScoreRow[]
  outputTypes: string[]
  explanations?: TrackExplanations
}) {
  return (
    <div className="space-y-8">
      {outputTypes.map((outputType) => {
        const filtered = dedupe(
          rows.filter((r) => String(r.output_type) === outputType),
        )
        if (filtered.length === 0) return null

        let chart
        if (outputType === 'RNA_SEQ')
          chart = <FacetGrid rows={filtered} field="gene_name" />
        else if (outputType === 'CHIP_TF')
          chart = (
            <FacetGrid rows={filtered} field="transcription_factor" />
          )
        else
          chart = (
            <BarPanel
              title={`Variant Effect: ${outputType}`}
              rows={filtered}
            />
          )

        return (
          <div key={outputType} className="space-y-3">
            <h3 className="text-lg font-semibold">{outputType}</h3>
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
        )
      })}
    </div>
  )
}
