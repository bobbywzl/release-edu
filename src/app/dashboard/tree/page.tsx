'use client'
/**
 * Tree home — your problem trees. State a problem, grow a tree.
 * Problem-first: this page IS the front door of learning in the Tree model.
 */
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Sprout, Plus, Trash2, CheckCircle2, Loader2 } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface TreeSummary {
  id: string
  title: string
  framing: string | null
  status: string
  updatedAt: string
  nodeCount: number
  understoodCount: number
}

export default function TreePage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const [trees, setTrees] = useState<TreeSummary[] | null>(null)
  const [problem, setProblem] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tree', { cache: 'no-store' })
      if (res.ok) setTrees((await res.json()).trees)
    } catch { /* transient */ }
  }, [])
  useEffect(() => { load() }, [load])

  async function createTree() {
    const p = problem.trim()
    if (!p || creating) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem: p, lang: language }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'failed')
      router.push(`/dashboard/tree/${body.id}`)
    } catch {
      setError(t('tree.createFailed'))
      setCreating(false)
    }
  }

  async function deleteTree(id: string) {
    if (!confirm(t('tree.deleteConfirm'))) return
    await fetch(`/api/tree/${id}`, { method: 'DELETE' }).catch(() => {})
    setTrees(prev => prev?.filter(tr => tr.id !== id) ?? prev)
  }

  return (
    <div className="p-6 lg:p-10 max-w-3xl mx-auto space-y-8">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Sprout className="w-6 h-6 text-emerald-400" />
          {t('tree.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('tree.subtitle')}</p>
      </motion.div>

      {/* Plant a new tree */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="border border-border rounded-xl bg-card p-5 space-y-3"
      >
        <label className="text-sm font-bold text-foreground">{t('tree.problemPrompt')}</label>
        <textarea
          value={problem}
          onChange={e => setProblem(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); createTree() } }}
          placeholder={t('tree.problemPlaceholder')}
          rows={2}
          disabled={creating}
          className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={createTree}
            disabled={!problem.trim() || creating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {creating ? t('tree.growing') : t('tree.grow')}
          </button>
          {creating && <span className="text-xs text-muted-foreground animate-pulse">{t('tree.growingHint')}</span>}
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      </motion.div>

      {/* Existing trees */}
      <div className="space-y-3">
        {trees === null && <div className="h-24 rounded-xl border border-border bg-card/50 animate-pulse" />}
        {trees?.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">{t('tree.empty')}</p>
        )}
        {trees?.map(tree => {
          const pct = tree.nodeCount > 0 ? Math.round((tree.understoodCount / tree.nodeCount) * 100) : 0
          return (
            <Link key={tree.id} href={`/dashboard/tree/${tree.id}`} className="block group">
              <div className="border border-border rounded-xl bg-card p-4 hover:border-primary/40 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                      {tree.title}
                      {tree.status === 'completed' && <CheckCircle2 className="inline w-4 h-4 text-emerald-400 ml-1.5 -mt-0.5" />}
                    </p>
                    {tree.framing && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tree.framing}</p>}
                  </div>
                  <button
                    onClick={e => { e.preventDefault(); deleteTree(tree.id) }}
                    className="p-1.5 rounded-md text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                    title={t('tree.delete')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', pct === 100 ? 'bg-emerald-400' : 'bg-primary')}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {tree.understoodCount}/{tree.nodeCount} · {pct}%
                  </span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
