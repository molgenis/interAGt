import { useEffect, useState } from 'react'
import { BarChart3, Download, KeyRound, LineChart, Loader2 } from 'lucide-react'
import {
  useOrganisms,
  useHpoTerms,
  useVariantNormalization,
  useOntologyTerms,
  useTracks,
  useVariantScores,
  useTrackPlot,
} from '@/api'
import { TRACK_EXPLANATIONS, SCORER_EXPLANATIONS } from '@/trackExplanations'
import { ApiKeyDialog } from '@/ApiKeyDialog'
import { AboutDialog } from '@/AboutDialog'
import { InfoTooltip } from '@/InfoTooltip'
import { MultiSelect } from '@/MultiSelect'
import { SeqLengthSelect, type SequenceLength } from '@/SeqLengthSelect'
import { ScoresTable, ScoresSummaryCharts } from '@/ScoresDisplay'
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
import { downloadAsCSV, sanitizeVariantForFilename } from '@/DownloadScores'

const DEFAULT_ORGANISM_VALUE = 'HOMO_SAPIENS'
const FALLBACK_ORGANISM_LABEL = 'Human (hg38)'
const API_KEY_STORAGE = 'interagt-api-key'

type Mode = 'scores' | 'tracks'

function curieFromDisplay(display: string): string {
  const open = display.lastIndexOf('(')
  const close = display.lastIndexOf(')')
  if (open === -1 || close === -1 || close < open) return display
  return display.slice(open + 1, close)
}

function ErrorNote({ title, message }: { title: string; message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <div className="font-medium">{title}</div>
      <div className="mt-0.5 text-xs">{message}</div>
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

  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem(API_KEY_STORAGE) ?? '',
  )
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

  const organismsQuery = useOrganisms()
  const organisms = organismsQuery.data?.organisms ?? []
  const currentOrganism = organisms.find((o) => o.value === organismValue)
  const organismLabel = currentOrganism?.label ?? FALLBACK_ORGANISM_LABEL
  const isHuman = organismLabel === FALLBACK_ORGANISM_LABEL

  const hpoTermsQuery = useHpoTerms(isHuman)
  const normalizationQuery = useVariantNormalization(variantInput, organismLabel)
  const ontologyQuery = useOntologyTerms(apiKey, organismValue)
  const tracksQuery = useTracks(apiKey, organismValue)

  const scoreMutation = useVariantScores()
  const trackPlotMutation = useTrackPlot()

  function saveApiKey(key: string) {
    localStorage.setItem(API_KEY_STORAGE, key)
    setApiKey(key)
  }

  useEffect(() => {
    if (currentOrganism) {
      setVariantInput(currentOrganism.example_variant)
      setSelectedAlternative(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganism?.value])

  useEffect(() => {
    if (tracksQuery.data && selectedTracks.length === 0) {
      setSelectedTracks(tracksQuery.data.default_selection)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksQuery.data])

  const normalization = normalizationQuery.data
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
    !scoreMutation.isPending
  const canVisualize =
    Boolean(apiKey) &&
    Boolean(normalizedVariant) &&
    selectedTissues.length > 0 &&
    selectedTracks.length > 0 &&
    !trackPlotMutation.isPending

  function runScore() {
    scoreMutation.mutate({
      api_key: apiKey,
      organism: organismValue,
      variant: normalizedVariant,
      sequence_length: sequenceLength,
      scorers: selectedScorers,
      hpo_terms: isHuman ? selectedHpoTerms : [],
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
  const trackExplanations = TRACK_EXPLANATIONS

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b px-4 py-3">
        <img src="/logo_interAGt.svg" alt="interAGt" className="h-12" />
        <span className="hidden text-sm text-muted-foreground lg:inline">
          An intuitive interface to AlphaGenome
        </span>
        <div className="ml-auto flex items-center gap-1">
          <AboutDialog />
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <ApiKeyDialog apiKey={apiKey} onSave={saveApiKey} />
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
                <p className="text-xs text-destructive">
                  {(normalizationQuery.error as Error).message}
                </p>
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
                      Length of genomic sequence, centered on the variant,
                      given to the model as input. Longer windows capture
                      more distal regulatory context. AlphaGenome recommends
                      the full 1 Mb window for the best accuracy.
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
              <Label>Tracks</Label>
              <CheckList
                options={mode === 'scores' ? availableScorers : visualizationTracks}
                selected={mode === 'scores' ? selectedScorers : selectedTracks}
                onChange={mode === 'scores' ? setSelectedScorers : setSelectedTracks}
                descriptions={mode === 'scores' ? SCORER_EXPLANATIONS : TRACK_EXPLANATIONS}
                {...(mode === 'tracks' && { emptyMessage: 'No tracks available.' })}
              />
              {mode === 'scores' && !isHuman && (
                <p className="text-xs text-muted-foreground">
                  Polyadenylation scoring is human-only and hidden for Mouse.
                </p>
              )}
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
                        for its definition.
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

            {mode === 'tracks' && (
              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="tissues">Tissues (max. 10)</Label>
                  <InfoTooltip
                    content={
                      <>
                        Each option's prefix names its ontology: UBERON
                        (anatomical structure), CL (cell type), CLO (cell
                        line), EFO (assay/experimental context), NTR
                        (not-yet-formalized term). The 10-tissue cap is a UI
                        choice, not an AlphaGenome limit.
                      </>
                    }
                  />
                </div>
                <MultiSelect
                  id="tissues"
                  options={tissueOptions}
                  selected={selectedTissues}
                  onChange={setSelectedTissues}
                  placeholder="Search & select tissues…"
                  maxSelected={10}
                  disabled={tissueOptions.length === 0}
                />
                {ontologyQuery.isError && (
                  <p className="text-xs text-destructive">
                    {(ontologyQuery.error as Error).message}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="mt-auto grid gap-2 pt-4">
            {mode === 'scores' ? (
              <>
                <Button onClick={handleScore} disabled={!canScore}>
                  {scoreMutation.isPending && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  {scoreMutation.isPending ? 'Scoring…' : 'Get variant scores'}
                </Button>

                {scoreMutation.isError && (
                  <ErrorNote
                    title="Scoring failed"
                    message={(scoreMutation.error as Error).message}
                  />
                )}
              </>
            ) : (
              <>
                <Button onClick={handleVisualize} disabled={!canVisualize}>
                  {trackPlotMutation.isPending && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  {trackPlotMutation.isPending ? 'Running model…' : 'Visualize'}
                </Button>

                {trackPlotMutation.isError && (
                  <ErrorNote
                    title="Visualization failed"
                    message={(trackPlotMutation.error as Error).message}
                  />
                )}
              </>
            )}
          </div>
        </aside>

        {/* Right panel: results */}
        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          {mode === 'scores' ? (
            scoreData && scoreData.rows.length > 0 ? (
              <div className="space-y-6">
                <details className="rounded-lg border p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    All results
                  </summary>
                  <div className="mt-4">
                    {trackExplanations?.scores && (
                      <p className="mb-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
                        {trackExplanations.scores}
                      </p>
                    )}
                    <div className="pb-3">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const variantName = selectedAlternative || normalizedVariant;
                          const sanitizedVariant = sanitizeVariantForFilename(variantName);
                          downloadAsCSV(scoreData.rows, `${sanitizedVariant}_variant_scores`);
                        }}
                        >
                      <Download className="size-4" />
                      Download results (CSV)
                    </Button>
                  </div>
                    <ScoresTable rows={scoreData.rows} />
                  </div>
                  
                </details>

                <ScoresSummaryCharts
                  rows={scoreData.rows}
                  outputTypes={scoreData.output_types}
                  explanations={trackExplanations}
                  isDark={isDark}
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
                    ? 'Pick your scorers and run “Get variant scores” to see per-tissue effects here.'
                    : 'Add your AlphaGenome API key from the header to get started.'
                }
              />
            )
          ) : trackPayload ? (
            <div className="rounded-lg border p-6 space-y-4">
              <DownloadHtmlButton
                fileName={`${normalizedVariant}_tracks.html`}
                payload={trackPayload}
              />
              <TrackPlot payload={trackPayload} isDark={isDark} />
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
                  ? 'Select tissues and tracks, then run “Visualize” to render predictions around the variant.'
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
