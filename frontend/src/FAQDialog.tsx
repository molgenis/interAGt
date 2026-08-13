import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/dialog'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/ui/accordion'

const FAQ_ITEMS = [
  {
    question: 'Where does my API key go, and is it safe to enter?',
    answer: [
      "Your key is stored securely on your own device, never in a database or on disk on the server: in the desktop app it's kept in your OS keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux), and in a browser tab it's kept in that browser. It's sent along with each prediction request to authenticate you with AlphaGenome, and it's never logged or shared.",
      'You can change or clear it any time from the key icon in the header.',
    ],
  },
  {
    question:
      'Which ontology terms (UBERON/CL/CLO/EFO) are supported by which tracks?',
    answer: [
      'It depends on the biosample behind each track, not the assay itself:',
      'RNA-seq and splice-site usage/junction tracks are mostly bulk-tissue data, so they lean UBERON.',
      'Transcription-factor ChIP-seq (~89%) and contact maps (almost all) are cell-line assays, so they lean EFO.',
      'CLO only shows up as a small, largely legacy overlap with EFO in ATAC-seq and DNase tracks.',
      "Donor/acceptor splice-site probability tracks carry no ontology term at all: they're strand-level, not tied to a specific biosample. NTR marks biosamples that don't yet have a formal term assigned.",
      'Mouse (mm10) follows the same pattern, except it has no CLO tracks and splits contact maps evenly between CL and EFO.',
      "If you pick a tissue/biosample and track combination that isn't actually supported, the AlphaGenome API call for that track will fail; you'll see a clear warning or error explaining the limitation rather than a silent gap.",
    ],
  },
  {
    question: 'Do HPO phenotype terms and UBERON/CL/CLO/EFO tissue terms interact?',
    answer: [
      "No, they're independent and don't reference each other.",
      'HPO terms map to a gene list and only reorder the Scores results table, moving phenotype-matching genes to the top. They never change what gets computed.',
      'UBERON/CL/CLO/EFO terms only control which biosample tracks get plotted for visualization.',
      "Picking one won't filter or suggest the other; set each independently if you want both applied.",
    ],
  },
  {
    question:
      'I got an "Ensembl API error" or "VariantValidator error" (503, timeout) - is the app broken?',
    answer: [
      "No. rsID and HGVS variant input are resolved by calling Ensembl's REST API (and VariantValidator for HGVS), both third-party services outside this app's control. A 503, \"Service Unavailable\", or timeout means their service is down or overloaded, not this app.",
      'Two options: wait a bit and retry, or switch to chr:pos:ref:alt notation (e.g. chr1:12345:A:T) - that format skips the external lookup entirely, so it keeps working during an Ensembl/VariantValidator outage.',
    ],
  },
]

export function FAQDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <HelpCircle className="size-4" />
          FAQ
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Frequently asked questions</DialogTitle>
          <DialogDescription>
            Quick answers about using interAGt. For licensing, model caveats,
            and citations, see About.
          </DialogDescription>
        </DialogHeader>

        <Accordion type="single" collapsible className="text-sm">
          {FAQ_ITEMS.map((item) => (
            <AccordionItem key={item.question} value={item.question}>
              <AccordionTrigger>{item.question}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground space-y-2">
                {item.answer.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </DialogContent>
    </Dialog>
  )
}