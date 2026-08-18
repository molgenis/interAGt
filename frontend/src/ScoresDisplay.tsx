import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Columns3, Download } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
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
  const parentRef = useRef<HTMLDivElement>(null)

  const columns = useMemo(
    () => allColumns.filter((c) => selected.has(c)),
    [allColumns, selected],
  )

  useEffect(() => {
    const signature = allColumns.join(',')
    if (signature !== prevSignature.current) {
      prevSignature.current = signature
      setSelected(new Set(allColumns.filter((c) => PREFERRED_COLUMNS.includes(c))))
    }
  }, [allColumns])

  // Virtualization setup with dynamic row height measurement
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => 50, []), // Initial guess (will be overridden by measureElement)
    overscan: 10,
    measureElement: useCallback(
      (element: HTMLDivElement) => element.getBoundingClientRect().height,
      [],
    ),
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const totalSize = rowVirtualizer.getTotalSize()

  const gridTemplateColumns = useMemo(
    () => `repeat(${columns.length}, minmax(150px, 1fr))`,
    [columns.length],
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

      {/* Virtualized grid container */}
      <div
      ref={parentRef}
      className="h-[28rem] overflow-auto rounded-lg border border-border"
      >
        {/* Grid header */}
        <div
          className="sticky top-0 z-20 border-b border-border bg-background shadow-sm"
          style={{
            display: 'grid',
            gridTemplateColumns,
            width: 'fit-content',
            minWidth: '100%',
          }}
        >
        {columns.map((col) => (
          <div
            key={col}
            className="px-3 py-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
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
                <TooltipContent className="w-64 rounded border bg-popover p-2 text-sm normal-case tracking-normal text-popover-foreground">
                  {COLUMN_EXPLANATIONS[col]}
                </TooltipContent>
              </Tooltip>
            ) : (
              col
            )}
          </div>
        ))}
        </div>

        {/* Virtualized grid body */}
        <div
          style={{
            height: `${totalSize}px`,
            position: 'relative',
          }}
        >
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index]

          return (
            <div
              key={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              className="border-b border-border hover:bg-muted/40 text-xs"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns,
                width: 'fit-content',
                minWidth: '100%',
                alignItems: 'center',
              }}
            >

              {columns.map((col) => (
                <div
                  key={col}
                  className="line-clamp-2 break-words px-3 py-3"
                >
                  {formatValue(row[col])}
                </div>
              ))}
            </div>
          )
        })}
        </div>
      </div>
    </div>
  )
}