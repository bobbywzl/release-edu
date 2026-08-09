'use client'
/**
 * Admin Feedback inbox — where the ever-present user feedback button lands.
 * Triage flow: new → seen → resolved (one tap per move, reopen anytime).
 * Rows carry the auto-captured context (page, tree, language, browser) so a
 * bug report arrives with where-it-happened attached.
 */
import { useCallback, useEffect, useState } from 'react'
import { Bug, Inbox, Lightbulb, Loader2, MessagesSquare, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FeedbackRow {
  id: string
  category: string
  message: string
  page: string | null
  treeId: string | null
  language: string | null
  userAgent: string | null
  status: string
  createdAt: string
  userEmail: string | null
  userName: string | null
}

const FILTERS = ['all', 'new', 'seen', 'resolved'] as const

const CAT_STYLE: Record<string, { icon: typeof Bug; cls: string; label: string }> = {
  bug: { icon: Bug, cls: 'text-red-300 bg-red-500/10 border-red-400/30', label: 'Bug' },
  idea: { icon: Lightbulb, cls: 'text-amber-300 bg-amber-500/10 border-amber-400/30', label: 'Idea' },
  other: { icon: MessagesSquare, cls: 'text-sky-300 bg-sky-500/10 border-sky-400/30', label: 'Other' },
}

// Condense a UA string to the part a human triages on.
function shortUa(ua: string | null): string | null {
  if (!ua) return null
  const m = ua.match(/(Firefox|Edg|OPR|Chrome|Safari)\/[\d.]+/)
  const mobile = /Mobile|Android|iPhone|iPad/.test(ua) ? ' · mobile' : ''
  return m ? `${m[0]}${mobile}` : ua.slice(0, 40)
}

export default function AdminFeedbackPage() {
  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [newCount, setNewCount] = useState(0)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (f: (typeof FILTERS)[number]) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/feedback${f === 'all' ? '' : `?status=${f}`}`, { cache: 'no-store' })
      if (res.ok) {
        const body = await res.json()
        setRows(Array.isArray(body.rows) ? body.rows : [])
        setNewCount(typeof body.newCount === 'number' ? body.newCount : 0)
      }
    } catch { /* non-critical */ }
    setLoading(false)
  }, [])

  useEffect(() => { load(filter) }, [filter, load])

  async function setStatus(id: string, status: string) {
    if (busyId) return
    setBusyId(id)
    try {
      const res = await fetch('/api/admin/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (res.ok) {
        setRows(list => list.map(r => (r.id === id ? { ...r, status } : r)))
        setNewCount(n => {
          const was = rows.find(r => r.id === id)?.status
          if (was === 'new' && status !== 'new') return Math.max(0, n - 1)
          if (was !== 'new' && status === 'new') return n + 1
          return n
        })
      }
    } catch { /* non-critical */ }
    setBusyId(null)
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Inbox className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground">User Feedback</h1>
            <p className="text-sm text-muted-foreground">
              {newCount > 0 ? `${newCount} new note${newCount === 1 ? '' : 's'} waiting` : 'All caught up'}
            </p>
          </div>
        </div>
        <button
          onClick={() => load(filter)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-2.5 py-1.5 transition-colors"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      <div className="flex gap-1.5">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors',
              filter === f
                ? 'border-primary/60 bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            {f}{f === 'new' && newCount > 0 ? ` (${newCount})` : ''}
          </button>
        ))}
      </div>

      {loading && rows.length === 0 ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Nothing here — quiet inbox.</p>
      ) : (
        <div className="space-y-3">
          {rows.map(r => {
            const cat = CAT_STYLE[r.category] ?? CAT_STYLE.other
            const ua = shortUa(r.userAgent)
            return (
              <div
                key={r.id}
                className={cn(
                  'rounded-xl border bg-card p-4 space-y-2.5',
                  r.status === 'new' ? 'border-primary/40' : 'border-border',
                  r.status === 'resolved' && 'opacity-70',
                )}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold', cat.cls)}>
                    <cat.icon className="w-3 h-3" /> {cat.label}
                  </span>
                  <span className="text-xs text-foreground font-medium">{r.userName || r.userEmail || 'Unknown user'}</span>
                  {r.userName && r.userEmail && <span className="text-[11px] text-muted-foreground">{r.userEmail}</span>}
                  <span className="text-[11px] text-muted-foreground ml-auto">{new Date(r.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{r.message}</p>
                <p className="text-[11px] text-muted-foreground">
                  {[r.page, r.treeId ? `tree ${r.treeId.slice(0, 10)}…` : null, r.language, ua].filter(Boolean).join(' · ') || '—'}
                </p>
                <div className="flex gap-1.5">
                  {r.status !== 'seen' && r.status !== 'resolved' && (
                    <button
                      onClick={() => setStatus(r.id, 'seen')}
                      disabled={busyId === r.id}
                      className="rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent text-[11px] font-medium px-2.5 py-1 transition-colors disabled:opacity-50"
                    >
                      Mark seen
                    </button>
                  )}
                  {r.status !== 'resolved' ? (
                    <button
                      onClick={() => setStatus(r.id, 'resolved')}
                      disabled={busyId === r.id}
                      className="rounded-full border border-emerald-400/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-[11px] font-medium px-2.5 py-1 transition-colors disabled:opacity-50"
                    >
                      Resolve
                    </button>
                  ) : (
                    <button
                      onClick={() => setStatus(r.id, 'new')}
                      disabled={busyId === r.id}
                      className="rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent text-[11px] font-medium px-2.5 py-1 transition-colors disabled:opacity-50"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
