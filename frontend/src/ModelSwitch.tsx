import type { ModelVersion } from '@/api'
import { InfoTooltip } from '@/InfoTooltip'

/** Two-state AlphaGenome version switch (1 | 2) for the header. */
export function ModelSwitch({
  value,
  onChange,
}: {
  value: ModelVersion
  onChange: (version: ModelVersion) => void
}) {
  const isAg2 = value === 'ag2'
  const toggle = () => onChange(isAg2 ? 'ag1' : 'ag2')

  return (
    <div className="flex items-center gap-2 text-sm">
      Model version
      <button
        type="button"
        onClick={() => onChange('ag1')}
        className={isAg2 ? 'text-muted-foreground hover:text-foreground' : 'font-semibold'}
        aria-hidden
        tabIndex={-1}
      >
        1
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={isAg2}
        aria-label={`AlphaGenome version: ${isAg2 ? '2' : '1'}`}
        title="AlphaGenome version"
        onClick={toggle}
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span
          className={`inline-block size-4 rounded-full bg-background shadow transition-transform ${
            isAg2 ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
      <button
        type="button"
        onClick={() => onChange('ag2')}
        className={isAg2 ? 'font-semibold' : 'text-muted-foreground hover:text-foreground'}
        aria-hidden
        tabIndex={-1}
      >
        2
      </button>
      <InfoTooltip
        content={
          <>
            AlphaGenome version. 2 (default) predicts for one condition (a
            tissue, cell type or cell line) at a time, adds DNA methylation and
            single-cell outputs, and returns raw scores only; each condition is
            a separate API call. 1 predicts across all tissues at once, has
            PRO-cap and gives quantile scores (human).
          </>
        }
      />
    </div>
  )
}
