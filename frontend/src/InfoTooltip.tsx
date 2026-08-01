import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { cn } from '@/utils'

// A real <button> (not a bare icon) so the tooltip opens on click via
// Radix's built-in focus trigger, not just on hover.
export function InfoTooltip({
  content,
  className,
}: {
  content: React.ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="More info"
          className="inline-flex border-0 bg-transparent p-0 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className={cn('h-4 w-4', className)} />
        </button>
      </TooltipTrigger>
      <TooltipContent className="w-64 rounded border bg-popover p-2 text-xs text-popover-foreground">
        {content}
      </TooltipContent>
    </Tooltip>
  )
}
