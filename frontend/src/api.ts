import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'

// Delays a value's update so dependent effects (e.g. queries) don't refire on every keystroke.
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface OrganismItem {
  label: string
  value: string
  example_variant: string
}

export interface OrganismsResponse {
  organisms: OrganismItem[]
}

export interface HpoTermItem {
  term: string
  definition: string
}

export interface HpoTermsResponse {
  terms: HpoTermItem[]
}

export interface OntologyTermsResponse {
  curie_to_label: Record<string, string>
  display_options: string[]
}

export interface TracksResponse {
  tracks: string[]
  default_selection: string[]
  excluded_from_visualization: string[]
  available_scorers: string[]
}

export interface VariantConfirmation {
  mapped_position: string
  given_ref: string
  actual_ref: string
  message: string
}

export interface NormalizeResponse {
  input: string
  normalized: string
  alternatives: string[]
  message: string | null
  warnings: string[]
  needs_confirmation: boolean
  confirmation: VariantConfirmation | null
}

export type ScoreRow = Record<string, string | number | boolean | null>

export interface ScoreResponse {
  rows: ScoreRow[]
  output_types: string[]
  sort_applied: string[]
}

export interface PlotlyFigure {
  data: unknown[]
  layout: Record<string, unknown>
}

export interface TrackMetadata {
  name?: string
  biosample_name?: string
  strand?: string
  transcription_factor?: string
}

export interface ContinuousTrack {
  type: 'continuous'
  track_name: string
  metadata: TrackMetadata
  interval_start: number
  ref_values: number[]
  alt_values: number[]
}

export interface SashimiJunction {
  start: number
  end: number
  strand: string
  count: number
}

export interface SashimiTrack {
  type: 'sashimi'
  track_name: string
  metadata: TrackMetadata
  ref_junctions: SashimiJunction[]
  alt_junctions: SashimiJunction[]
}

export interface ContactMapTrack {
  type: 'contact_map'
  track_name: string
  metadata: TrackMetadata
  z: number[][]
  coords: number[]
}

export type TrackSpec = ContinuousTrack | SashimiTrack | ContactMapTrack

export interface TranscriptExon {
  start: number
  end: number
}

export interface TranscriptSpec {
  transcript_id: string
  strand: string
  exons: TranscriptExon[]
  cds: TranscriptExon[]
}

export interface TrackIntervalInfo {
  chromosome: string
  start: number
  end: number
}

export interface TrackVariantInfo {
  chromosome: string
  position: number
  reference_bases: string
  alternate_bases: string
  label: string
}

export interface TrackIssue {
  track: string
  reason_code: string
  message: string
}

export interface TrackPlotResponse {
  interval: TrackIntervalInfo
  variant: TrackVariantInfo
  tracks: TrackSpec[]
  transcripts: TranscriptSpec[]
  warnings: TrackIssue[]
  transcript_warning: string | null
}

/** Endpoint config for the experimental AI summary. See `llmSettings.ts`. */
export interface LlmCredentials {
  llm_api_key: string
  llm_base_url: string
  llm_model: string
}

export interface LlmVerifyResponse {
  ok: boolean
  model: string
}

export interface AiSummaryResponse {
  summary: string
  model: string
  /** The flattened score text the backend actually sent to the model. */
  scores_digest: string
  row_count: number
  truncated: boolean
}

interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: TrackIssue[]
  }
}

// ── API client ───────────────────────────────────────────────────────────────

const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:8000'

export class ApiRequestError extends Error {
  code: string
  details?: TrackIssue[]
  constructor(message: string, code = 'error', details?: TrackIssue[]) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.details = details
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    throw new ApiRequestError(
      'Could not reach the backend. Is the API server running?',
      'network_error',
    )
  }

  let body: unknown = null
  const text = await response.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }

  if (!response.ok) {
    const errorBody = body as ApiErrorBody | null
    throw new ApiRequestError(
      errorBody?.error?.message ?? `Request failed (${response.status})`,
      errorBody?.error?.code ?? 'error',
      errorBody?.error?.details,
    )
  }

  return body as T
}

function post<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(payload) })
}

const LOCAL_API_KEY_STORAGE = 'interagt-api-key'

interface StoredApiKeyResponse {
  api_key: string | null
}

const api = {
  getOrganisms: () => request<OrganismsResponse>('/metadata/organisms'),
  getHpoTerms: () => request<HpoTermsResponse>('/metadata/hpo-terms'),
  postOntologyTerms: (apiKey: string, organism: string) =>
    post<OntologyTermsResponse>('/metadata/ontology-terms', {
      api_key: apiKey,
      organism,
    }),
  postTracks: (apiKey: string, organism: string) =>
    post<TracksResponse>('/metadata/tracks', { api_key: apiKey, organism }),
  postNormalize: (variant: string, organism: string) =>
    post<NormalizeResponse>('/variants/normalize', { variant, organism }),
  postScore: (payload: {
    api_key: string
    organism: string
    variant: string
    sequence_length: number
    scorers: string[]
    hpo_terms: string[]
  }) => post<ScoreResponse>('/variants/score', payload),
  postTrackPlot: (payload: {
    api_key: string
    organism: string
    variant: string
    sequence_length: number
    ontology_terms: string[]
    tracks: string[]
  }) => post<TrackPlotResponse>('/plots/tracks', payload),
  getStoredApiKey: () => request<StoredApiKeyResponse>('/keystore/api-key'),
  setStoredApiKey: (apiKey: string) =>
    post<StoredApiKeyResponse>('/keystore/api-key', { api_key: apiKey }),
  postLlmVerify: (payload: LlmCredentials) =>
    post<LlmVerifyResponse>('/ai/verify', payload),
  postAiSummary: (
    payload: LlmCredentials & {
      variant: string
      organism: string
      rows: ScoreRow[]
      hpo_terms: string[]
    },
  ) => post<AiSummaryResponse>('/ai/summary', payload),
}

// ── API key persistence ─────────────────────────────────────────────────────
//
// Packaged (pywebview) builds route through app_launcher.py's OS-keychain
// endpoints. Plain `bun run dev` browser tabs (no app_launcher backend) get
// a 404 from that route and fall back to localStorage, matching the old
// browser-tab behavior.

export async function loadApiKey(): Promise<string> {
  try {
    const res = await api.getStoredApiKey()
    return res.api_key ?? ''
  } catch {
    return localStorage.getItem(LOCAL_API_KEY_STORAGE) ?? ''
  }
}

export async function saveApiKey(key: string): Promise<void> {
  try {
    await api.setStoredApiKey(key)
  } catch {
    localStorage.setItem(LOCAL_API_KEY_STORAGE, key)
  }
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useOrganisms() {
  return useQuery({
    queryKey: ['organisms'],
    queryFn: api.getOrganisms,
    staleTime: Infinity,
  })
}

export function useHpoTerms(enabled: boolean) {
  return useQuery({
    queryKey: ['hpo-terms'],
    queryFn: api.getHpoTerms,
    staleTime: Infinity,
    enabled,
  })
}

export function useOntologyTerms(apiKey: string, organism: string) {
  return useQuery({
    queryKey: ['ontology-terms', organism, apiKey ? 'keyed' : 'empty'],
    queryFn: () => api.postOntologyTerms(apiKey, organism),
    enabled: Boolean(apiKey) && Boolean(organism),
    retry: 1,
    staleTime: 5 * 60 * 1000,
  })
}

export function useTracks(apiKey: string, organism: string) {
  return useQuery({
    queryKey: ['tracks', organism, apiKey ? 'keyed' : 'empty'],
    queryFn: () => api.postTracks(apiKey, organism),
    enabled: Boolean(apiKey) && Boolean(organism),
    retry: 1,
    staleTime: 5 * 60 * 1000,
  })
}

export function useVariantNormalization(
  variant: string,
  organismLabel: string,
) {
  const trimmed = variant.trim()
  const debounced = useDebouncedValue(trimmed, 350)
  const query = useQuery({
    queryKey: ['normalize', debounced, organismLabel],
    queryFn: () => api.postNormalize(debounced, organismLabel),
    enabled: debounced.length > 0 && organismLabel.length > 0,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
  // True while waiting out the debounce or while the request itself is in flight -
  // covers the whole window during which `normalized` may be stale.
  const isValidating = trimmed !== debounced || query.isFetching
  return { ...query, isValidating }
}

export function useVariantScores() {
  return useMutation<
    ScoreResponse,
    Error,
    {
      api_key: string
      organism: string
      variant: string
      sequence_length: number
      scorers: string[]
      hpo_terms: string[]
    }
  >({ mutationFn: (v) => api.postScore(v), retry: false })
}

export function useTrackPlot() {
  return useMutation<
    TrackPlotResponse,
    ApiRequestError,
    {
      api_key: string
      organism: string
      variant: string
      sequence_length: number
      ontology_terms: string[]
      tracks: string[]
    }
  >({ mutationFn: (v) => api.postTrackPlot(v), retry: false })
}

/** One throwaway completion to prove the key, endpoint and model all work. */
export function useVerifyLlm() {
  return useMutation<LlmVerifyResponse, ApiRequestError, LlmCredentials>({
    mutationFn: (v) => api.postLlmVerify(v),
    retry: false,
  })
}

export function useAiSummary() {
  return useMutation<
    AiSummaryResponse,
    ApiRequestError,
    LlmCredentials & {
      variant: string
      organism: string
      rows: ScoreRow[]
      hpo_terms: string[]
    }
  >({ mutationFn: (v) => api.postAiSummary(v), retry: false })
}
