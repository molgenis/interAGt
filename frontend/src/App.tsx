import { useEffect, useState } from 'react'
import { BarChart3, KeyRound, LineChart, Loader2, X } from 'lucide-react'
import {
  useOrganisms,
  useHpoTerms,
  useVariantNormalization,
  useOntologyTerms,
  useTracks,
  useVariantScores,
  useTrackPlot,
  loadApiKey,
  saveApiKey as persistApiKey,
  loadModelVersion,
  saveModelVersion,
  type ApiRequestError,
  type ImputationPolicy,
  type ModelVersion,
  type TrackIssue,
} from '@/api'
import { TRACK_EXPLANATIONS, SCORER_EXPLANATIONS, ALL_RESULTS_EXPLANATION } from '@/trackExplanations'
import { ApiKeyDialog } from '@/ApiKeyDialog'
import { AboutDialog } from '@/AboutDialog'
import { FAQDialog } from '@/FAQDialog'
import { InfoTooltip } from '@/InfoTooltip'
import { ModelSwitch } from '@/ModelSwitch'
import { MultiSelect } from '@/MultiSelect'
import { SeqLengthSelect, type SequenceLength } from '@/SeqLengthSelect'
import { ScoresTable } from '@/ScoresDisplay'
import { ScoresSummaryCharts } from '@/ScoresCharts'
import { ThemeToggle } from '@/ThemeToggle'
import { TrackPlot, DownloadHtmlButton } from '@/TrackDisplay'
import { useTheme } from '@/theme'
import { Button } from '@/ui/button'
import { Label } from '@/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs'
import { Input } from '@/ui/input'
import { CheckList } from '@/CheckList'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { sanitizeVariantForFilename } from '@/DownloadScores'

const DEFAULT_ORGANISM_VALUE = 'HOMO_SAPIENS'
const FALLBACK_ORGANISM_LABEL = 'Human (hg38)'

type Mode = 'scores' | 'tracks'

// AG2 labels every track observed / imputed_supported / imputed_exploratory.
// Many conditions (e.g. single-cell-only cell types) have no measured bulk
// RNA_SEQ/ATAC/CHIP_TF, so the default falls back to supported imputations
// per condition and output type instead of returning nothing.
const IMPUTATION_CHOICES: Record<ImputationPolicy, string> = {
  auto: 'Best available (observed, else supported)',
  observed: 'Observed only',
  supported: 'Observed + supported imputations',
  all: 'All, incl. exploratory imputations',
}

const MAX_CONDITIONS = 10

function curieFromDisplay(display: string): string {
  const open = display.lastIndexOf('(')
  const close = display.lastIndexOf(')')
  if (open === -1 || close === -1 || close < open) return display
  return display.slice(open + 1, close)
}

// Distinguishes an Ensembl/VariantValidator outage (backend code `upstream_failure`)
// from a genuinely invalid variant, so the UI can point the blame elsewhere.
function isUpstreamOutage(error: unknown): boolean {
  return (error as ApiRequestError)?.code === 'upstream_failure'
}

function ErrorNote({
  title,
  message,
  details,
}: {
  title: string
  message: string
  details?: TrackIssue[]
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <div className="font-medium">{title}</div>
      <div className="mt-0.5 text-xs">{message}</div>
      {details && details.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs">
          {details.map((d, i) => (
            <li key={`${d.track}-${i}`}>
              <span className="font-medium">{d.track}:</span> {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function WarningsNote({
  warnings,
  total,
  onDismiss,
}: {
  warnings: TrackIssue[]
  total: number
  onDismiss: () => void
}) {
  return (
    <div
      role="alert"
      className="relative rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 pr-8 text-sm text-amber-700 dark:text-amber-500"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded-sm opacity-70 hover:opacity-100"
      >
        <X className="size-4" />
      </button>
      <div className="font-medium">
        {warnings.length} of {total} track{total === 1 ? '' : 's'} had no data
      </div>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs">
        {warnings.map((w, i) => (
          <li key={`${w.track}-${i}`}>
            <span className="font-medium">{w.track}:</span> {w.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

function NotesNote({
  notes,
  onDismiss,
}: {
  notes: TrackIssue[]
  onDismiss: () => void
}) {
  return (
    <div
      role="status"
      className="relative rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 pr-8 text-sm"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded-sm opacity-70 hover:opacity-100"
      >
        <X className="size-4" />
      </button>
      <div className="font-medium">
        {notes.length} note{notes.length === 1 ? '' : 's'} on the tracks shown
      </div>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
        {notes.map((n, i) => (
          <li key={`${n.track}-${i}`}>
            <span className="font-medium text-foreground">{n.track}:</span> {n.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

function TranscriptWarningNote({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  return (
    <div
      role="alert"
      className="relative rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 pr-8 text-sm text-amber-700 dark:text-amber-500"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded-sm opacity-70 hover:opacity-100"
      >
        <X className="size-4" />
      </button>
      <div className="font-medium">Gene annotation row unavailable</div>
      <p className="mt-0.5 text-xs">{message}</p>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode
  title: string
  hint: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-full bg-muted p-4 text-muted-foreground">
        {icon}
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}

export default function App() {
  const { theme, setTheme, isDark } = useTheme()

  const [apiKey, setApiKey] = useState('')
  const [modelVersion, setModelVersion] = useState<ModelVersion>(loadModelVersion)
  const [imputationChoice, setImputationChoice] = useState<ImputationPolicy>('auto')
  const [mode, setMode] = useState<Mode>('scores')
  const [organismValue, setOrganismValue] = useState(DEFAULT_ORGANISM_VALUE)
  const [variantInput, setVariantInput] = useState('')
  const [selectedAlternative, setSelectedAlternative] = useState<string | null>(
    null,
  )
  const [sequenceLength, setSequenceLength] = useState<SequenceLength>(131072)
  const [selectedScorers, setSelectedScorers] = useState<string[]>(['RNA_SEQ'])
  const [selectedHpoTerms, setSelectedHpoTerms] = useState<string[]>([])
  const [selectedTissues, setSelectedTissues] = useState<string[]>([])
  const [selectedTracks, setSelectedTracks] = useState<string[]>([])
  const [pendingAction, setPendingAction] = useState<Mode | null>(null)
  const [warningsDismissed, setWarningsDismissed] = useState(false)
  const [notesDismissed, setNotesDismissed] = useState(false)
  const [transcriptWarningDismissed, setTranscriptWarningDismissed] = useState(false)

  const organismsQuery = useOrganisms()
  const organisms = organismsQuery.data?.organisms ?? []
  const currentOrganism = organisms.find((o) => o.value === organismValue)
  const organismLabel = currentOrganism?.label ?? FALLBACK_ORGANISM_LABEL
  const isHuman = organismLabel === FALLBACK_ORGANISM_LABEL
  const isAg2 = modelVersion === 'ag2'

  const hpoTermsQuery = useHpoTerms(isHuman)
  const normalizationQuery = useVariantNormalization(variantInput, organismLabel)
  const ontologyQuery = useOntologyTerms(apiKey, organismValue, modelVersion)
  const tracksQuery = useTracks(apiKey, organismValue, modelVersion)

  const scoreMutation = useVariantScores()
  const trackPlotMutation = useTrackPlot()

  function handleModelChange(version: ModelVersion) {
    if (version === modelVersion) return
    setModelVersion(version)
    saveModelVersion(version)
    // Results from the other model would be mislabelled; clear them.
    scoreMutation.reset()
    trackPlotMutation.reset()
  }

  function handleSaveApiKey(key: string) {
    setApiKey(key)
    void persistApiKey(key)
  }

  useEffect(() => {
    let cancelled = false
    loadApiKey().then((key) => {
      if (!cancelled) setApiKey(key)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (currentOrganism) {
      setVariantInput(currentOrganism.example_variant)
      setSelectedAlternative(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganism?.value])

  // Track/scorer sets differ per organism and model (e.g. PROCAP is AG1-only,
  // METHYLATION AG2-only): drop selections the new set doesn't offer.
  useEffect(() => {
    const data = tracksQuery.data
    if (!data) return
    const kept = selectedTracks.filter((t) => data.tracks.includes(t))
    setSelectedTracks(kept.length > 0 ? kept : data.default_selection)
    const keptScorers = selectedScorers.filter((s: string) => data.available_scorers.includes(s))
    setSelectedScorers(
      keptScorers.length > 0 ? keptScorers : data.available_scorers.slice(0, 1),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksQuery.data])

  useEffect(() => {
    if (trackPlotMutation.data) {
      setWarningsDismissed(false)
      setNotesDismissed(false)
      setTranscriptWarningDismissed(false)
    }
  }, [trackPlotMutation.data])

  // AG1 ontology terms and AG2 conditions are different lists.
  useEffect(() => {
    setSelectedTissues([]);
  }, [organismValue, modelVersion]);

  const normalization = normalizationQuery.isValidating
    ? undefined
    : normalizationQuery.data
  const alternatives = normalization?.alternatives ?? []
  const normalizedVariant = selectedAlternative ?? normalization?.normalized ?? ''
  const needsConfirmation = Boolean(normalization?.needs_confirmation)
  const confirmation = normalization?.confirmation ?? null

  const availableScorers = tracksQuery.data?.available_scorers ?? ['RNA_SEQ']
  const excludedTracks = tracksQuery.data?.excluded_from_visualization ?? []
  const visualizationTracks = (tracksQuery.data?.tracks ?? []).filter(
    (t) => !excludedTracks.includes(t),
  )
  const tissueOptions = ontologyQuery.data?.display_options ?? []
  const hpoTerms = hpoTermsQuery.data?.terms ?? []
  const hpoOptions = hpoTerms.map((t) => t.term)
  const hpoDescriptions = Object.fromEntries(
    hpoTerms.map((t) => [t.term, t.definition || 'No definition available.']),
  )

  const canScore =
    Boolean(apiKey) &&
    Boolean(normalizedVariant) &&
    selectedScorers.length > 0 &&
    (!isAg2 || selectedTissues.length > 0) &&
    !scoreMutation.isPending &&
    !normalizationQuery.isValidating
  const canVisualize =
    Boolean(apiKey) &&
    Boolean(normalizedVariant) &&
    selectedTissues.length > 0 &&
    selectedTracks.length > 0 &&
    !trackPlotMutation.isPending &&
    !normalizationQuery.isValidating

  function runScore() {
    scoreMutation.mutate({
      api_key: apiKey,
      organism: organismValue,
      variant: normalizedVariant,
      sequence_length: sequenceLength,
      scorers: selectedScorers,
      hpo_terms: isHuman ? selectedHpoTerms : [],
      model_version: modelVersion,
      conditions: isAg2 ? selectedTissues.map(curieFromDisplay) : [],
      imputation: imputationChoice,
    })
  }

  function runVisualize() {
    trackPlotMutation.mutate({
      api_key: apiKey,
      organism: organismValue,
      variant: normalizedVariant,
      sequence_length: sequenceLength,
      ontology_terms: selectedTissues.map(curieFromDisplay),
      tracks: selectedTracks,
      model_version: modelVersion,
      imputation: imputationChoice,
    })
  }

  // A reference-base mismatch is confirmed before running: open the dialog
  // instead of firing the mutation directly.
  function handleScore() {
    if (needsConfirmation) {
      setPendingAction('scores')
      return
    }
    runScore()
  }

  function handleVisualize() {
    if (needsConfirmation) {
      setPendingAction('tracks')
      return
    }
    runVisualize()
  }

  function confirmProceed() {
    const action = pendingAction
    setPendingAction(null)
    if (action === 'scores') runScore()
    else if (action === 'tracks') runVisualize()
  }

  const scoreData = scoreMutation.data
  const trackPayload = trackPlotMutation.data ?? null
  const trackExplanations = SCORER_EXPLANATIONS

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b px-4 py-3">
        <img src="/logo_interAGt.svg" alt="interAGt" className="h-14" />
        <span className="hidden text-sm text-muted-foreground lg:inline">
          An intuitive interface to AlphaGenome
        </span>
        <div className="ml-auto flex items-center gap-1">
          <div className="mr-3">
            <ModelSwitch value={modelVersion} onChange={handleModelChange} />
          </div>
          <AboutDialog />
          <FAQDialog />
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <ApiKeyDialog apiKey={apiKey} onSave={handleSaveApiKey} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left panel: inputs */}
        <aside className="flex w-[22rem] shrink-0 flex-col overflow-y-auto border-r p-4">
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="mode">Output type</Label>
              <InfoTooltip
                content={
                  <>
                    Scores give a single variant-effect score per gene or
                    track. Tracks plot predicted genomic signal across the
                    region as a curve. Switching swaps both the inputs below
                    and the results panel; each mode keeps its own results
                    until you rerun it.
                  </>
                }
              />
            </div>
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList id="mode" className="grid w-full grid-cols-2">
                <TabsTrigger value="scores">Scores</TabsTrigger>
                <TabsTrigger value="tracks">Tracks</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="mt-4 grid gap-4">
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="organism">Organism</Label>
                <InfoTooltip
                  content={
                    <>
                      Human predictions use the hg38 (GRCh38.p13) genome
                      build; mouse predictions use mm10 (GRCm38.p6). No other
                      species are supported. AlphaGenome is licensed for
                      non-commercial use only; see About.
                    </>
                  }
                />
              </div>
              <Tabs value={organismValue} onValueChange={setOrganismValue}>
                <TabsList id="organism" className="grid w-full grid-cols-2">
                  {organisms.map((o) => (
                    <TabsTrigger key={o.value} value={o.value}>
                      {o.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="variant">Variant</Label>
                <InfoTooltip
                  content={
                    <>
                      Variant notation
                      <br />
                      chrom:pos:ref:alt (human/mouse)
                      <br />
                      Human only: HGVS or rsID
                      <br />
                      Examples: chr1:12345:A:T, NM_001234.5:c.123A&gt;T,
                      rs12345
                    </>
                  }
                />
              </div>
              <Input
                id="variant"
                placeholder="chr:pos:ref:alt, HGVS, or rsID"
                value={variantInput}
                onChange={(e) => {
                  setVariantInput(e.target.value)
                  setSelectedAlternative(null)
                }}
              />
              {normalizationQuery.isError && (
                isUpstreamOutage(normalizationQuery.error) ? (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    Ensembl/VariantValidator looks temporarily unavailable -
                    that's an outage on their end, not this app. Wait and
                    retry, or switch to chr:pos:ref:alt format (e.g.
                    chr1:12345:A:T), which doesn't need that lookup.
                  </p>
                ) : (
                  <p className="text-xs text-destructive">
                    {(normalizationQuery.error as Error).message}
                  </p>
                )
              )}
              {needsConfirmation && confirmation ? (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Reference mismatch at {confirmation.mapped_position}: genome
                  base is {confirmation.actual_ref}, not{' '}
                  {confirmation.given_ref}. You'll be asked to confirm.
                </p>
              ) : (
                normalization?.message && (
                  <p className="text-xs text-muted-foreground break-all">
                    {normalization.message}: {normalizedVariant}
                  </p>
                )
              )}
            </div>

            {alternatives.length > 1 && (
              <div className="grid gap-2">
                <Label htmlFor="alternative">Multiple options for rsID, select one variant</Label>
                <Select
                  value={normalizedVariant}
                  onValueChange={setSelectedAlternative}
                >
                  <SelectTrigger id="alternative">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {alternatives.map((alt) => (
                      <SelectItem key={alt} value={alt}>
                        {alt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="seq-length">Sequence window</Label>
                <InfoTooltip
                  content={
                    <>
                      Length of genomic sequence, centered on the variant. AlphaGenome recommends
                      the full 1 Mb window for the best accuracy. At longer
                      windows, in case AlphaGenome returns some tracks at a coarser
                      native resolution, the app
                      linearly interpolates them to fill the plot, so
                      the curve is smoothed, not per-base prediction.
                    </>
                  }
                />
              </div>
              <SeqLengthSelect
                id="seq-length"
                value={sequenceLength}
                onChange={setSequenceLength}
              />
            </div>
            {!apiKey && (
              <p className="text-xs text-muted-foreground">
                Add an API key to load organism-specific options.
              </p>
            )}

            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Label>Tracks</Label>
                <InfoTooltip
                  content={
                    mode === 'scores' ? (
                      <>
                        Variant-effect scorers to run. Available scorers
                        depend on the selected model and organism.
                        Polyadenylation (and, in AlphaGenome 1, PROCAP)
                        isn't available for Mouse. METHYLATION and the
                        single-cell scorers are AlphaGenome 2 only.
                      </>
                    ) : (
                      <>
                        Genomic signal tracks to plot. Available tracks
                        depend on the selected model and organism. PROCAP is
                        AlphaGenome 1 only (human); METHYLATION and SC_ATAC
                        are AlphaGenome 2 only.
                      </>
                    )
                  }
                />
              </div>
              <CheckList
                options={mode === 'scores' ? availableScorers : visualizationTracks}
                selected={mode === 'scores' ? selectedScorers : selectedTracks}
                onChange={mode === 'scores' ? setSelectedScorers : setSelectedTracks}
                descriptions={mode === 'scores' ? SCORER_EXPLANATIONS : TRACK_EXPLANATIONS}
                {...(mode === 'tracks' && { emptyMessage: 'No tracks available.' })}
              />
            </div>

            {mode === 'scores' && isHuman && (
              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="hpo">HPO terms (optional)</Label>
                  <InfoTooltip
                    content={
                      <>
                        Selecting HPO terms doesn't filter results; it only
                        re-sorts them, prioritizing genes linked to your
                        selected phenotypes first. Hover (or focus) a term
                        for its definition. Very broad terms may match nearly
                        every gene in the window, making the re-sort
                        meaningless.
                      </>
                    }
                  />
                </div>
                <MultiSelect
                  id="hpo"
                  options={hpoOptions}
                  selected={selectedHpoTerms}
                  onChange={setSelectedHpoTerms}
                  placeholder="Search HPO terms…"
                  disabled={hpoOptions.length === 0}
                  descriptions={hpoDescriptions}
                />
              </div>
            )}

            {(mode === 'tracks' || isAg2) && (
              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="tissues">
                    {isAg2 ? 'Conditions' : 'Tissues'} (max. {MAX_CONDITIONS})
                  </Label>
                  <InfoTooltip
                    content={
                      isAg2 ? (
                        <>
                          AlphaGenome 2 predicts for one reference condition
                          at a time, so each condition you add is a separate
                          prediction (and API call). A condition is one
                          ontology term (UBERON tissue, CL cell type, CLO
                          cell line, …) or several joined by "_". Hover an
                          option to see which outputs were measured there and
                          which are imputed. The cap of{' '}
                          {MAX_CONDITIONS} is a UI choice.
                        </>
                      ) : (
                        <>
                          Each option's prefix names its ontology: UBERON
                          (anatomical structure), CL (cell type), CLO (cell
                          line), EFO (assay/experimental context), NTR
                          (not-yet-formalized term). The 10-tissue cap is a UI
                          choice, not an AlphaGenome limit.
                        </>
                      )
                    }
                  />
                </div>
                <MultiSelect
                  id="tissues"
                  options={tissueOptions}
                  selected={selectedTissues}
                  onChange={setSelectedTissues}
                  placeholder={isAg2 ? 'Search & select conditions…' : 'Search & select tissues…'}
                  descriptions={ontologyQuery.data?.descriptions}
                  maxSelected={MAX_CONDITIONS}
                  disabled={tissueOptions.length === 0}
                />
                {ontologyQuery.isError && (
                  <p className="text-xs text-destructive">
                    {(ontologyQuery.error as Error).message}
                  </p>
                )}
              </div>
            )}

            {isAg2 && (
              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="imputation">Imputed tracks</Label>
                  <InfoTooltip
                    content={
                      <>
                        AlphaGenome 2 returns every track for a condition and
                        labels each one: observed (measured in training),
                        imputed_supported (not measured, but reliably
                        imputable) or imputed_exploratory (a hypothesis;
                        use with care). "Best available" shows observed
                        tracks where they exist and otherwise the supported
                        imputations, per condition and track type. Plots
                        show at most 25 tracks per track type and condition,
                        most reliable first.
                      </>
                    }
                  />
                </div>
                <Select
                  value={imputationChoice}
                  onValueChange={(v) => setImputationChoice(v as ImputationPolicy)}
                >
                  <SelectTrigger id="imputation">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(IMPUTATION_CHOICES) as ImputationPolicy[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {IMPUTATION_CHOICES[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="mt-auto grid gap-2 pt-4">
            {mode === 'scores' ? (
              <>
                <Button onClick={handleScore} disabled={!canScore}>
                  {(scoreMutation.isPending || normalizationQuery.isValidating) && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  {scoreMutation.isPending
                    ? 'Scoring…'
                    : normalizationQuery.isValidating
                      ? 'Validating variant…'
                      : 'Get variant scores'}
                </Button>
              </>
            ) : (
              <>
                <Button onClick={handleVisualize} disabled={!canVisualize}>
                  {(trackPlotMutation.isPending || normalizationQuery.isValidating) && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  {trackPlotMutation.isPending
                    ? 'Running model…'
                    : normalizationQuery.isValidating
                      ? 'Validating variant…'
                      : 'Visualize'}
                </Button>
              </>
            )}
          </div>
        </aside>

        {/* Right panel: results */}
        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          {mode === 'scores' ? (
            scoreMutation.isError ? (
              <ErrorNote
                title="Scoring failed"
                message={(scoreMutation.error as Error).message}
              />
            ) : scoreData && scoreData.rows.length > 0 ? (
              <div className="space-y-6">
                <details className="rounded-lg border p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    All results
                  </summary>
                  <div className="mt-4">
                    <p className="mb-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
                      {ALL_RESULTS_EXPLANATION}
                    </p>
                    <ScoresTable
                      rows={scoreData.rows}
                      downloadFileName={`${sanitizeVariantForFilename(selectedAlternative || normalizedVariant)}_variant_scores`}
                    />
                  </div>
                  
                </details>

                <ScoresSummaryCharts
                  rows={scoreData.rows}
                  outputTypes={scoreData.output_types}
                  explanations={trackExplanations}
                  isDark={isDark}
                  fileName={`${sanitizeVariantForFilename(selectedAlternative || normalizedVariant)}_variant_scores_summary.html`}
                />
              </div>
            ) : (
              <EmptyState
                icon={
                  apiKey ? (
                    <BarChart3 className="size-6" />
                  ) : (
                    <KeyRound className="size-6" />
                  )
                }
                title={apiKey ? 'No scores yet' : 'API key required'}
                hint={
                  apiKey
                    ? isAg2
                      ? 'Pick your scorers and conditions, then run “Get variant scores” to see per-condition effects here.'
                      : 'Pick your scorers and run “Get variant scores” to see per-tissue effects here.'
                    : 'Add your AlphaGenome API key from the header to get started.'
                }
              />
            )
          ) : trackPlotMutation.isError ? (
            <ErrorNote
              title="Visualization failed"
              message={(trackPlotMutation.error as ApiRequestError).message}
              details={(trackPlotMutation.error as ApiRequestError).details}
            />
          ) : trackPayload ? (
            <div className="space-y-4">
              {!transcriptWarningDismissed && trackPayload.transcript_warning && (
                <TranscriptWarningNote
                  message={trackPayload.transcript_warning}
                  onDismiss={() => setTranscriptWarningDismissed(true)}
                />
              )}
              {!notesDismissed && (trackPayload.notes?.length ?? 0) > 0 && (
                <NotesNote
                  notes={trackPayload.notes ?? []}
                  onDismiss={() => setNotesDismissed(true)}
                />
              )}
              {!warningsDismissed && trackPayload.warnings.length > 0 && (
                <WarningsNote
                  warnings={trackPayload.warnings}
                  total={
                    selectedTracks.length * (isAg2 ? Math.max(1, selectedTissues.length) : 1)
                  }
                  onDismiss={() => setWarningsDismissed(true)}
                />
              )}
              <div className="rounded-lg border p-6 space-y-4">
                <DownloadHtmlButton
                  fileName={`${normalizedVariant}_tracks.html`}
                  payload={trackPayload}
                />
                <TrackPlot payload={trackPayload} isDark={isDark} />
              </div>
            </div>
          ) : (
            <EmptyState
              icon={
                apiKey ? (
                  <LineChart className="size-6" />
                ) : (
                  <KeyRound className="size-6" />
                )
              }
              title={apiKey ? 'No tracks yet' : 'API key required'}
              hint={
                apiKey
                  ? `Select ${isAg2 ? 'conditions' : 'tissues'} and tracks, then run “Visualize” to render predictions around the variant.`
                  : 'Add your AlphaGenome API key from the header to get started.'
              }
            />
          )}
        </main>
      </div>

      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm reference mismatch</DialogTitle>
            <DialogDescription>
              {confirmation?.message ??
                'The reference base does not match the genome at this position.'}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Mapped position</span>
              <span className="font-mono">{confirmation?.mapped_position}</span>
            </div>
            <div className="mt-1 flex justify-between gap-4">
              <span className="text-muted-foreground">Your reference</span>
              <span className="font-mono">{confirmation?.given_ref}</span>
            </div>
            <div className="mt-1 flex justify-between gap-4">
              <span className="text-muted-foreground">Genome reference</span>
              <span className="font-mono">{confirmation?.actual_ref}</span>
            </div>
            <div className="mt-2 border-t pt-2 flex justify-between gap-4">
              <span className="text-muted-foreground">Will run</span>
              <span className="font-mono">{normalizedVariant}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>
              Cancel
            </Button>
            <Button onClick={confirmProceed}>Proceed with my input</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
