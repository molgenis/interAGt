import { useEffect, useMemo, useRef, useState } from 'react'
import { Columns3, Download } from 'lucide-react'
import type { ScoreRow } from '@/api'
import { COLUMN_EXPLANATIONS } from '@/trackExplanations'
import { downloadAsCSV } from '@/DownloadScores'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Checkbox } from '@/ui/checkbox'
import { Button } from '@/ui/button'

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

export function ScoresTable({
  rows,
  downloadFileName,
}: {
  rows: ScoreRow[]
  downloadFileName: string
}) {
  const allColumns = useMemo(() => {
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key)
          ordered.push(key)
        }
      }
    }
    return ordered
  }, [rows])

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(PREFERRED_COLUMNS),
  )
  const prevSignature = useRef<string>('')

  useEffect(() => {
    const signature = allColumns.join(',')
    if (signature !== prevSignature.current) {
      prevSignature.current = signature
      setSelected(new Set(allColumns.filter((c) => PREFERRED_COLUMNS.includes(c))))
    }
  }, [allColumns])

  const columns = useMemo(
    () => allColumns.filter((c) => selected.has(c)),
    [allColumns, selected],
  )

  if (rows.length === 0) return null

  function toggleColumn(col: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(col)
      else next.delete(col)
      return next
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadAsCSV(rows, downloadFileName)}
        >
          <Download className="size-4" />
          Download results (CSV)
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 className="size-4" />
              Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2">
            <div className="max-h-72 space-y-0.5 overflow-auto">
              {allColumns.map((col) => (
                <label
                  key={col}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selected.has(col)}
                    onCheckedChange={(checked) => toggleColumn(col, checked === true)}
                  />
                  <span className="truncate">{col}</span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
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
    </div>
  )
}
