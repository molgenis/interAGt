import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs'

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
    <Tabs
      value={String(value)}
      onValueChange={(v) => onChange(Number(v) as SequenceLength)}
    >
      <TabsList id={id} className="grid w-full grid-cols-4">
        {SEQUENCE_LENGTHS.map((length) => (
          <TabsTrigger key={length} value={String(length)}>
            {formatLabel(length)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
