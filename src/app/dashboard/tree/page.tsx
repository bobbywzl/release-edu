'use client'
/**
 * Tree home — your problem trees. State a problem, grow a tree.
 * Problem-first: this page IS the front door of learning in the Tree model.
 */
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Sprout, Plus, Trash2, CheckCircle2, Loader2, RefreshCw, Sparkles } from 'lucide-react'
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
  // Session onboarding — every tree starts with language, background, and
  // difficulty, so the whole session is calibrated before the first branch.
  const [step, setStep] = useState(0)
  const [sessLang, setSessLang] = useState<'en' | 'zh'>(language === 'zh' ? 'zh' : 'en')
  const [background, setBackground] = useState('')
  const [difficulty, setDifficulty] = useState<string>('intermediate')

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
        body: JSON.stringify({ problem: p, lang: sessLang, difficulty, personalContext: background.trim() || undefined }),
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

  // ── Consolidation: the learner closes out a tree ──
  // The panel plays a golden "settling" pulse, then keeps the consolidated
  // (amber) look permanently. Trees also auto-complete when every node
  // verifies; this button is the deliberate hand-on-the-cover moment.
  const [consolidating, setConsolidating] = useState<string | null>(null)
  async function markComplete(id: string) {
    if (consolidating || !confirm(t('tree.completeConfirm'))) return
    setConsolidating(id)
    try {
      await fetch(`/api/tree/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
    } catch { /* transient — the animation still resolves; reload reflects truth */ }
    setTimeout(() => {
      setTrees(prev => prev?.map(tr => (tr.id === id ? { ...tr, status: 'completed' } : tr)) ?? prev)
      setConsolidating(null)
    }, 950)
  }

  // ── Review: retention practice on a completed tree ──
  // The server picks the stalest verified node; the workspace opens in
  // review mode where Bob reactivates the idea and asks a fresh checkpoint.
  const [reviewBusy, setReviewBusy] = useState<string | null>(null)
  async function startReview(id: string) {
    if (reviewBusy) return
    setReviewBusy(id)
    try {
      const res = await fetch(`/api/tree/${id}/review`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.nodeId) {
        router.push(`/dashboard/workspace?tree=${id}&node=${body.nodeId}&review=1`)
        return
      }
      alert(t('tree.reviewNone'))
    } catch { /* transient */ }
    setReviewBusy(null)
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

      {/* Plant a new tree — the session onboarding stepper */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="border border-border rounded-xl bg-card p-5 space-y-4"
      >
        {/* Step dots */}
        <div className="flex items-center gap-2">
          {[0, 1, 2, 3].map(i => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-primary' : i < step ? 'w-3 bg-primary/50' : 'w-3 bg-muted'}`} />
          ))}
          <span className="ml-2 text-[11px] text-muted-foreground">{t('tree.sessionSetup')}</span>
        </div>

        {step === 0 && (
          <div className="space-y-3">
            <label className="text-sm font-bold text-foreground block">{t('tree.stepLanguage')}</label>
            <div className="flex gap-2">
              {([['en', 'English'], ['zh', '中文']] as const).map(([code, label]) => (
                <button
                  key={code}
                  onClick={() => setSessLang(code)}
                  className={`px-5 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    sessLang === code ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <label className="text-sm font-bold text-foreground block">{t('tree.stepBackground')}</label>
            <textarea
              value={background}
              onChange={e => setBackground(e.target.value)}
              placeholder={t('tree.backgroundPlaceholder')}
              rows={3}
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <label className="text-sm font-bold text-foreground block">{t('tree.stepDifficulty')}</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(['beginner', 'intermediate', 'advanced', 'professional'] as const).map(level => (
                <button
                  key={level}
                  onClick={() => setDifficulty(level)}
                  className={`text-left rounded-xl border p-3 transition-colors ${
                    difficulty === level ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'
                  }`}
                >
                  <p className={`text-sm font-bold ${difficulty === level ? 'text-primary' : 'text-foreground'}`}>{t(`tree.diff.${level}`)}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{t(`tree.diff.${level}Desc`)}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <label className="text-sm font-bold text-foreground block">{t('tree.problemPrompt')}</label>
            <textarea
              value={problem}
              onChange={e => setProblem(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); createTree() } }}
              placeholder={t('tree.problemPlaceholder')}
              rows={2}
              disabled={creating}
              autoFocus
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          {step > 0 && !creating && (
            <button
              onClick={() => setStep(s => s - 1)}
              className="px-4 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {t('tree.back')}
            </button>
          )}
          {step < 3 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              {t('tree.next')}
            </button>
          ) : (
            <button
              onClick={createTree}
              disabled={!problem.trim() || creating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {creating ? t('tree.growing') : t('tree.grow')}
            </button>
          )}
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
          const consolidated = tree.status === 'completed'
          const settling = consolidating === tree.id
          return (
            <Link key={tree.id} href={`/dashboard/tree/${tree.id}`} className="block group">
              <motion.div
                animate={settling ? {
                  scale: [1, 1.03, 1],
                  boxShadow: [
                    '0 0 0px rgba(251,191,36,0)',
                    '0 0 42px rgba(251,191,36,0.5)',
                    '0 0 0px rgba(251,191,36,0)',
                  ],
                } : {}}
                transition={{ duration: 0.95, ease: 'easeInOut' }}
                className={cn(
                  'border rounded-xl p-4 transition-colors',
                  // Consolidated trees settle into a golden panel — done,
                  // sealed, and worth coming back to review.
                  consolidated || settling
                    ? 'border-amber-400/45 bg-amber-500/[0.07] hover:border-amber-400/70'
                    : 'border-border bg-card hover:border-primary/40',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-bold text-foreground transition-colors', consolidated ? 'group-hover:text-amber-400' : 'group-hover:text-primary')}>
                      {tree.title}
                      {consolidated && (
                        <span className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-400 text-[10px] font-bold align-middle">
                          <Sparkles className="w-3 h-3" /> {t('tree.consolidated')}
                        </span>
                      )}
                    </p>
                    {tree.framing && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tree.framing}</p>}
                  </div>
                  {consolidated ? (
                    <button
                      onClick={e => { e.preventDefault(); startReview(tree.id) }}
                      disabled={reviewBusy === tree.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 text-amber-300 text-[11px] font-medium hover:bg-amber-500/20 transition-colors flex-shrink-0 disabled:opacity-50"
                      title={t('tree.reviewHint')}
                    >
                      {reviewBusy === tree.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      {t('tree.review')}
                    </button>
                  ) : (
                    <button
                      onClick={e => { e.preventDefault(); markComplete(tree.id) }}
                      disabled={settling}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground text-[11px] font-medium hover:text-amber-300 hover:border-amber-400/40 hover:bg-amber-500/10 transition-colors flex-shrink-0 disabled:opacity-50"
                      title={t('tree.markCompleteHint')}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {t('tree.markComplete')}
                    </button>
                  )}
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
                      className={cn('h-full rounded-full transition-all', consolidated ? 'bg-amber-400' : pct === 100 ? 'bg-emerald-400' : 'bg-primary')}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {tree.understoodCount}/{tree.nodeCount} · {pct}%
                  </span>
                </div>
              </motion.div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
