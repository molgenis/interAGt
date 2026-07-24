import { Checkbox } from '@/ui/checkbox'

interface CheckListProps {
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  emptyMessage?: string
}

export function CheckList({
  options,
  selected,
  onChange,
  emptyMessage = 'No options available.',
}: CheckListProps) {
  return (
    <div className="grid gap-1 rounded-md border p-2">
      {options.map((option) => (
        <label
          key={option}
          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
        >
          <Checkbox
            checked={selected.includes(option)}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...selected, option]
                  : selected.filter((o) => o !== option),
              )
            }
          />
          <span className="truncate">{option}</span>
        </label>
      ))}
      {options.length === 0 && (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      )}
    </div>
  )
}
