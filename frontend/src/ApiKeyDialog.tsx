import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react'
import { useVerifyLlm, type ApiRequestError } from '@/api'
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  type LlmSettings,
} from '@/llmSettings'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/dialog'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Separator } from '@/ui/separator'

export function ApiKeyDialog({
  apiKey,
  llm,
  onSave,
  onSaveLlm,
}: {
  apiKey: string
  llm: LlmSettings
  onSave: (key: string) => void
  onSaveLlm: (settings: LlmSettings) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(apiKey)
  const [llmKeyDraft, setLlmKeyDraft] = useState(llm.apiKey)
  const [llmUrlDraft, setLlmUrlDraft] = useState(llm.baseUrl)
  const [llmModelDraft, setLlmModelDraft] = useState(llm.model)

  const verifyLlm = useVerifyLlm()

  // Discard unsaved edits from a cancelled run whenever the dialog reopens.
  // Depends on the individual fields, not the `llm` object: a fresh object on
  // every save would re-run this and clear the verification error mid-edit.
  useEffect(() => {
    if (!open) return
    setDraft(apiKey)
    setLlmKeyDraft(llm.apiKey)
    setLlmUrlDraft(llm.baseUrl)
    setLlmModelDraft(llm.model)
    verifyLlm.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, apiKey, llm.apiKey, llm.baseUrl, llm.model])

  const trimmedLlm = {
    apiKey: llmKeyDraft.trim(),
    baseUrl: llmUrlDraft.trim() || DEFAULT_LLM_BASE_URL,
    model: llmModelDraft.trim() || DEFAULT_LLM_MODEL,
  }
  const llmUnchanged =
    llm.verified &&
    trimmedLlm.apiKey === llm.apiKey &&
    trimmedLlm.baseUrl === llm.baseUrl &&
    trimmedLlm.model === llm.model

  async function save() {
    onSave(draft.trim())

    // No LLM key means the feature is switched off; nothing to verify.
    if (!trimmedLlm.apiKey) {
      onSaveLlm({ ...trimmedLlm, verified: false })
      setOpen(false)
      return
    }

    if (llmUnchanged) {
      setOpen(false)
      return
    }

    // The AI summary button renders on `verified`, so the settings are only
    // stored once the endpoint has actually accepted this key and model. A
    // failed check persists nothing — it leaves any previously working config
    // intact and holds the dialog open on the error.
    try {
      await verifyLlm.mutateAsync({
        llm_api_key: trimmedLlm.apiKey,
        llm_base_url: trimmedLlm.baseUrl,
        llm_model: trimmedLlm.model,
      })
      onSaveLlm({ ...trimmedLlm, verified: true })
      setOpen(false)
    } catch {
      // The error renders from `verifyLlm.error`; nothing else to do.
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={apiKey ? 'outline' : 'default'} size="sm">
          <KeyRound className="size-4" />
          API Key
          {apiKey && (
            <span
              aria-label="API key set"
              className="ml-1 size-1.5 rounded-full bg-emerald-500"
            />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>AlphaGenome API key</DialogTitle>
          <DialogDescription>
            Required to score variants and load tracks. Get a free
            non-commercial key from{' '}
            <a
              href="https://deepmind.google.com/science/alphagenome/account/terms"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-4"
            >
              Google DeepMind
            </a>
            . It is stored securely on this device (the OS keychain in the
            desktop app, this browser otherwise) and sent only to your
            backend.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="api-key">API key</Label>
          <Input
            id="api-key"
            type="password"
            autoComplete="off"
            placeholder="Enter API key"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>

        <Separator />

        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="llm-key">LLM API key</Label>
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-500">
              Optional · Experimental
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Enables an AI-written summary of your variant scores. Works with any
            OpenAI-compatible chat-completions endpoint. Your scores and the
            variant are sent to that provider.
          </p>
          <Input
            id="llm-key"
            type="password"
            autoComplete="off"
            placeholder="Leave empty to disable AI summaries"
            value={llmKeyDraft}
            onChange={(e) => setLlmKeyDraft(e.target.value)}
          />

          <Label htmlFor="llm-url" className="mt-1">
            Base URL
          </Label>
          <Input
            id="llm-url"
            autoComplete="off"
            placeholder={DEFAULT_LLM_BASE_URL}
            value={llmUrlDraft}
            onChange={(e) => setLlmUrlDraft(e.target.value)}
          />

          <Label htmlFor="llm-model" className="mt-1">
            Model
          </Label>
          <Input
            id="llm-model"
            autoComplete="off"
            placeholder={DEFAULT_LLM_MODEL}
            value={llmModelDraft}
            onChange={(e) => setLlmModelDraft(e.target.value)}
          />

          {verifyLlm.isError && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {(verifyLlm.error as ApiRequestError).message}
            </p>
          )}
          {llmUnchanged && !verifyLlm.isError && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-500">
              <CheckCircle2 className="size-3.5" />
              Verified — AI summaries are enabled.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={verifyLlm.isPending}>
            {verifyLlm.isPending && (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            )}
            {verifyLlm.isPending ? 'Checking LLM…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
