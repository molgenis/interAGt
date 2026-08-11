import { useMemo } from 'react'
import type { ScoreRow } from '@/api'
import { COLUMN_EXPLANATIONS } from '@/trackExplanations'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

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
