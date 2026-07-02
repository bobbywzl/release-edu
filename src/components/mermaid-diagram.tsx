'use client'
import { useEffect, useId, useRef, useState, useCallback } from 'react'
import { Maximize2, X, ZoomIn, ZoomOut, MapPin, Trash2 } from 'lucide-react'
import type { Highlight } from '@/lib/highlights'

// Same palette as the text-highlight toolbar (highlightable-text.tsx) so
// diagram annotations feel like one system with text annotations.
const COLOR_SWATCHES: Record<string, string> = {
  amber: '#FBBF24', blue: '#60A5FA', green: '#34D399', purple: '#A78BFA',
}

// Diagram annotations ride on the existing Highlight infra so they persist
// and show up in the notes panel. Encoding (no schema change needed):
//   selectedText = "📍 <label>"           — the 📍 marker keeps them out of text rendering
//   startOffset  = diagramIndex*10000 + x‰ (0–1000 across the diagram width)
//   endOffset    = y‰                      (0–1000 down the diagram height)
export const DIAGRAM_ANNOTATION_MARKER = '📍 '

export interface DiagramAnnotationSupport {
  messageId: string
  diagramIndex: number
  annotations: Highlight[]
  onAdd: (data: { messageId: string; selectedText: string; startOffset: number; endOffset: number; color: string; comment: string | null }) => Promise<Highlight | undefined>
  onDelete: (id: string) => void
}

function decodePin(h: Highlight) {
  return {
    x: (h.startOffset % 10000) / 10,   // percent
    y: h.endOffset / 10,               // percent
    label: h.selectedText.slice(DIAGRAM_ANNOTATION_MARKER.length),
    color: COLOR_SWATCHES[h.color] ?? COLOR_SWATCHES.amber,
  }
}

/** Colored pins overlaid on a diagram + click-to-place editor form. */
function AnnotationLayer({ support, annotating, onDonePlacing }: {
  support: DiagramAnnotationSupport
  annotating: boolean
  onDonePlacing?: () => void
}) {
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null)
  const [draftLabel, setDraftLabel] = useState('')
  const [draftComment, setDraftComment] = useState('')
  const [draftColor, setDraftColor] = useState('amber')
  const [openPinId, setOpenPinId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const pins = support.annotations
    .filter(h => h.selectedText.startsWith(DIAGRAM_ANNOTATION_MARKER)
      && Math.floor(h.startOffset / 10000) === support.diagramIndex)

  async function savePin() {
    if (!draft || saving) return
    const label = draftLabel.trim() || 'Note'
    setSaving(true)
    try {
      await support.onAdd({
        messageId: support.messageId,
        selectedText: `${DIAGRAM_ANNOTATION_MARKER}${label}`,
        startOffset: support.diagramIndex * 10000 + Math.round(draft.x * 10),
        endOffset: Math.round(draft.y * 10),
        color: draftColor,
        comment: draftComment.trim() || null,
      })
      setDraft(null); setDraftLabel(''); setDraftComment(''); setDraftColor('amber')
      onDonePlacing?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Click-catcher while annotating */}
      {annotating && (
        <div
          className="absolute inset-0 z-20 cursor-crosshair"
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect()
            setDraft({
              x: Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)),
              y: Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)),
            })
            setDraftLabel(''); setDraftComment(''); setDraftColor('amber')
          }}
        />
      )}

      {/* Existing pins */}
      {pins.map(h => {
        const p = decodePin(h)
        const open = openPinId === h.id
        return (
          <div key={h.id} className="absolute z-30" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setOpenPinId(open ? null : h.id) }}
              className="-translate-x-1/2 -translate-y-1/2 block w-4 h-4 rounded-full border-2 border-white/90 shadow-md hover:scale-125 transition-transform"
              style={{ backgroundColor: p.color }}
              title={p.label}
            />
            {open && (
              <div
                className="absolute left-1/2 top-2 -translate-x-1/2 z-40 bg-card border border-border rounded-lg shadow-xl p-2 min-w-[180px] max-w-[260px]"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-start gap-1.5">
                  <span className="mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground break-words">{p.label}</p>
                    {h.comment && <p className="text-[11px] text-muted-foreground mt-0.5 break-words">{h.comment}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => { support.onDelete(h.id); setOpenPinId(null) }}
                    className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                    title="Delete annotation"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Draft pin + editor form — same styling as the text-highlight toolbar */}
      {draft && (
        <div className="absolute z-40" style={{ left: `${draft.x}%`, top: `${draft.y}%` }}>
          <span
            className="-translate-x-1/2 -translate-y-1/2 block w-4 h-4 rounded-full border-2 border-white/90 shadow-md animate-pulse"
            style={{ backgroundColor: COLOR_SWATCHES[draftColor] }}
          />
          <div
            className="absolute left-1/2 top-2 -translate-x-1/2 bg-card border border-border rounded-lg shadow-xl p-2 flex flex-col gap-2 min-w-[220px]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5">
              {Object.entries(COLOR_SWATCHES).map(([color, hex]) => (
                <button
                  key={color}
                  type="button"
                  title={`Pin ${color}`}
                  onClick={() => setDraftColor(color)}
                  style={{ backgroundColor: hex, width: 20, height: 20, borderRadius: '50%', border: draftColor === color ? '2px solid white' : '2px solid transparent', cursor: 'pointer' }}
                />
              ))}
              <button type="button" onClick={() => setDraft(null)} className="ml-auto text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              type="text"
              placeholder="Label this part…"
              value={draftLabel}
              onChange={e => setDraftLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); savePin() } }}
              autoFocus
              className="text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 w-full"
            />
            <input
              type="text"
              placeholder="Add a note… (Enter to save)"
              value={draftComment}
              onChange={e => setDraftComment(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); savePin() } }}
              className="text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 w-full"
            />
            <button
              type="button"
              onClick={savePin}
              disabled={saving}
              className="text-[11px] font-medium bg-primary text-primary-foreground rounded px-2 py-1.5 hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save annotation'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export function MermaidDiagram({ chart, annotation }: { chart: string; annotation?: DiagramAnnotationSupport }) {
  const id = useId().replace(/:/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [closing, setClosing] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [annotating, setAnnotating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            background: 'transparent',
            primaryColor: '#6366f1',
            lineColor: '#6366f1',
          },
          // Sensible defaults so dense diagrams render readably instead of
          // shrinking to fit. Mermaid's default node padding is cramped; we
          // give nodes breathing room so labels stay legible.
          flowchart: {
            nodeSpacing: 40,
            rankSpacing: 50,
            useMaxWidth: false,
            htmlLabels: true,
          },
          sequence: { useMaxWidth: false, boxMargin: 8, mirrorActors: false },
          gantt: { useMaxWidth: false },
        })
        const { svg: rendered } = await mermaid.render(`mermaid-${id}`, chart)
        if (!cancelled) setSvg(rendered)
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [chart, id])

  const close = useCallback(() => {
    // Play a quick reverse animation before unmounting the overlay.
    setClosing(true)
    setAnnotating(false)
    setTimeout(() => { setExpanded(false); setClosing(false) }, 160)
  }, [])

  // Close fullscreen on Escape + lock body scroll while open.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [expanded, close])

  if (error) {
    return (
      <pre className="bg-muted rounded-lg p-3 overflow-x-auto text-xs font-mono text-foreground my-2">
        {chart}
      </pre>
    )
  }
  if (!svg) {
    return <div className="h-24 bg-muted/30 rounded-lg animate-pulse my-2" />
  }

  const pinCount = annotation
    ? annotation.annotations.filter(h => h.selectedText.startsWith(DIAGRAM_ANNOTATION_MARKER)
        && Math.floor(h.startOffset / 10000) === annotation.diagramIndex).length
    : 0

  return (
    <>
      <div className="relative my-3 rounded-lg border border-border/50 bg-card/50 group">
        {/* Expand control — appears on hover, opens fullscreen viewer */}
        <button
          type="button"
          onClick={() => { setZoom(1); setExpanded(true) }}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-background/80 backdrop-blur-sm border border-border/50 text-muted-foreground hover:text-foreground hover:bg-background opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Expand diagram"
          title="Expand"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <div
          ref={containerRef}
          className="overflow-auto p-4"
          style={{ maxHeight: 480 }}
        >
          {/*
            Render the SVG at its natural width — no forced max-width here.
            The outer div's overflow-auto provides scroll when the diagram is
            wider/taller than the chat frame; otherwise it sits centered and
            readable. Inner SVG is given a minimum height to avoid clipping
            very tall flowcharts that render under our line-height defaults.
          */}
          <div className="relative inline-block [&_svg]:!max-w-none [&_svg]:!height-auto">
            <div dangerouslySetInnerHTML={{ __html: svg }} />
            {annotation && <AnnotationLayer support={annotation} annotating={false} />}
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/60 px-3 pb-2 select-none">
          Scroll to pan · click <Maximize2 className="inline w-2.5 h-2.5" /> to expand
          {annotation ? ' · pin & comment inside' : ''}
          {pinCount > 0 ? ` · ${pinCount} 📍` : ''}
        </p>
      </div>

      {/* Fullscreen viewer — covers the whole screen; Esc or ✕ to close */}
      {expanded && (
        <div
          className={`fixed inset-0 z-[200] bg-black/85 backdrop-blur-sm ${closing ? 'opacity-0 transition-opacity duration-150' : 'animate-overlay-in'}`}
          onClick={close}
        >
          <div
            className={`absolute inset-2 sm:inset-4 flex flex-col bg-card border border-border rounded-xl overflow-hidden ${closing ? 'scale-95 opacity-0 transition-all duration-150' : 'animate-modal-in'}`}
            onClick={e => e.stopPropagation()}
          >
            {/* Toolbar */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-background/60 backdrop-blur-sm">
              <span className="text-xs font-medium text-muted-foreground mr-auto select-none">Diagram</span>
              <button
                type="button"
                onClick={() => setZoom(z => Math.max(0.4, +(z - 0.2).toFixed(2)))}
                className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Zoom out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="px-2 py-1 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors tabular-nums"
                title="Reset zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoom(z => Math.min(3, +(z + 0.2).toFixed(2)))}
                className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Zoom in"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              {annotation && (
                <button
                  type="button"
                  onClick={() => setAnnotating(a => !a)}
                  className={`ml-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-medium transition-colors ${
                    annotating
                      ? 'border-primary/50 bg-primary/15 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                  title="Click the diagram to drop a labeled pin with a comment"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  {annotating ? 'Click diagram to pin…' : 'Annotate'}
                </button>
              )}
              <button
                type="button"
                onClick={close}
                className="ml-1 p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Canvas */}
            <div className="flex-1 overflow-auto">
              <div className="min-w-full min-h-full flex items-center justify-center p-8">
                <div
                  className="relative inline-block [&_svg]:!max-w-none"
                  style={{ transform: `scale(${zoom})`, transformOrigin: 'center center', transition: 'transform 0.15s ease-out' }}
                >
                  <div dangerouslySetInnerHTML={{ __html: svg }} />
                  {annotation && (
                    <AnnotationLayer
                      support={annotation}
                      annotating={annotating}
                      onDonePlacing={() => setAnnotating(false)}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
