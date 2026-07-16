export const SEQUENCE_LENGTHS = [16384, 131072, 524288, 1048576] as const

export type SequenceLength = (typeof SEQUENCE_LENGTHS)[number]

function formatLabel(value: number): string {
  if (value >= 1_048_576) return '1 Mb'
  if (value >= 1000) return `${Math.round(value / 1024)} kb`
  return String(value)
}

export function SeqLengthSelect({
  value,
  onChange,
}: {
  value: SequenceLength
  onChange: (v: SequenceLength) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-border p-0.5">
      {SEQUENCE_LENGTHS.map((length) => (
        <button
          key={length}
          type="button"
          onClick={() => onChange(length)}
          className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
            value === length
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          {formatLabel(length)}
        </button>
      ))}
    </div>
  )
}
