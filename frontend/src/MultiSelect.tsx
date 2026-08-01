import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { cn } from '@/utils'

// Option lists reach into the thousands (HPO terms); render a slice so the
// popover stays responsive and let search narrow things down.
const MAX_VISIBLE = 100

interface MultiSelectProps {
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  searchable?: boolean
  maxSelected?: number
  disabled?: boolean
  id?: string
  /** Optional hover text per option (e.g. an HPO term's definition). */
  descriptions?: Record<string, string>
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = 'Select…',
  searchable = true,
  maxSelected,
  disabled = false,
  id,
  descriptions,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const atLimit = typeof maxSelected === 'number' && selected.length >= maxSelected

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matches = needle
      ? options.filter((o) => o.toLowerCase().includes(needle))
      : options
    return { items: matches.slice(0, MAX_VISIBLE), total: matches.length }
  }, [options, query])

  function toggle(option: string) {
    if (selected.includes(option)) {
      onChange(selected.filter((s) => s !== option))
    } else if (!atLimit) {
      onChange([...selected, option])
    }
  }

  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span
              className={cn(
                'truncate',
                selected.length === 0 && 'text-muted-foreground',
              )}
            >
              {selected.length === 0
                ? placeholder
                : `${selected.length} selected`}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command shouldFilter={false}>
            {searchable && (
              <CommandInput
                placeholder="Search…"
                value={query}
                onValueChange={setQuery}
              />
            )}
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup>
                {visible.items.map((option) => {
                  const isSelected = selected.includes(option)
                  return (
                    <CommandItem
                      key={option}
                      value={option}
                      disabled={!isSelected && atLimit}
                      onSelect={() => toggle(option)}
                      title={descriptions?.[option]}
                    >
                      <Check
                        className={cn(
                          'size-4 shrink-0',
                          isSelected ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span className="truncate">{option}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
            {visible.total > MAX_VISIBLE && (
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                Showing {MAX_VISIBLE} of {visible.total} — refine your search.
              </p>
            )}
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {selected.map((item) => (
            <Badge key={item} variant="secondary" className="gap-1 font-normal">
              <span className="max-w-[15rem] truncate">{item}</span>
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() => toggle(item)}
                className="opacity-60 hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {typeof maxSelected === 'number' && selected.length > 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {selected.length}/{maxSelected} selected
        </p>
      )}
    </div>
  )
}
