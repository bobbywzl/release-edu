'use client'
/**
 * GeneratedVisual — renders a ```image block from Bob into an actual
 * educational diagram via /api/image/generate (Gemini flash image, cached
 * durably server-side by prompt hash).
 *
 * Visual-confidence law (FOUNDATION.md): every generated diagram arrives with
 * Gemini's self-evaluated confidence that it actually answers the request —
 * shown as a small bar under the image. When confidence is below the server
 * threshold, the response also carries a researched REDIRECT to the best real
 * visual resource; the UI leads with that card, says explicitly that the
 * choice was made, and tucks the low-confidence attempt behind a toggle.
 *
 * A module-level cache keeps re-renders and history reloads from re-posting;
 * the server cache makes repeat generations free across sessions anyway.
 */
import { useEffect, useState } from 'react'
import { ImageIcon, Loader2, ExternalLink, Eye } from 'lucide-react'
import { useT } from '@/lib/i18n'

interface VisualResult {
  image: string
  confidence?: number | null
  issue?: string
  redirect?: { name: string; url: string; why: string } | null
}

const memo = new Map<string, Promise<VisualResult | null>>()

function generate(prompt: string, context: string): Promise<VisualResult | null> {
  const key = `${prompt} ${context}`
  if (!memo.has(key)) {
    memo.set(key, fetch('/api/image/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, context }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => (d?.image ? (d as VisualResult) : null))
      .catch(() => null))
  }
  return memo.get(key)!
}

function ConfidenceBar({ value, issue }: { value: number; issue?: string }) {
  const t = useT()
  const color = value >= 75 ? 'bg-emerald-400' : value >= 60 ? 'bg-amber-400' : 'bg-red-400'
  const text = value >= 75 ? 'text-emerald-400' : value >= 60 ? 'text-amber-400' : 'text-red-400'
  return (
    <div className="mt-1 flex items-center gap-2" title={issue || undefined}>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{t('visual.confidence')}</span>
      <div className="h-1 flex-1 max-w-[140px] rounded-full bg-border overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className={`text-[10px] tabular-nums font-medium ${text}`}>{value}%</span>
    </div>
  )
}

export function GeneratedVisual({ prompt, context = '' }: { prompt: string; context?: string }) {
  const t = useT()
  const [state, setState] = useState<{ status: 'loading' | 'done' | 'error'; result?: VisualResult }>({ status: 'loading' })
  const [showAnyway, setShowAnyway] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    setShowAnyway(false)
    generate(prompt, context).then(result => {
      if (cancelled) return
      setState(result ? { status: 'done', result } : { status: 'error' })
    })
    return () => { cancelled = true }
  }, [prompt, context])

  if (state.status === 'loading') {
    return (
      <div className="my-3 rounded-xl border border-border bg-muted/40 px-4 py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('visual.loading')}
      </div>
    )
  }
  if (state.status === 'error' || !state.result) {
    return (
      <div className="my-2 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
        <ImageIcon className="w-3 h-3" /> {t('visual.failed')}
      </div>
    )
  }

  const { image, confidence, issue, redirect } = state.result

  // Low confidence + a researched better resource → lead with the explicit
  // redirect; the weak attempt hides behind a toggle instead of teaching.
  if (redirect) {
    return (
      <div className="my-3 space-y-2">
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3.5 space-y-2">
          <p className="text-xs font-bold text-amber-300 uppercase tracking-wider">{t('visual.redirectTitle')}</p>
          <p className="text-[12px] text-foreground/90 leading-snug">
            {t('visual.redirectNote')}{typeof confidence === 'number' ? ` (${t('visual.confidence')} ${confidence}%${issue ? ` — ${issue}` : ''})` : ''}
          </p>
          <a
            href={redirect.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/25 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" /> {redirect.name}
          </a>
          {redirect.why && <p className="text-[11px] text-muted-foreground leading-snug">{redirect.why}</p>}
        </div>
        {!showAnyway ? (
          <button
            onClick={() => setShowAnyway(true)}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Eye className="w-3 h-3" /> {t('visual.showAnyway')}
          </button>
        ) : (
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt={prompt}
              className="rounded-xl border border-border max-w-full max-h-[300px] object-contain bg-white opacity-90"
            />
            {typeof confidence === 'number' && <ConfidenceBar value={confidence} issue={issue} />}
          </div>
        )}
      </div>
    )
  }

  // FIGURE CARD (user directive, Aug 2026): visuals must read as figures —
  // framed, with the diagram's own description as a visible caption — never
  // as a bare image floating in the text.
  return (
    <figure className="my-4 rounded-xl border border-border bg-card/60 p-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt={prompt}
        className="rounded-lg border border-border/60 max-w-full max-h-[420px] object-contain bg-white mx-auto"
      />
      <figcaption className="mt-2 px-1 text-xs text-muted-foreground italic text-center leading-snug">
        {prompt}
      </figcaption>
      {typeof confidence === 'number' && <ConfidenceBar value={confidence} issue={issue} />}
    </figure>
  )
}
