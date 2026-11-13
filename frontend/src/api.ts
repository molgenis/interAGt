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

/** "ag2" = AlphaGenome 2 (default), "ag1" = AlphaGenome 1. */
export type ModelVersion = 'ag1' | 'ag2'
export const DEFAULT_MODEL_VERSION: ModelVersion = 'ag2'

/** AG2 per-track label: measured in training, or imputed by the model. */
export type ImputationMode = 'observed' | 'imputed_supported' | 'imputed_exploratory'

/**
 * AG2: which tracks to keep, per condition and output type.
 * auto = observed where measured, otherwise supported imputations.
 */
export type ImputationPolicy = 'auto' | 'observed' | 'supported' | 'all'

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
  /** AG2: display option -> which outputs are observed/imputed there. */
  descriptions?: Record<string, string>
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
  /** AG2 only. */
  imputation_mode?: ImputationMode
  /** AG2 only: the reference condition this track was predicted for. */
  condition?: string
  condition_label?: string
  biosample_curie?: string
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
  /** Tracks shown with a caveat (imputed fallback, capped track count). */
  notes?: TrackIssue[]
  transcript_warning: string | null
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
const LOCAL_MODEL_VERSION_STORAGE = 'interagt-model-version'

export interface ScorePayload {
  api_key: string
  organism: string
  variant: string
  sequence_length: number
  scorers: string[]
  hpo_terms: string[]
  model_version: ModelVersion
  conditions: string[]
  imputation: ImputationPolicy
}

export interface TrackPlotPayload {
  api_key: string
  organism: string
  variant: string
  sequence_length: number
  ontology_terms: string[]
  tracks: string[]
  model_version: ModelVersion
  imputation: ImputationPolicy
}

interface StoredApiKeyResponse {
  api_key: string | null
}

const api = {
  getOrganisms: () => request<OrganismsResponse>('/metadata/organisms'),
  getHpoTerms: () => request<HpoTermsResponse>('/metadata/hpo-terms'),
  postOntologyTerms: (apiKey: string, organism: string, modelVersion: ModelVersion) =>
    post<OntologyTermsResponse>('/metadata/ontology-terms', {
      api_key: apiKey,
      organism,
      model_version: modelVersion,
    }),
  postTracks: (apiKey: string, organism: string, modelVersion: ModelVersion) =>
    post<TracksResponse>('/metadata/tracks', {
      api_key: apiKey,
      organism,
      model_version: modelVersion,
    }),
  postNormalize: (variant: string, organism: string) =>
    post<NormalizeResponse>('/variants/normalize', { variant, organism }),
  postScore: (payload: ScorePayload) =>
    post<ScoreResponse>('/variants/score', payload),
  postTrackPlot: (payload: TrackPlotPayload) =>
    post<TrackPlotResponse>('/plots/tracks', payload),
  getStoredApiKey: () => request<StoredApiKeyResponse>('/keystore/api-key'),
  setStoredApiKey: (apiKey: string) =>
    post<StoredApiKeyResponse>('/keystore/api-key', { api_key: apiKey }),
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

// ── Model version persistence ───────────────────────────────────────────────

export function loadModelVersion(): ModelVersion {
  try {
    const stored = localStorage.getItem(LOCAL_MODEL_VERSION_STORAGE)
    return stored === 'ag1' || stored === 'ag2' ? stored : DEFAULT_MODEL_VERSION
  } catch {
    return DEFAULT_MODEL_VERSION
  }
}

export function saveModelVersion(version: ModelVersion): void {
  try {
    localStorage.setItem(LOCAL_MODEL_VERSION_STORAGE, version)
  } catch {
    // Storage unavailable (e.g. private mode): the choice lasts this session.
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

export function useOntologyTerms(
  apiKey: string,
  organism: string,
  modelVersion: ModelVersion,
) {
  return useQuery({
    queryKey: ['ontology-terms', modelVersion, organism, apiKey ? 'keyed' : 'empty'],
    queryFn: () => api.postOntologyTerms(apiKey, organism, modelVersion),
    enabled: Boolean(apiKey) && Boolean(organism),
    retry: 1,
    staleTime: 5 * 60 * 1000,
  })
}

export function useTracks(apiKey: string, organism: string, modelVersion: ModelVersion) {
  return useQuery({
    queryKey: ['tracks', modelVersion, organism, apiKey ? 'keyed' : 'empty'],
    queryFn: () => api.postTracks(apiKey, organism, modelVersion),
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
  return useMutation<ScoreResponse, Error, ScorePayload>({ mutationFn: (v) => api.postScore(v), retry: false })
}

export function useTrackPlot() {
  return useMutation<TrackPlotResponse, ApiRequestError, TrackPlotPayload>({ mutationFn: (v) => api.postTrackPlot(v), retry: false })
}
