import { useState, useRef, useEffect, useMemo } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'

interface MultiSelectProps {
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  searchable?: boolean
  maxSelected?: number
  disabled?: boolean
  id?: string
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
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const atLimit =
    typeof maxSelected === 'number' && selected.length >= maxSelected

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((o) => o.toLowerCase().includes(needle))
  }, [options, query])

  function toggle(option: string) {
    if (selected.includes(option)) {
      onChange(selected.filter((s) => s !== option))
    } else if (!atLimit) {
      onChange([...selected, option])
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-left text-sm shadow-sm transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span
          className={
            selected.length === 0
              ? 'truncate text-muted-foreground'
              : 'truncate'
          }
        >
          {selected.length === 0 ? placeholder : `${selected.length} selected`}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-60" />
      </button>

      {selected.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {selected.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
            >
              {item}
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() => toggle(item)}
                className="opacity-60 hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover p-1 shadow-lg">
          {searchable && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="mb-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus-visible:outline-none"
            />
          )}
          <div className="max-h-64 overflow-auto">
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                No matches
              </p>
            )}
            {filtered.map((option) => {
              const isSelected = selected.includes(option)
              const isDisabled = !isSelected && atLimit
              return (
                <button
                  type="button"
                  key={option}
                  disabled={isDisabled}
                  onClick={() => toggle(option)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 ${isSelected ? 'bg-muted/60' : ''}`}
                >
                  <span className="flex size-4 items-center justify-center">
                    {isSelected && <Check className="size-4 text-primary" />}
                  </span>
                  <span className="truncate">{option}</span>
                </button>
              )
            })}
          </div>
          {typeof maxSelected === 'number' && (
            <p className="px-2 pt-1 text-xs text-muted-foreground">
              {selected.length}/{maxSelected} selected
            </p>
          )}
        </div>
      )}
    </div>
  )
}
