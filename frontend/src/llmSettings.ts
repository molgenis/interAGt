// Optional LLM configuration for the experimental AI summary. Persisted to
// localStorage next to the AlphaGenome key and sent in the request body, never
// read from the environment.
//
// Defaults mirror `DEFAULT_LLM_BASE_URL` / `DEFAULT_LLM_MODEL` in
// `backend/core.py` — update both together. Any OpenAI-compatible
// chat-completions endpoint works.

export const LLM_SETTINGS_STORAGE = 'interagt-llm-settings'
export const DEFAULT_LLM_BASE_URL = 'https://api.mistral.ai/v1'
export const DEFAULT_LLM_MODEL = 'mistral-large-latest'

export interface LlmSettings {
  apiKey: string
  baseUrl: string
  model: string
  /**
   * True only after `/ai/verify` accepted this exact key + URL + model. The AI
   * summary button renders on this flag, so it has to be cleared whenever any
   * of the three fields changes.
   */
  verified: boolean
}

export const EMPTY_LLM_SETTINGS: LlmSettings = {
  apiKey: '',
  baseUrl: DEFAULT_LLM_BASE_URL,
  model: DEFAULT_LLM_MODEL,
  verified: false,
}

export function loadLlmSettings(): LlmSettings {
  const raw = localStorage.getItem(LLM_SETTINGS_STORAGE)
  if (!raw) return EMPTY_LLM_SETTINGS

  try {
    const parsed = JSON.parse(raw) as Partial<LlmSettings>
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      baseUrl:
        typeof parsed.baseUrl === 'string' && parsed.baseUrl
          ? parsed.baseUrl
          : DEFAULT_LLM_BASE_URL,
      model:
        typeof parsed.model === 'string' && parsed.model
          ? parsed.model
          : DEFAULT_LLM_MODEL,
      verified: parsed.verified === true,
    }
  } catch {
    return EMPTY_LLM_SETTINGS
  }
}

export function saveLlmSettings(settings: LlmSettings) {
  localStorage.setItem(LLM_SETTINGS_STORAGE, JSON.stringify(settings))
}

/** Whether the AI summary feature should be offered at all. */
export function isLlmReady(settings: LlmSettings): boolean {
  return (
    settings.verified &&
    settings.apiKey.length > 0 &&
    settings.baseUrl.length > 0 &&
    settings.model.length > 0
  )
}
