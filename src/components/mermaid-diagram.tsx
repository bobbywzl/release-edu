'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { Maximize2, X } from 'lucide-react'

export function MermaidDiagram({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const fullscreenRef = useRef<HTMLDivElement>(null)

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

  // Close fullscreen on Escape.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

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

  return (
    <>
      <div className="relative my-3 rounded-lg border border-border/50 bg-card/50 group">
        {/* Expand control — appears on hover, opens fullscreen modal */}
        <button
          type="button"
          onClick={() => setExpanded(true)}
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
          <div
            className="inline-block [&_svg]:!max-w-none [&_svg]:!height-auto"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground/60 px-3 pb-2 select-none">
          Scroll to pan · click <Maximize2 className="inline w-2.5 h-2.5" /> to expand
        </p>
      </div>

      {/* Fullscreen modal — Esc or background click to close */}
      {expanded && (
        <div
          className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={(e) => { if (e.target === e.currentTarget) setExpanded(false) }}
        >
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="absolute top-4 right-4 p-2 rounded-md bg-card/90 border border-border text-foreground hover:bg-card transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <div
            ref={fullscreenRef}
            className="max-w-full max-h-full overflow-auto bg-card border border-border rounded-xl p-6"
          >
            <div
              className="inline-block [&_svg]:!max-w-none"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      )}
    </>
  )
}
