'use client'
import { useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Highlight } from '@/lib/highlights'

const COLOR_BORDER: Record<string, string> = {
  amber:  'border-l-amber-400',
  blue:   'border-l-blue-400',
  green:  'border-l-emerald-400',
  purple: 'border-l-purple-400',
}

interface Props {
  highlights: Highlight[]
  onDelete: (id: string) => void
}

export function HighlightsPanel({ highlights, onDelete }: Props) {
  const [open, setOpen] = useState(false)

  if (highlights.length === 0) return null

  // Group by messageId, preserve creation order
  const grouped = new Map<string, Highlight[]>()
  for (const h of highlights) {
    const arr = grouped.get(h.messageId) || []
    arr.push(h)
    grouped.set(h.messageId, arr)
  }

  function scrollToMessage(messageId: string) {
    const el = document.querySelector(`[data-message-id="${messageId}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('highlight-pulse')
    setTimeout(() => el.classList.remove('highlight-pulse'), 1500)
  }

  return (
    <div className="border-b border-border bg-card/30">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          📌 Highlights ({highlights.length})
        </span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-2 max-h-60 overflow-y-auto">
          {Array.from(grouped.entries()).map(([messageId, items]) => (
            <div key={messageId} className="space-y-1">
              {items.map(h => {
                const borderColor = COLOR_BORDER[h.color] ?? COLOR_BORDER.amber
                const truncated = h.selectedText.length > 80
                  ? h.selectedText.slice(0, 80) + '…'
                  : h.selectedText
                return (
                  <div
                    key={h.id}
                    className={cn(
                      'flex items-start gap-2 pl-2 py-1.5 border-l-2 rounded-r-sm bg-muted/20 group',
                      borderColor
                    )}
                  >
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => scrollToMessage(h.messageId)}
                    >
                      <p className="text-xs italic text-foreground/80 leading-snug truncate">
                        &ldquo;{truncated}&rdquo;
                      </p>
                      {h.comment && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                          {h.comment}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => onDelete(h.id)}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
