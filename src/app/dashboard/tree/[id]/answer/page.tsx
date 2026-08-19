'use client'
/**
 * THE ANSWER — full-width reader (QA items 9 & 11).
 *
 * The most important artifact the app produces was being read through an
 * inline scroll inside a ~280px side panel. This route gives it a real
 * reading surface: full-width markdown, the source nodes it was assembled
 * from (each claim in the document is also tagged inline with the node
 * that proved it), regenerate, and print/PDF export.
 *
 * Auto-reveal contract: completion fires the synthesis in the background and
 * GET reports `assembling` while it runs. Arriving early shows an honest
 * "assembling…" state — never a generate button that would duplicate the
 * running job — and polls until the document lands, then reveals it. Only
 * if the polls outlive the job's window does the manual button return.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowLeft, FileText, Loader2, Printer, RefreshCw, ShieldCheck } from 'lucide-react'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { useLanguage } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface TreeMeta {
  title: string
  displayTitle?: string | null
  status?: string | null
  nodes: Array<{ id: string; title: string; status: string | null; parentId: string | null; pending?: boolean }>
}

// 6s × 34 ≈ 3.4 min — outlives the server's assembling window (3 min), so
// the manual button only returns once the server has stopped claiming a job.
const POLL_MS = 6000
const POLL_BUDGET = 34

export default function AnswerReaderPage() {
  const params = useParams<{ id: string }>()
  const treeId = params?.id
  const router = useRouter()
  const { t, language } = useLanguage()
  const [tree, setTree] = useState<TreeMeta | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [assembling, setAssembling] = useState(false)
  const [gaveUp, setGaveUp] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const pollsLeft = useRef(POLL_BUDGET)

  const loadAnswer = useCallback(async () => {
    if (!treeId) return
    try {
      const d = await (await fetch(`/api/tree/${treeId}/answer`, { cache: 'no-store' })).json()
      setAnswer(typeof d.answer === 'string' && d.answer.trim() ? d.answer : null)
      setGeneratedAt(d.generatedAt ?? null)
      setAssembling(!!d.assembling)
    } catch { /* keeps last state */ }
  }, [treeId])

  useEffect(() => {
    if (!treeId) return
    let cancelled = false
    Promise.all([
      fetch(`/api/tree/${treeId}`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)),
      fetch(`/api/tree/${treeId}/answer`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)),
    ]).then(([tr, an]) => {
      if (cancelled) return
      if (tr?.tree) setTree(tr.tree)
      if (an) {
        setAnswer(typeof an.answer === 'string' && an.answer.trim() ? an.answer : null)
        setGeneratedAt(an.generatedAt ?? null)
        setAssembling(!!an.assembling)
      }
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [treeId])

  // Assembly in flight — poll it in, then reveal. A fresh document always
  // clears `assembling` server-side, which ends the loop. An interval, not a
  // re-armed timeout: empty polls change no state, so effects keyed on state
  // would never re-fire.
  useEffect(() => {
    if (!assembling || gaveUp) return
    const timer = setInterval(() => {
      if (pollsLeft.current <= 0) { setGaveUp(true); return }
      pollsLeft.current -= 1
      loadAnswer()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [assembling, gaveUp, loadAnswer])

  const waiting = assembling && !gaveUp

  async function regenerate() {
    if (generating || !treeId) return
    setGenerating(true); setNote(null)
    try {
      const res = await fetch(`/api/tree/${treeId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: language }),
      })
      if (res.status === 202) {
        // The completion synthesis is already running — wait for it.
        pollsLeft.current = POLL_BUDGET
        setGaveUp(false)
        setAssembling(true)
        return
      }
      const body = await res.json().catch(() => ({}))
      if (res.ok && typeof body.answer === 'string') {
        setAnswer(body.answer)
        setGeneratedAt(body.generatedAt ?? new Date().toISOString())
        setAssembling(false)
      } else {
        setNote(typeof body.error === 'string' ? body.error : t('tree.actionFailed'))
      }
    } catch {
      setNote(t('tree.actionFailed'))
    } finally {
      setGenerating(false)
    }
  }

  const proven = (tree?.nodes ?? []).filter(n => !n.pending && n.parentId !== null && n.status === 'understood')

  return (
    <div className="min-h-full bg-background">
      {/* Header — hidden in print so the exported PDF is the document alone */}
      <div className="print:hidden sticky top-0 z-20 border-b border-border bg-card/70 backdrop-blur-sm px-4 py-2.5 flex items-center gap-3">
        <Link href={`/dashboard/tree/${treeId}`} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <FileText className="w-4 h-4 text-amber-300 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground truncate">{t('tree.rootAnswerTitle')}</p>
          <p className="text-[11px] text-muted-foreground truncate">{tree?.displayTitle || tree?.title || '…'}</p>
        </div>
        <button
          onClick={regenerate}
          disabled={generating || waiting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 text-amber-300 text-xs px-2.5 py-1.5 hover:bg-amber-500/15 transition-colors disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{t('tree.rootAnswerRegen')}</span>
        </button>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent px-2.5 py-1.5 transition-colors"
        >
          <Printer className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t('tree.answerPrint')}</span>
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-5 py-8 space-y-6 print:max-w-none print:px-0">
        {loading ? (
          <div className="py-24 flex justify-center"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
        ) : (
          <>
            {(waiting || (generating && answer)) && (
              <div className="print:hidden flex items-center gap-2.5 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-200">
                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                {t('tree.answerAssembling')}
              </div>
            )}

            {/* Sources — the verified nodes this document draws from; each
                major claim inside is also tagged inline with the node that
                proved it. */}
            {answer && proven.length > 0 && (
              <div className="print:hidden space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('tree.answerSources').replace('{n}', String(proven.length))}</p>
                <div className="flex flex-wrap gap-1.5">
                  {proven.map(n => (
                    <button
                      key={n.id}
                      onClick={() => router.push(`/dashboard/workspace?tree=${treeId}&node=${n.id}`)}
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-300 text-[11px] px-2.5 py-1 hover:bg-emerald-500/20 transition-colors"
                    >
                      <ShieldCheck className="w-3 h-3" /> {n.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {answer ? (
              /* Keyed on the generation stamp: a freshly landed document
                 re-mounts and slides in — the reveal moment. */
              <motion.div
                key={generatedAt ?? 'pre'}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <div className={cn('text-[15px] leading-relaxed', waiting && 'opacity-80')}>
                  <MarkdownRenderer content={answer} />
                </div>
                {generatedAt && (
                  <p className="print:hidden mt-6 text-[11px] text-muted-foreground/70">{new Date(generatedAt).toLocaleString()}</p>
                )}
              </motion.div>
            ) : waiting ? (
              /* First assembly in flight and nothing cached yet: the honest
                 wait — no button that would duplicate the running job. */
              <div className="py-16 text-center space-y-4">
                <Loader2 className="w-8 h-8 text-amber-300/80 mx-auto animate-spin" />
                <p className="text-sm text-amber-200/90 max-w-md mx-auto">{t('tree.answerAssembling')}</p>
              </div>
            ) : (
              <div className="py-16 text-center space-y-4">
                <FileText className="w-8 h-8 text-amber-300/70 mx-auto" />
                {gaveUp && <p className="text-[12px] text-amber-300/90 max-w-md mx-auto">{t('tree.answerAssemblyFailed')}</p>}
                <p className="text-sm text-muted-foreground max-w-md mx-auto">{t('tree.rootAnswerHint')}</p>
                <button
                  onClick={regenerate}
                  disabled={generating}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 border border-amber-400/40 text-amber-300 text-sm font-medium px-4 py-2 hover:bg-amber-500/25 transition-colors disabled:opacity-50"
                >
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  {generating ? t('tree.rootAnswerGenerating') : t('tree.rootAnswerGenerate')}
                </button>
              </div>
            )}
            {note && <p className="text-[12px] text-amber-400">{note}</p>}
          </>
        )}
      </div>
    </div>
  )
}
