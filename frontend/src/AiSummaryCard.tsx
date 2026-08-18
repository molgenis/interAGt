import { useMemo, useState, type ComponentPropsWithoutRef } from 'react'
import Markdown from 'react-markdown'
import { Loader2, Sparkles } from 'lucide-react'
import { useAiSummary, type ApiRequestError, type ScoreRow } from '@/api'
import type { LlmSettings } from '@/llmSettings'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs'

// Keep in sync with LLM_MAX_ROWS in backend/services.py.
const LLM_MAX_ROWS = 100
const DEFAULT_QUANTILE_THRESHOLD = 0.5

type ColumnScope = 'all' | 'selected'

function quantileMagnitude(row: ScoreRow): number | null {
  const value = row.quantile_score
  return typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : null
}

// react-markdown emits bare HTML tags and Tailwind's preflight strips their
// default styling, so every element the model can produce gets its classes
// here rather than pulling in the typography plugin.
const MARKDOWN_COMPONENTS = {
  h1: (props: ComponentPropsWithoutRef<'h1'>) => (
    <h4 className="mt-4 text-sm font-semibold first:mt-0" {...props} />
  ),
  h2: (props: ComponentPropsWithoutRef<'h2'>) => (
    <h4 className="mt-4 text-sm font-semibold first:mt-0" {...props} />
  ),
  h3: (props: ComponentPropsWithoutRef<'h3'>) => (
    <h4 className="mt-4 text-sm font-semibold first:mt-0" {...props} />
  ),
  h4: (props: ComponentPropsWithoutRef<'h4'>) => (
    <h4 className="mt-4 text-sm font-semibold first:mt-0" {...props} />
  ),
  p: (props: ComponentPropsWithoutRef<'p'>) => (
    <p className="mt-2 text-sm leading-relaxed" {...props} />
  ),
  ul: (props: ComponentPropsWithoutRef<'ul'>) => (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm" {...props} />
  ),
  ol: (props: ComponentPropsWithoutRef<'ol'>) => (
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm" {...props} />
  ),
  li: (props: ComponentPropsWithoutRef<'li'>) => (
    <li className="leading-relaxed" {...props} />
  ),
  strong: (props: ComponentPropsWithoutRef<'strong'>) => (
    <strong className="font-semibold" {...props} />
  ),
  em: (props: ComponentPropsWithoutRef<'em'>) => (
    <em className="italic" {...props} />
  ),
  code: (props: ComponentPropsWithoutRef<'code'>) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs" {...props} />
  ),
  a: (props: ComponentPropsWithoutRef<'a'>) => (
    <a
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary underline underline-offset-4"
      {...props}
    />
  ),
  table: (props: ComponentPropsWithoutRef<'table'>) => (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-xs" {...props} />
    </div>
  ),
  th: (props: ComponentPropsWithoutRef<'th'>) => (
    <th className="border-b border-border px-2 py-1 font-semibold" {...props} />
  ),
  td: (props: ComponentPropsWithoutRef<'td'>) => (
    <td className="border-b border-border px-2 py-1" {...props} />
  ),
}

export function AiSummaryCard({
  llm,
  variant,
  organism,
  rows,
  hpoTerms,
  selectedColumns,
}: {
  llm: LlmSettings
  variant: string
  organism: string
  rows: ScoreRow[]
  hpoTerms: string[]
  /** The column set currently checked in the results table's column picker. */
  selectedColumns: Set<string>
}) {
  const summaryMutation = useAiSummary()
  const result = summaryMutation.data

  const [thresholdInput, setThresholdInput] = useState(String(DEFAULT_QUANTILE_THRESHOLD))
  const [columnScope, setColumnScope] = useState<ColumnScope>('selected')

  const quantileThreshold = useMemo(() => {
    const parsed = Number(thresholdInput)
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : DEFAULT_QUANTILE_THRESHOLD
  }, [thresholdInput])

  const { passingCount, noQuantileCount } = useMemo(() => {
    let passing = 0
    let noQuantile = 0
    for (const row of rows) {
      const magnitude = quantileMagnitude(row)
      if (magnitude === null) {
        noQuantile += 1
      } else if (magnitude > quantileThreshold) {
        passing += 1
      }
    }
    return { passingCount: passing, noQuantileCount: noQuantile }
  }, [rows, quantileThreshold])

  function run() {
    summaryMutation.mutate({
      llm_api_key: llm.apiKey,
      llm_base_url: llm.baseUrl,
      llm_model: llm.model,
      variant,
      organism,
      rows,
      hpo_terms: hpoTerms,
      quantile_threshold: quantileThreshold,
      columns: columnScope === 'all' ? null : Array.from(selectedColumns),
    })
  }

  return (
    <details className="rounded-lg border p-4" open>
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-primary" aria-hidden />
        AI summary
        <Badge
          variant="outline"
          className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-500"
        >
          Experimental
        </Badge>
      </summary>

      <div className="mt-4 space-y-3">
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-800 dark:text-amber-500">
          <span className="font-medium">AI-generated content.</span> This
          summary is written by a large language model from the scores above and
          may be incomplete, misleading or wrong. It has no access to literature
          or databases, so nothing here is verified against published evidence.
          Treat it as a reading aid, never as a finding, and never as clinical
          or diagnostic advice. Your variant and scores are sent to the LLM
          provider you configured.
        </p>

        <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="quantile-threshold">Quantile-score threshold</Label>
            <Input
              id="quantile-threshold"
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={thresholdInput}
              onChange={(e) => setThresholdInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Rows with |quantile_score| &gt; {quantileThreshold.toFixed(2)} are sent, strongest
              first
              {passingCount > LLM_MAX_ROWS
                ? `: ${passingCount} rows above threshold, top ${LLM_MAX_ROWS} will be sent.`
                : `: ${passingCount} row${passingCount === 1 ? '' : 's'} above threshold will be sent.`}
              {noQuantileCount > 0 &&
                ` ${noQuantileCount} row${noQuantileCount === 1 ? '' : 's'} with no quantile_score ${noQuantileCount === 1 ? 'is' : 'are'} always excluded.`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="column-scope">Columns to include</Label>
            <Tabs
              value={columnScope}
              onValueChange={(v) => setColumnScope(v as ColumnScope)}
            >
              <TabsList id="column-scope" className="grid w-full grid-cols-2">
                <TabsTrigger value="selected">Selected columns</TabsTrigger>
                <TabsTrigger value="all">All columns</TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              {columnScope === 'selected'
                ? `Uses the ${selectedColumns.size} column${selectedColumns.size === 1 ? '' : 's'} checked in the results table's Columns picker.`
                : 'Uses every column in the results table.'}
            </p>
          </div>
        </div>

        {summaryMutation.isError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <div className="font-medium">AI summary failed</div>
            <div className="mt-0.5 text-xs">
              {(summaryMutation.error as ApiRequestError).message}
            </div>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={run}
          disabled={summaryMutation.isPending}
        >
          {summaryMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="size-4" aria-hidden />
          )}
          {summaryMutation.isPending
            ? 'Thinking…'
            : result
              ? 'Regenerate summary'
              : 'Ask AI to analyze results'}
        </Button>

        {result && (
          <>
            <div className="rounded-lg border bg-muted/30 px-4 py-3">
              <Markdown components={MARKDOWN_COMPONENTS}>
                {result.summary}
              </Markdown>
            </div>

            <details className="rounded-lg border px-3 py-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                What was sent to {result.model} ({result.row_count} of{' '}
                {rows.length} rows
                {result.truncated ? ', above threshold and ranked by |quantile_score|' : ''})
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                {result.scores_digest}
              </pre>
            </details>
          </>
        )}
      </div>
    </details>
  )
}
