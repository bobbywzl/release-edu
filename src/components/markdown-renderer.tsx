'use client'

/**
 * Shared markdown renderer — Tree EDU reading typography.
 * Every block kind reads as a DIFFERENT thing at a glance: accent-barred
 * titles, uppercase square-marked kickers, dimmed body with bright bold
 * lead-ins, the ▸ facet-spotlight chip, callout quotes, carded tables and
 * figures, accent list markers. KaTeX enabled.
 *
 * HIGHLIGHTS ARE DECLARATIVE: saved annotations are painted by a rehype
 * pass that wraps the intersecting rendered-text segments in <mark>
 * elements INSIDE the React tree. The previous approach mutated the live
 * DOM (splitText/insertBefore/removeChild) under React's feet, so the next
 * reconciliation threw NotFoundError: removeChild, tripped the app error
 * boundary, and — because the bad anchor was persisted — permanently
 * bricked the node it lived on. React now owns every mark; a highlight
 * whose offsets no longer match simply doesn't paint.
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { useState } from 'react'
import { X, MessageSquare } from 'lucide-react'
import { GeneratedVisual } from '@/components/generated-visual'
import { ResourceCards, parseResources } from '@/components/resource-cards'
import { HIGHLIGHT_COLOR_STYLES } from '@/lib/highlight-colors'

/** One saved annotation to paint, offsets in RENDERED-TEXT space (the same
 *  space the selection toolbar measures with Range.toString()). */
export interface HighlightSpan {
  id: string
  startOffset: number
  endOffset: number
  color: string
  comment?: string | null
  /** The exact text captured at creation — the stale-offset fallback: when
   *  the slice at the offsets no longer matches, we re-find this string. */
  selectedText?: string
}

// ── Minimal hast shapes (kept local so the plugin has no type-package
//    coupling; the trees rehype hands us structurally match these). ──
interface HastText { type: 'text'; value: string }
interface HastParent { type: string; tagName?: string; properties?: Record<string, unknown>; children: HastAny[] }
type HastAny = (HastText | HastParent) & { children?: HastAny[]; value?: string }

/**
 * Rehype pass: walk the finished tree's text nodes in document order
 * (cumulative offsets — the tree's text concatenation equals the DOM's
 * textContent), resolve each highlight (verify the stored slice, fall back
 * to searching selectedText, drop what can't be anchored), then split the
 * intersecting text nodes and wrap the covered segments in
 * <mark data-highlight-id> elements. Purely structural — interactivity
 * lives in the `mark` component override below.
 */
function rehypeHighlightRanges(ranges: HighlightSpan[]) {
  return () => (tree: HastParent) => {
    if (!ranges.length) return
    // Pass 1 — collect text nodes with their global offsets.
    const entries: Array<{ parent: HastParent; index: number; start: number; value: string }> = []
    let fullText = ''
    const walk = (node: HastAny) => {
      const children = node.children
      if (!children) return
      for (let i = 0; i < children.length; i++) {
        const c = children[i]
        if (c.type === 'text' && typeof c.value === 'string') {
          entries.push({ parent: node as HastParent, index: i, start: fullText.length, value: c.value })
          fullText += c.value
        } else if (c.children) {
          walk(c)
        }
      }
    }
    walk(tree)
    if (!fullText) return

    // Resolve each range against the actual rendered text. Tolerant by
    // design: verify → re-find → clamp → drop. A dropped highlight is a
    // cosmetic no-op, never a crash.
    const resolved = ranges
      .map(h => {
        let start = h.startOffset
        let end = h.endOffset
        if (!(Number.isFinite(start) && Number.isFinite(end))) return null
        const want = (h.selectedText ?? '').trim()
        if (want && fullText.slice(start, end) !== h.selectedText) {
          const idx = fullText.indexOf(h.selectedText ?? want)
          if (idx >= 0) { start = idx; end = idx + (h.selectedText ?? want).length }
          else {
            const idx2 = fullText.indexOf(want)
            if (idx2 >= 0) { start = idx2; end = idx2 + want.length }
            else return null // text no longer exists in this message — skip
          }
        }
        start = Math.max(0, Math.min(start, fullText.length))
        end = Math.max(start, Math.min(end, fullText.length))
        if (end <= start) return null
        return { id: h.id, start, end }
      })
      .filter((r): r is { id: string; start: number; end: number } => r !== null)
      .sort((a, b) => a.start - b.start)
    if (!resolved.length) return

    // Pass 2 — split intersecting text nodes into plain/mark segments.
    // Reverse document order so earlier splice indexes stay valid.
    for (let e = entries.length - 1; e >= 0; e--) {
      const entry = entries[e]
      const s = entry.start
      const len = entry.value.length
      const nodeEnd = s + len
      const overlapping = resolved.filter(r => r.start < nodeEnd && r.end > s)
      if (!overlapping.length) continue
      const cuts = new Set<number>([s, nodeEnd])
      for (const r of overlapping) {
        cuts.add(Math.max(s, Math.min(r.start, nodeEnd)))
        cuts.add(Math.max(s, Math.min(r.end, nodeEnd)))
      }
      const bounds = Array.from(cuts).sort((a, b) => a - b)
      const segments: HastAny[] = []
      for (let b = 0; b < bounds.length - 1; b++) {
        const a0 = bounds[b]
        const b0 = bounds[b + 1]
        if (b0 <= a0) continue
        const text = entry.value.slice(a0 - s, b0 - s)
        const covering = overlapping.find(r => r.start <= a0 && r.end >= b0)
        if (covering) {
          segments.push({
            type: 'element', tagName: 'mark',
            properties: { dataHighlightId: covering.id },
            children: [{ type: 'text', value: text }],
          } as HastAny)
        } else {
          segments.push({ type: 'text', value: text } as HastAny)
        }
      }
      if (segments.length) entry.parent.children.splice(entry.index, 1, ...segments)
    }
  }
}

/** The interactive mark — hover ✕ to delete, click to focus the annotation.
 *  Decorations are SVG-only on purpose: they contribute zero characters to
 *  the rendered text, so creating new highlights around existing ones can't
 *  shift the offset space. */
function HighlightMark({ span, focused, onClick, onDelete, children }: {
  span: HighlightSpan
  focused: boolean
  onClick?: (id: string) => void
  onDelete?: (id: string) => void
  children?: React.ReactNode
}) {
  const [hover, setHover] = useState(false)
  const style = HIGHLIGHT_COLOR_STYLES[span.color] ?? HIGHLIGHT_COLOR_STYLES.amber
  return (
    <mark
      data-highlight-id={span.id}
      style={{
        ...style,
        borderRadius: '2px', padding: '0 1px', cursor: onClick ? 'pointer' : undefined,
        display: 'inline', color: 'inherit',
        outline: focused ? '2px solid hsl(var(--primary))' : undefined, outlineOffset: '1px',
      }}
      title={span.comment ? `💬 ${span.comment}` : undefined}
      onClick={e => { if (onClick) { e.stopPropagation(); onClick(span.id) } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children}
      {span.comment ? <MessageSquare aria-hidden className="inline w-3 h-3 ml-0.5 opacity-60 align-middle" /> : null}
      {hover && onDelete ? (
        <button
          onClick={e => { e.stopPropagation(); e.preventDefault(); onDelete(span.id) }}
          title="Remove highlight"
          className="inline-flex items-center justify-center w-3.5 h-3.5 ml-0.5 rounded-full bg-foreground/20 hover:bg-red-500/60 text-foreground hover:text-white transition-colors align-middle border-0"
        >
          <X aria-hidden className="w-2.5 h-2.5" />
        </button>
      ) : null}
    </mark>
  )
}

/** Flatten a node's direct string children (enough to sniff markers like ▸). */
function flatText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(c => (typeof c === 'string' ? c : '')).join('')
  return ''
}

// TYPOGRAPHIC HIERARCHY (user directive, Aug 2026, strengthened): every kind
// of block must read as a DIFFERENT thing at a glance — you should know where
// you are from shape and color alone. Big accent-barred titles (h1/h2), small
// uppercase accent kickers with a square marker (h3), dimmed body, bright
// bold lead-ins, the ▸ facet-spotlight chip, tinted callout quotes, carded
// tables/figures, accent list markers.
const mdComponents = {
  code({ children, className }: { children?: React.ReactNode; className?: string }) {
    const isInline = !className
    return isInline ? (
      <code className="bg-muted px-1.5 py-0.5 rounded text-[13px] font-mono text-primary">
        {children}
      </code>
    ) : (
      <pre className="bg-muted rounded-lg p-3 overflow-x-auto my-3 border border-border/70">
        <code className="text-[13px] font-mono text-foreground">{children}</code>
      </pre>
    )
  },
  strong({ children }: { children?: React.ReactNode }) {
    // FACET SPOTLIGHT: Bob opens facet-tied turns with **▸ facet** — that
    // exact shape renders as the "you are here" chip, echoing the syllabus
    // strip's highlight so the current point pops out of the text too.
    if (flatText(children).trimStart().startsWith('▸')) {
      return (
        <strong className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/15 border border-primary/40 text-primary text-[11px] font-extrabold uppercase tracking-[0.12em] align-middle">
          {children}
        </strong>
      )
    }
    // Bold lead-ins are the scannable skeleton: full-bright against the
    // deliberately dimmed body.
    return <strong className="font-bold text-foreground">{children}</strong>
  },
  p({ children }: { children?: React.ReactNode }) {
    return <p className="mb-3 last:mb-0 leading-[1.75] text-[15px] lg:text-base text-foreground/80">{children}</p>
  },
  h1({ children }: { children?: React.ReactNode }) {
    return <h1 className="text-2xl font-extrabold tracking-tight text-foreground mt-7 first:mt-0 mb-3.5 pb-2 border-b-2 border-primary/40">{children}</h1>
  },
  h2({ children }: { children?: React.ReactNode }) {
    return (
      <h2 className="flex items-center gap-2.5 text-xl lg:text-[22px] font-extrabold tracking-tight text-foreground mt-7 first:mt-0 mb-3 pb-2 border-b border-border/50 before:content-[''] before:w-1.5 before:h-[1.15em] before:rounded-full before:bg-primary before:flex-shrink-0">
        {children}
      </h2>
    )
  },
  h3({ children }: { children?: React.ReactNode }) {
    return (
      <h3 className="flex items-center gap-2 text-[11px] lg:text-xs font-extrabold uppercase tracking-[0.16em] text-primary mt-6 first:mt-0 mb-2 before:content-[''] before:w-2 before:h-2 before:rounded-[3px] before:bg-primary/80 before:flex-shrink-0">
        {children}
      </h3>
    )
  },
  ul({ children }: { children?: React.ReactNode }) {
    return <ul className="my-2.5 space-y-1.5 list-disc pl-5 marker:text-primary">{children}</ul>
  },
  ol({ children }: { children?: React.ReactNode }) {
    return <ol className="my-2.5 space-y-1.5 list-decimal pl-5 marker:text-primary marker:font-semibold">{children}</ol>
  },
  li({ children }: { children?: React.ReactNode }) {
    return <li className="text-[15px] lg:text-base text-foreground/80 leading-[1.7]">{children}</li>
  },
  blockquote({ children }: { children?: React.ReactNode }) {
    // The ONE takeaway worth remembering — a real callout, unmissable.
    return (
      <blockquote className="my-4 border-l-4 border-primary bg-primary/10 rounded-r-xl pl-4 pr-4 py-3 text-[15px] lg:text-base font-medium [&_p]:text-foreground [&_li]:text-foreground">
        {children}
      </blockquote>
    )
  },
  table({ children }: { children?: React.ReactNode }) {
    return (
      <div className="overflow-x-auto my-4 rounded-xl border border-border">
        <table className="w-full text-sm border-collapse [&_th]:border-b-2 [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:bg-primary/10 [&_th]:text-foreground [&_th]:font-bold [&_th]:text-left [&_td]:border-b [&_td]:border-border/50 [&_td]:px-3 [&_td]:py-2 [&_td]:text-foreground/85 [&_tr:last-child_td]:border-b-0">{children}</table>
      </div>
    )
  },
  hr() {
    return <hr className="my-5 border-border" />
  },
}

export function MarkdownRenderer({ content, imageContext, highlights, focusedHighlightId, onHighlightClick, onDeleteHighlight }: {
  content: string
  imageContext?: string
  /** Saved annotations for THIS content (already filtered to the message). */
  highlights?: HighlightSpan[]
  focusedHighlightId?: string | null
  onHighlightClick?: (id: string) => void
  onDeleteHighlight?: (id: string) => void
}) {
  const spans = highlights ?? []
  const spanById = new Map(spans.map(h => [h.id, h]))
  // ```image blocks become AI-generated educational diagrams. The code
  // component is overridden per-render so the visual can be grounded in the
  // surrounding lesson (imageContext = e.g. the node's title + summary).
  const components = {
    ...mdComponents,
    code(props: { children?: React.ReactNode; className?: string }) {
      if (props.className?.includes('language-image')) {
        const prompt = String(props.children ?? '').trim()
        if (prompt) return <GeneratedVisual prompt={prompt} context={imageContext ?? ''} />
      }
      // ```resources → clickable link cards (Honest Redirect law): a named
      // paper/simulation a beginner can actually open, not inert prose.
      if (props.className?.includes('language-resources')) {
        const parsed = parseResources(String(props.children ?? ''))
        if (parsed.length > 0) return <ResourceCards resources={parsed} />
      }
      return mdComponents.code(props)
    },
    // Marks come exclusively from the highlight pass above (markdown itself
    // never emits <mark>); unknown ids render as a plain mark, defensively.
    mark(props: React.HTMLAttributes<HTMLElement> & { node?: { properties?: { dataHighlightId?: unknown } } }) {
      const bag = props as unknown as Record<string, unknown>
      const id = String(bag['data-highlight-id'] ?? props.node?.properties?.dataHighlightId ?? '')
      const span = id ? spanById.get(id) : undefined
      if (!span) return <mark>{props.children}</mark>
      return (
        <HighlightMark
          span={span}
          focused={focusedHighlightId === span.id}
          onClick={onHighlightClick}
          onDelete={onDeleteHighlight}
        >
          {props.children}
        </HighlightMark>
      )
    },
  }
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={spans.length ? [rehypeKatex, rehypeHighlightRanges(spans)] : [rehypeKatex]}
      components={components as Parameters<typeof ReactMarkdown>[0]['components']}
    >
      {content}
    </ReactMarkdown>
  )
}
