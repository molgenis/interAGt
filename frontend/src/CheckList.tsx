import { Checkbox } from '@/ui/checkbox'
import { InfoTooltip } from '@/InfoTooltip'

interface CheckListProps {
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  emptyMessage?: string
  /** Optional per-option tooltip text, shown via an Info icon next to the label. */
  descriptions?: Record<string, string>
}

export function CheckList({
  options,
  selected,
  onChange,
  emptyMessage = 'No options available.',
  descriptions,
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
          {descriptions?.[option] && (
            // Clicking the icon must not toggle the checkbox via the
            // surrounding <label>'s native click-forwarding behavior.
            <span
              className="ml-auto shrink-0"
              onClick={(e) => e.preventDefault()}
            >
              <InfoTooltip
                content={descriptions[option]}
                className="size-3.5"
              />
            </span>
          )}
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
