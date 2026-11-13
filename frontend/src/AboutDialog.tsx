import { useState } from 'react'
import { Info } from 'lucide-react'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/dialog'
import { Separator } from '@/ui/separator'

export function AboutDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Info className="size-4" />
          About
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>About InterAGt</DialogTitle>
          <DialogDescription>
            An intuitive interface to{' '}
            <a
              href="https://www.alphagenomedocs.com"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-4"
            >
              AlphaGenome
            </a>
            , Google DeepMind's model for predicting the regulatory effects of
            DNA variants.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <section>
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-foreground">
              <strong>For research use only.</strong> Per Google DeepMind's
              official guidance, AlphaGenome's predictions "are intended only
              for research use and haven't been designed or validated for
              direct clinical purposes." Not for personal genome prediction,
              diagnosis, or clinical decision-making.
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="font-medium">Licensing</h3>
            <p className="mt-1 text-muted-foreground">
              AlphaGenome is available for{' '}
              <strong className="text-foreground">non-commercial use only</strong>.
              Its terms of service also prohibit using its outputs to train
              other machine-learning models. See the API key dialog for where
              to get a free key and the full terms.
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="font-medium">Genome builds &amp; sequence length</h3>
            <p className="mt-1 text-muted-foreground">
              Human predictions use <strong className="text-foreground">hg38</strong>{' '}
              (GRCh38.p13); mouse predictions use{' '}
              <strong className="text-foreground">mm10</strong> (GRCm38.p6). No
              other species are supported. AlphaGenome's own documentation
              notes that prediction quality degrades with evolutionary
              distance from these two builds.
            </p>
            <p className="mt-1 text-muted-foreground">
              Predictions run at single-base resolution over a sequence window
              centered on the variant, up to 1,048,576 bp (1 Mb). AlphaGenome
              recommends the full 1 Mb window for the best accuracy.
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="font-medium">Model caveats</h3>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
              <li>
                Trained on unphased sequence, so it does not model interactions
                between two different alleles on a pair of chromosomes
                (compound heterozygous effects).
              </li>
              <li>
                Tissue-specificity and very long-range (near or beyond the 1
                Mb context window) regulatory interactions are still hard for
                the model.
              </li>
              <li>
                Not benchmarked on personal or whole genomes; it's designed
                for single-variant, single-interval predictions, not
                complex-trait or polygenic interpretation.
              </li>
            </ul>
          </section>

          <Separator />

          <section>
            <h3 className="font-medium">HPO data</h3>
            <p className="mt-1 text-muted-foreground">
              HPO terms, definitions, and gene annotations are from the{' '}
              <strong className="text-foreground">Human Phenotype Ontology</strong>{' '}
              (release 2026-06-23), Human Phenotype Ontology Consortium &amp;
              Monarch Initiative. See{' '}
              <a
                href="https://hpo.jax.org"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline underline-offset-4"
              >
                hpo.jax.org
              </a>{' '}
              for license terms.
            </p>
            <p className="mt-1 text-muted-foreground">
              Köhler S, <em>et al.</em> The Human Phenotype Ontology in 2021.{' '}
              <em>Nucleic Acids Research</em>, 49(D1):D1207–D1217, 2021.{' '}
              <a
                href="https://doi.org/10.1093/nar/gkaa1043"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline underline-offset-4"
              >
                DOI:10.1093/nar/gkaa1043
              </a>
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="font-medium">Citation</h3>
            <p className="mt-1 text-muted-foreground">
              Žiga Avsec, Natasha Latysheva, Jun Cheng, <em>et al.</em>{' '}
              Advancing regulatory variant effect prediction with AlphaGenome.{' '}
              <em>Nature</em>, 649(8099):1206–1218, 2026.{' '}
              <a
                href="https://doi.org/10.1038/s41586-025-10014-0"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline underline-offset-4"
              >
                DOI:10.1038/s41586-025-10014-0
              </a>
            </p>
            <p className="mt-1 text-muted-foreground">
              More detail:{' '}
              <a
                href="https://www.alphagenomedocs.com"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline underline-offset-4"
              >
                alphagenomedocs.com
              </a>
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
