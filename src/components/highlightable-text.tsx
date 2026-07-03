'use client'
import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { X, MessageSquare } from 'lucide-react'
import type { Highlight } from '@/lib/highlights'

// Inline styles for highlight colors (avoids Tailwind JIT issues with dynamic class application)
const COLOR_STYLES: Record<string, { background: string; borderBottom: string }> = {
  amber:  { background: 'rgba(251,191,36,0.30)',  borderBottom: '2px solid rgba(251,191,36,0.70)' },
  blue:   { background: 'rgba(96,165,250,0.30)',  borderBottom: '2px solid rgba(96,165,250,0.70)' },
  green:  { background: 'rgba(52,211,153,0.30)',  borderBottom: '2px solid rgba(52,211,153,0.70)' },
  purple: { background: 'rgba(167,139,250,0.30)', borderBottom: '2px solid rgba(167,139,250,0.70)' },
}

const COLOR_SWATCHES: Record<string, string> = {
  amber: '#FBBF24', blue: '#60A5FA', green: '#34D399', purple: '#A78BFA',
}

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

// Walk text nodes in a container and apply/remove DOM highlight marks
function applyHighlightsToDOM(
  container: HTMLElement,
  highlights: Highlight[],
  messageId: string,
  focusedId: string | null,
  onHighlightClick: ((id: string) => void) | undefined,
  onDeleteHighlight: (id: string) => void
) {
  // Remove existing marks and normalize
  container.querySelectorAll('mark[data-highlight-id]').forEach(mark => {
    const parent = mark.parentNode!
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  })
  container.normalize()

  // Diagram pin annotations (selectedText starts with '📍 ') live on the
  // diagram overlay, not in the prose — never paint them as text marks.
  const msgHighlights = [...highlights.filter(h => h.messageId === messageId && !h.selectedText.startsWith('📍 '))]
    .sort((a, b) => a.startOffset - b.startOffset)

  if (msgHighlights.length === 0) return

  function getTextNodes() {
    const result: Array<{ node: Text; globalStart: number; globalEnd: number }> = []
    let offset = 0
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    let node: Text
    while ((node = walker.nextNode() as Text)) {
      const len = node.textContent?.length ?? 0
      result.push({ node, globalStart: offset, globalEnd: offset + len })
      offset += len
    }
    return result
  }

  function getFullText() {
    let text = ''
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    let node: Text
    while ((node = walker.nextNode() as Text)) text += node.textContent ?? ''
    return text
  }

  for (const h of msgHighlights) {
    const textNodes = getTextNodes()
    const style = COLOR_STYLES[h.color] ?? COLOR_STYLES.amber
    const isFocused = focusedId === h.id

    // Verify offset matches stored text — if not, search for the text in the DOM
    let startOffset = h.startOffset
    let endOffset = h.endOffset
    const fullText = getFullText()
    const textAtOffset = fullText.slice(startOffset, endOffset)
    if (textAtOffset !== h.selectedText && h.selectedText) {
      // Offset is stale — find the text by searching
      const searchIdx = fullText.indexOf(h.selectedText)
      if (searchIdx >= 0) {
        startOffset = searchIdx
        endOffset = searchIdx + h.selectedText.length
      } else {
        continue // Text no longer exists in this message — skip
      }
    }

    const overlapping = textNodes.filter(n =>
      n.globalStart < endOffset && n.globalEnd > startOffset
    )

    for (const { node, globalStart } of overlapping) {
      const localStart = Math.max(0, startOffset - globalStart)
      const localEnd = Math.min(node.length, endOffset - globalStart)
      if (localStart >= localEnd) continue

      let targetNode = node
      if (localStart > 0) targetNode = node.splitText(localStart)
      if (localEnd - localStart < targetNode.length) targetNode.splitText(localEnd - localStart)

      const mark = document.createElement('mark')
      mark.dataset.highlightId = h.id
      mark.style.background = style.background
      mark.style.borderBottom = style.borderBottom
      mark.style.borderRadius = '2px'
      mark.style.padding = '0 1px'
      mark.style.cursor = 'pointer'
      mark.style.display = 'inline'
      if (isFocused) {
        mark.style.outline = '2px solid hsl(var(--primary))'
        mark.style.outlineOffset = '1px'
      }
      mark.title = h.comment ? `💬 ${h.comment}` : 'Click to view annotation'
      if (h.comment) {
        const icon = document.createElement('span')
        icon.textContent = ' 💬'
        icon.style.fontSize = '10px'
        icon.style.opacity = '0.7'
        mark.appendChild(icon)
      }

      targetNode.parentNode!.insertBefore(mark, targetNode)
      mark.insertBefore(targetNode, mark.firstChild)

      mark.addEventListener('click', (e) => { e.stopPropagation(); onHighlightClick?.(h.id) })

      // Hover × delete button
      let deleteBtn: HTMLButtonElement | null = null
      mark.addEventListener('mouseenter', () => {
        if (deleteBtn) return
        deleteBtn = document.createElement('button')
        deleteBtn.textContent = '×'
        deleteBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;margin-left:2px;border-radius:50%;background:rgba(0,0,0,0.2);font-size:10px;line-height:1;cursor:pointer;vertical-align:middle;border:none;color:inherit;'
        deleteBtn.title = 'Remove highlight'
        deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); onDeleteHighlight(h.id) })
        mark.appendChild(deleteBtn)
      })
      mark.addEventListener('mouseleave', () => {
        deleteBtn?.remove()
        deleteBtn = null
      })
    }
  }
}

export function HighlightableText({ text, children, messageId, highlights, focusedHighlightId, onAddHighlight, onUpdateHighlight, onDeleteHighlight, onHighlightClick, onReply }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [toolbar, setToolbar] = useState<{ x: number; y: number; start: number; end: number; selectedText: string } | null>(null)
  const [toolbarColor, setToolbarColor] = useState<string>('amber')
  const [toolbarComment, setToolbarComment] = useState('')

  const isTemp = messageId === 'streaming' || messageId.startsWith('archived-') || messageId.startsWith('t-')
  const isWrapMode = children !== undefined

  // Apply DOM highlights whenever highlights or focus changes (wrap mode)
  useEffect(() => {
    if (!isWrapMode || !containerRef.current) return
    applyHighlightsToDOM(
      containerRef.current,
      highlights,
      messageId,
      focusedHighlightId ?? null,
      onHighlightClick,
      onDeleteHighlight
    )
  }, [highlights, messageId, focusedHighlightId, isWrapMode, onHighlightClick, onDeleteHighlight])

  // Flash/scroll when focused from panel (text mode)
  const markRefs = useRef<Record<string, HTMLElement | null>>({})
  useEffect(() => {
    if (isWrapMode || !focusedHighlightId) return
    const el = markRefs.current[focusedHighlightId]
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

  // Text-mode segment rendering (non-wrap mode)
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
      const style = COLOR_STYLES[h.color] ?? COLOR_STYLES.amber
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
            {Object.entries(COLOR_SWATCHES).map(([color, hex]) => (
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
