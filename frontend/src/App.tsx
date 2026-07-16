import { useState, useEffect } from 'react'
import {
  useOrganisms,
  useTrackExplanations,
  useHpoTerms,
  useVariantNormalization,
  useOntologyTerms,
  useTracks,
  useVariantScores,
  useTrackPlot,
} from '@/api'
import { MultiSelect } from '@/MultiSelect'
import { SeqLengthSelect, type SequenceLength } from '@/SeqLengthSelect'
import { ScoresTable, ScoresSummaryCharts } from '@/ScoresDisplay'
import { TrackPlot, DownloadHtmlButton } from '@/TrackDisplay'

const DEFAULT_ORGANISM_VALUE = 'HOMO_SAPIENS'
const FALLBACK_ORGANISM_LABEL = 'Human (hg38)'

const INPUT =
  'flex h-9 w-full rounded-lg border border-border bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
const BTN =
  'rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-50'

function curieFromDisplay(display: string): string {
  const open = display.lastIndexOf('(')
  const close = display.lastIndexOf(')')
  if (open === -1 || close === -1 || close < open) return display
  return display.slice(open + 1, close)
}

export default function App() {
  const [apiKey, setApiKey] = useState('')
  const [organismValue, setOrganismValue] = useState(DEFAULT_ORGANISM_VALUE)
  const [variantInput, setVariantInput] = useState('')
  const [selectedAlternative, setSelectedAlternative] = useState<string | null>(
    null,
  )
  const [sequenceLength, setSequenceLength] =
    useState<SequenceLength>(131072)
  const [selectedScorers, setSelectedScorers] = useState<string[]>(['RNA_SEQ'])
  const [selectedHpoTerms, setSelectedHpoTerms] = useState<string[]>([])
  const [selectedTissues, setSelectedTissues] = useState<string[]>([])
  const [selectedTracks, setSelectedTracks] = useState<string[]>([])

  const organismsQuery = useOrganisms()
  const organisms = organismsQuery.data?.organisms ?? []
  const currentOrganism = organisms.find((o) => o.value === organismValue)
  const organismLabel = currentOrganism?.label ?? FALLBACK_ORGANISM_LABEL
  const isHuman = organismLabel === FALLBACK_ORGANISM_LABEL

  const trackExplanationsQuery = useTrackExplanations()
  const hpoTermsQuery = useHpoTerms(isHuman)
  const normalizationQuery = useVariantNormalization(variantInput, organismLabel)
  const ontologyQuery = useOntologyTerms(apiKey, organismValue)
  const tracksQuery = useTracks(apiKey, organismValue)

  const scoreMutation = useVariantScores()
  const trackPlotMutation = useTrackPlot()

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
  const normalizedVariant =
    selectedAlternative ?? normalization?.normalized ?? ''

  const availableScorers = tracksQuery.data?.available_scorers ?? ['RNA_SEQ']
  const excludedTracks = tracksQuery.data?.excluded_from_visualization ?? []
  const visualizationTracks = (tracksQuery.data?.tracks ?? []).filter(
    (t) => !excludedTracks.includes(t),
  )
  const tissueOptions = ontologyQuery.data?.display_options ?? []
  const hpoOptions = hpoTermsQuery.data?.terms ?? []

  const canScore =
    Boolean(apiKey) && Boolean(normalizedVariant) && !scoreMutation.isPending
  const canVisualize =
    Boolean(apiKey) &&
    selectedTissues.length > 0 &&
    selectedTracks.length > 0 &&
    !trackPlotMutation.isPending

  function handleScore() {
    scoreMutation.mutate({
      api_key: apiKey,
      organism: organismValue,
      variant: normalizedVariant,
      sequence_length: sequenceLength,
      scorers: selectedScorers,
      hpo_terms: isHuman ? selectedHpoTerms : [],
    })
  }

  function handleVisualize() {
    trackPlotMutation.mutate({
      api_key: apiKey,
      organism: organismValue,
      variant: normalizedVariant,
      sequence_length: sequenceLength,
      ontology_terms: selectedTissues.map(curieFromDisplay),
      tracks: selectedTracks,
    })
  }

  const scoreData = scoreMutation.data
  const trackPayload = trackPlotMutation.data ?? null
  const trackExplanations = trackExplanationsQuery.data

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 py-8">
          <img src="/logo_interAGt.svg" alt="interAGt" className="h-16" />
          <p className="max-w-3xl text-center text-sm text-muted-foreground">
            An intuitive interface to <strong>AlphaGenome</strong> (Avsec et
            al., 2026), Google DeepMind&apos;s unified deep learning model for
            interpreting the functional impact of genetic variants on gene
            regulation.
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-10">
        {/* Section 1: Parameters */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold text-foreground">
              Model parameters
            </h2>
            <p className="text-sm text-muted-foreground">
              Provide your AlphaGenome API key and describe the variant to
              analyze.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="p-6 grid gap-6">
              <div className="grid gap-2">
                <label htmlFor="api-key" className="text-sm font-medium">
                  AlphaGenome API key
                </label>
                <input
                  id="api-key"
                  type="password"
                  autoComplete="off"
                  placeholder="Enter API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className={INPUT}
                />
                <p className="text-xs text-muted-foreground">
                  Uses the free, non-commercial AlphaGenome API. A key is
                  required and can be obtained from{' '}
                  <a
                    href="https://deepmind.google.com/science/alphagenome/account/terms"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google DeepMind
                  </a>
                  .
                </p>
              </div>

              <div className="grid gap-2 sm:max-w-xs">
                <label htmlFor="organism" className="text-sm font-medium">
                  Organism
                </label>
                <select
                  id="organism"
                  value={organismValue}
                  onChange={(e) => setOrganismValue(e.target.value)}
                  className={INPUT}
                >
                  {organisms.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <label htmlFor="variant" className="text-sm font-medium">
                  Variant ({organismLabel})
                </label>
                <input
                  id="variant"
                  placeholder="chr:pos:ref:alt or rsID"
                  value={variantInput}
                  onChange={(e) => {
                    setVariantInput(e.target.value)
                    setSelectedAlternative(null)
                  }}
                  className={INPUT}
                />
                {normalizationQuery.isError && (
                  <p className="text-xs text-destructive">
                    {(normalizationQuery.error as Error).message}
                  </p>
                )}
                {normalization?.message && (
                  <p className="text-xs text-muted-foreground">
                    {normalization.message}: {normalizedVariant}
                  </p>
                )}
              </div>

              {alternatives.length > 1 && (
                <div className="grid gap-2 sm:max-w-md">
                  <label htmlFor="alternative" className="text-sm font-medium">
                    Multiple options available; select a single variant
                  </label>
                  <select
                    id="alternative"
                    value={normalizedVariant}
                    onChange={(e) => setSelectedAlternative(e.target.value)}
                    className={INPUT}
                  >
                    {alternatives.map((alt) => (
                      <option key={alt} value={alt}>
                        {alt}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid gap-2">
                <label className="text-sm font-medium">
                  Sequence window (bp)
                </label>
                <SeqLengthSelect
                  value={sequenceLength}
                  onChange={setSequenceLength}
                />
                <p className="text-xs text-muted-foreground">
                  The amount of sequence context around the variant used for
                  prediction.
                </p>
              </div>

              {isHuman && (
                <div className="grid gap-2">
                  <label className="text-sm font-medium">
                    HPO terms (optional)
                  </label>
                  <MultiSelect
                    options={hpoOptions}
                    selected={selectedHpoTerms}
                    onChange={setSelectedHpoTerms}
                    placeholder="Search HPO terms…"
                    disabled={hpoOptions.length === 0}
                  />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Section 2: Variant scores */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold text-foreground">
              Variant scores
            </h2>
            <p className="text-sm text-muted-foreground">
              Score the variant across selected AlphaGenome output types.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="p-6 grid gap-6">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Variant scorers</label>
                <MultiSelect
                  options={availableScorers}
                  selected={selectedScorers}
                  onChange={setSelectedScorers}
                  placeholder="Select scorers…"
                  searchable={false}
                />
                {!apiKey && (
                  <p className="text-xs text-muted-foreground">
                    Enter an API key to load organism-specific scorers.
                  </p>
                )}
              </div>

              <div>
                <button
                  onClick={handleScore}
                  disabled={!canScore || selectedScorers.length === 0}
                  className={BTN}
                >
                  {scoreMutation.isPending ? 'Scoring…' : 'Get variant scores'}
                </button>
              </div>

              {scoreMutation.isError && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  <div className="mb-1 font-medium">Scoring failed</div>
                  <div className="text-sm">
                    {(scoreMutation.error as Error).message}
                  </div>
                </div>
              )}
            </div>
          </div>

          {scoreData && scoreData.rows.length > 0 && (
            <div className="space-y-6">
              <details className="rounded-lg border border-border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  All results
                </summary>
                <div className="mt-4">
                  {trackExplanations?.scores && (
                    <div
                      role="alert"
                      className="mb-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
                    >
                      {trackExplanations.scores}
                    </div>
                  )}
                  <ScoresTable rows={scoreData.rows} />
                </div>
              </details>

              <ScoresSummaryCharts
                rows={scoreData.rows}
                outputTypes={scoreData.output_types}
                explanations={trackExplanations}
              />
            </div>
          )}
        </section>

        {/* Section 3: Visualize tracks */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold text-foreground">
              Visualize tracks
            </h2>
            <p className="text-sm text-muted-foreground">
              Render AlphaGenome track predictions around the variant.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="p-6 grid gap-6">
              <div className="grid gap-2">
                <label className="text-sm font-medium">
                  Tissues (max. 10)
                </label>
                <MultiSelect
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

              <div className="grid gap-2">
                <label className="text-sm font-medium">Tracks</label>
                <MultiSelect
                  options={visualizationTracks}
                  selected={selectedTracks}
                  onChange={setSelectedTracks}
                  placeholder="Search & select tracks…"
                  disabled={visualizationTracks.length === 0}
                />
              </div>

              <div>
                <button
                  onClick={handleVisualize}
                  disabled={!canVisualize}
                  className={BTN}
                >
                  {trackPlotMutation.isPending ? 'Running model…' : 'Visualize'}
                </button>
              </div>

              {trackPlotMutation.isError && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  <div className="mb-1 font-medium">Visualization failed</div>
                  <div className="text-sm">
                    {(trackPlotMutation.error as Error).message}
                  </div>
                </div>
              )}
            </div>
          </div>

          {trackPayload && (
            <div className="space-y-4">
              <TrackPlot payload={trackPayload} />
              <DownloadHtmlButton
                fileName={`${normalizedVariant}_tracks.html`}
                payload={trackPayload}
              />
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
