import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'

// Keep in sync with SEQUENCE_LENGTHS in backend/schemas.py.
export const SEQUENCE_LENGTHS = [16384, 131072, 524288, 1048576] as const

export type SequenceLength = (typeof SEQUENCE_LENGTHS)[number]

function formatLabel(value: number): string {
  if (value >= 1_048_576) return '1 Mb'
  if (value >= 1000) return `${Math.round(value / 1024)} kb`
  return String(value)
}

export function SeqLengthSelect({
  id,
  value,
  onChange,
}: {
  id?: string
  value: SequenceLength
  onChange: (v: SequenceLength) => void
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => onChange(Number(v) as SequenceLength)}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SEQUENCE_LENGTHS.map((length) => (
          <SelectItem key={length} value={String(length)}>
            {formatLabel(length)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
