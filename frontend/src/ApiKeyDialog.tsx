import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
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

export function ApiKeyDialog({
  apiKey,
  onSave,
}: {
  apiKey: string
  onSave: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(apiKey)

  // Discard unsaved edits from a cancelled run whenever the dialog reopens.
  useEffect(() => {
    if (open) setDraft(apiKey)
  }, [open, apiKey])

  function save() {
    onSave(draft.trim())
    setOpen(false)
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
            . It is stored in this browser and sent only to your backend.
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

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
