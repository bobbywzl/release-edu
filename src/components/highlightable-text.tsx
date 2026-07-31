'use client'
/**
 * HighlightableText — SELECTION + CREATION only.
 *
 * Select text → color toolbar → save. Offsets are measured against the
 * container's rendered text (Range.toString()), the same offset space the
 * declarative renderer paints in.
 *
 * PAINTING saved highlights is NOT done here anymore. Wrap mode used to
 * mutate the live DOM (splitText / insertBefore / removeChild) inside
 * React-rendered markdown; React's next reconciliation then threw
 * NotFoundError: removeChild and blanked the workspace — and because the
 * bad anchor was persisted, the node crashed on every subsequent load.
 * Marks now render declaratively inside MarkdownRenderer (rehype pass), so
 * React owns every node and a stale anchor degrades to "not painted".
 */
import { useState, useRef, useEffect, type ReactNode } from 'react'
import { X, MessageSquare } from 'lucide-react'
import type { Highlight } from '@/lib/highlights'
import { HIGHLIGHT_COLOR_STYLES, HIGHLIGHT_COLOR_SWATCHES } from '@/lib/highlight-colors'

interface Props {
  text?: string
  children?: ReactNode
  messageId: string
  highlights: Highlight[]
  focusedHighlightId?: string | null
  onAddHighlight: (data: { messageId: string; selectedText: string; startOffset: number; endOffset: number; color: string; comment: string | null }) => Promise<Highlight | undefined>
  onUpdateHighlight: (id: string, data: { comment?: string; color?: string }) => void
  onDeleteHighlight: (id: string) => void
  onHighlightClick?: (id: string) => void
  onReply?: (quotedText: string) => void
}

export function HighlightableText({ text, children, messageId, highlights, focusedHighlightId, onAddHighlight, onDeleteHighlight, onHighlightClick, onReply }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [toolbar, setToolbar] = useState<{ x: number; y: number; start: number; end: number; selectedText: string } | null>(null)
  const [toolbarColor, setToolbarColor] = useState<string>('amber')
  const [toolbarComment, setToolbarComment] = useState('')

  const isTemp = messageId === 'streaming' || messageId.startsWith('archived-') || messageId.startsWith('t-')
  const isWrapMode = children !== undefined

  // Flash/scroll when focused from panel (text mode paints its own marks).
  const markRefs = useRef<Record<string, HTMLElement | null>>({})
  useEffect(() => {
    if (!focusedHighlightId) return
    // Wrap mode: the mark is rendered by MarkdownRenderer — find it by id.
    const el = isWrapMode
      ? containerRef.current?.querySelector<HTMLElement>(`mark[data-highlight-id="${focusedHighlightId}"]`) ?? null
      : markRefs.current[focusedHighlightId]
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusedHighlightId, isWrapMode])

  // Dismiss toolbar when clicking outside — but NOT when interacting with the toolbar itself
  useEffect(() => {
    if (!toolbar) return
    function isInsideToolbar(target: EventTarget | null) {
      return toolbarRef.current?.contains(target as Node)
    }
    function handleSelectionChange() {
      // Ignore selection changes caused by clicking inside the toolbar (input focus, button clicks)
      if (isInsideToolbar(document.activeElement)) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.toString().trim() === '') dismissToolbar()
    }
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (isInsideToolbar(e.target)) return
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) dismissToolbar()
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside as EventListener, { passive: true })
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside as EventListener)
    }
  }, [toolbar])

  function handleMouseUp() {
    if (isTemp) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !containerRef.current) return
    if (!containerRef.current.contains(selection.anchorNode) || !containerRef.current.contains(selection.focusNode)) return

    const range = selection.getRangeAt(0)
    const preRange = document.createRange()
    preRange.selectNodeContents(containerRef.current)
    preRange.setEnd(range.startContainer, range.startOffset)
    const start = preRange.toString().length
    const end = start + range.toString().length
    if (end <= start) return

    const rect = range.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()
    setToolbar({
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top - 8,
      start, end,
      selectedText: selection.toString().trim(),
    })
    setToolbarColor('amber')
    setToolbarComment('')
  }

  function dismissToolbar() {
    setToolbar(null)
    window.getSelection()?.removeAllRanges()
  }

  async function confirmHighlightWithColor(color: string) {
    if (!toolbar) return
    await onAddHighlight({
      messageId,
      selectedText: toolbar.selectedText,
      startOffset: toolbar.start,
      endOffset: toolbar.end,
      color,
      comment: toolbarComment.trim() || null,
    })
    dismissToolbar()
  }

  // Text-mode segment rendering (plain strings — no markdown involved)
  function renderSegments() {
    if (!text) return null
    const msgHighlights = highlights.filter(h => h.messageId === messageId && !h.selectedText.startsWith('📍 '))
    if (msgHighlights.length === 0) return <span>{text}</span>

    const sorted = [...msgHighlights].sort((a, b) => a.startOffset - b.startOffset)
    const segments: React.ReactNode[] = []
    let cursor = 0

    for (const h of sorted) {
      if (h.startOffset < cursor) continue
      if (h.startOffset > cursor) segments.push(<span key={`plain-${cursor}`}>{text.slice(cursor, h.startOffset)}</span>)
      const style = HIGHLIGHT_COLOR_STYLES[h.color] ?? HIGHLIGHT_COLOR_STYLES.amber
      const isFocused = focusedHighlightId === h.id
      segments.push(
        <mark
          key={h.id}
          ref={el => { markRefs.current[h.id] = el }}
          data-highlight-id={h.id}
          style={{ ...style, borderRadius: '2px', padding: '0 1px', cursor: 'pointer', outline: isFocused ? '2px solid hsl(var(--primary))' : undefined, outlineOffset: '1px' }}
          onClick={e => { e.stopPropagation(); onHighlightClick?.(h.id) }}
          title={h.comment || 'Click to view annotation'}
          className="group/mark relative inline"
        >
          {text.slice(h.startOffset, h.endOffset)}
          {h.comment && <MessageSquare className="inline w-3 h-3 ml-0.5 opacity-60" />}
          <button
            onClick={e => { e.stopPropagation(); e.preventDefault(); onDeleteHighlight(h.id) }}
            className="hidden group-hover/mark:inline-flex items-center justify-center w-3.5 h-3.5 ml-0.5 rounded-full bg-foreground/20 hover:bg-red-500/60 text-foreground hover:text-white transition-colors align-middle border-0"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </mark>
      )
      cursor = h.endOffset
    }
    if (cursor < text.length) segments.push(<span key="plain-end">{text.slice(cursor)}</span>)
    return <>{segments}</>
  }

  return (
    <div ref={containerRef} className="relative select-text" onMouseUp={handleMouseUp} onTouchEnd={handleMouseUp}>
      {isWrapMode ? children : renderSegments()}

      {/* Selection toolbar */}
      {toolbar && !isTemp && (
        <div
          ref={toolbarRef}
          className="absolute z-50 bg-card border border-border rounded-lg shadow-xl p-2 flex flex-col gap-2 min-w-[220px]"
          style={{ left: Math.max(0, toolbar.x - 110), top: toolbar.y - (onReply ? 130 : 90) }}
          onMouseDown={e => {
            // Allow clicks on inputs/buttons inside, but prevent deselection from the toolbar background
            if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'BUTTON') return
            e.preventDefault()
          }}
        >
          <div className="flex items-center gap-1.5">
            {Object.entries(HIGHLIGHT_COLOR_SWATCHES).map(([color, hex]) => (
              <button
                key={color}
                title={`Highlight ${color}`}
                onClick={() => { setToolbarColor(color); confirmHighlightWithColor(color) }}
                style={{ backgroundColor: hex, width: 20, height: 20, borderRadius: '50%', border: toolbarColor === color ? '2px solid white' : '2px solid transparent', cursor: 'pointer' }}
              />
            ))}
            {onReply && (
              <button
                title="Reply to this selection"
                onClick={() => { onReply(toolbar.selectedText); dismissToolbar() }}
                className="ml-1 p-1 rounded hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={dismissToolbar} className="ml-auto text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            type="text"
            placeholder="Add a note… (Enter to save)"
            value={toolbarComment}
            onChange={e => setToolbarComment(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmHighlightWithColor(toolbarColor) } }}
            onClick={e => e.stopPropagation()}
            onFocus={e => e.stopPropagation()}
            autoFocus={false}
            className="text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 w-full"
          />
          {onReply && (
            <button
              onClick={() => { onReply(toolbar.selectedText); dismissToolbar() }}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-accent transition-colors"
            >
              <MessageSquare className="w-3 h-3" />
              Reply to this
            </button>
          )}
        </div>
      )}
    </div>
  )
}
